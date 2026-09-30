import { createHash } from "node:crypto";

import type { SeedCatalogDocument, SeedPlayer } from "../catalog/seed-catalog.ts";
import {
  buildDatacenterPriceCaptureEvidence,
  type DatacenterPriceCaptureEvidence,
} from "../evidence/datacenter-price-history.ts";
export { DATACENTER_PLAYWRIGHT_CAPTURE_METHOD } from "../evidence/datacenter-metadata.ts";
import { DATACENTER_PLAYWRIGHT_CAPTURE_METHOD } from "../evidence/datacenter-metadata.ts";
import { extractDatacenterMetadata, type BrowserMetadataExtraction } from "./datacenter-browser-extract.ts";

export interface DatacenterBrowserCapture {
  spid: string;
  grade: number;
  player_name: string;
  observed_at: string;
  source_url: string;
  page_raw: Buffer;
  page_sha256: string;
  price_raw: Buffer;
  price_sha256: string;
  price_evidence: DatacenterPriceCaptureEvidence;
  metadata: BrowserMetadataExtraction;
}

interface ResponseLike {
  url(): string;
  status(): number;
  body(): Promise<Buffer>;
  headerValue(name: string): Promise<string | null>;
}

interface LocatorLike {
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  click(options?: { timeout?: number }): Promise<void>;
  innerText(): Promise<string>;
  first(): LocatorLike;
}

interface PageLike {
  on(event: "response", handler: (response: ResponseLike) => void): void;
  goto(url: string, options?: Record<string, unknown>): Promise<ResponseLike | null>;
  content(): Promise<string>;
  locator(selector: string): LocatorLike;
  getByText(text: string, options?: { exact?: boolean }): LocatorLike;
  waitForTimeout(ms: number): Promise<void>;
  url(): string;
  close(): Promise<void>;
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface BrowserLike {
  newContext(options?: Record<string, unknown>): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

export interface DatacenterPlaywrightOptions {
  headless?: boolean;
  navigationTimeoutMs?: number;
  settleMs?: number;
  delayBetweenPlayersMs?: number;
  launchBrowser?: () => Promise<BrowserLike>;
}

interface ObservedResponse {
  url: string;
  status: number;
  body: Buffer;
}

function sha256(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function playerUrl(seed: SeedPlayer): string {
  return (
    "https://fconline.nexon.com/DataCenter/PlayerInfo?" +
    `n1Strong=${seed.primary_instrument.grade}&spid=${seed.primary_instrument.spid}`
  );
}

function isOfficialHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "fconline.nexon.com" || host === "m.fconline.nexon.com";
  } catch {
    return false;
  }
}

function isTextualContentType(value: string | null): boolean {
  if (!value) {
    return true;
  }
  return /(?:json|javascript|html|text|xml)/i.test(value);
}

function detectAccessControl(pageUrl: string, pageText: string): void {
  if (/captcha|recaptcha/i.test(pageUrl)) {
    throw new Error(`Data Center access control detected at ${pageUrl}`);
  }
  if (/(?:captcha|자동\s*입력\s*방지|비정상적인\s*접근|접근이\s*제한)/i.test(pageText)) {
    throw new Error("Data Center access control detected in page content");
  }
}

const POSITION_OVR_PATTERN =
  /\b(?:GK|SW|RWB|RB|RCB|CB|LCB|LB|LWB|CDM|RM|CM|LM|CAM|RW|RF|CF|LF|LW|ST)\s+\d{2,3}\b/;

function renderedMetadataReady(text: string, playerName: string): boolean {
  const hasPlayerName = text.includes(playerName);
  const hasPositionOvr = POSITION_OVR_PATTERN.test(text);
  const hasSummary = /(?:^|\n)\s*\d{2,3}\s*\n\s*[A-Z]{1,4}\s*\n\s*\d{1,2}\s*(?:\n|$)/m.test(
    text,
  );
  return hasPlayerName && (hasPositionOvr || hasSummary);
}

async function waitForRenderedMetadata(
  page: PageLike,
  playerName: string,
  timeoutMs: number,
): Promise<string> {
  const body = page.locator("body");
  const deadline = Date.now() + Math.min(timeoutMs, 20_000);
  let lastText = "";

  do {
    try {
      lastText = await body.innerText();
      if (renderedMetadataReady(lastText, playerName)) {
        return lastText;
      }
    } catch {
      // Keep polling until the page body is available or the deadline expires.
    }
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);

  return lastText;
}

async function trySelectLongestHistory(page: PageLike): Promise<void> {
  for (const label of ["1년", "365일", "365", "전체"]) {
    const locator = page.getByText(label, { exact: true }).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        await locator.click({ timeout: 3000 });
        return;
      }
    } catch {
      // Range controls are optional. Candidate selection below keeps the longest response.
    }
  }
}

function selectPriceCandidate(input: {
  responses: ObservedResponse[];
  pageRaw: Buffer;
  spid: string;
  grade: number;
  observedAt: string;
}): { raw: Buffer; evidence: DatacenterPriceCaptureEvidence } {
  const candidates = [
    ...input.responses
      .filter((item) => /PlayerPriceGraph/i.test(item.url))
      .map((item) => item.body),
    ...input.responses
      .filter((item) => !/PlayerPriceGraph/i.test(item.url))
      .map((item) => item.body),
    input.pageRaw,
  ];

  let best: { raw: Buffer; evidence: DatacenterPriceCaptureEvidence } | null = null;
  for (const raw of candidates) {
    try {
      const evidence = buildDatacenterPriceCaptureEvidence({
        raw: raw.toString("utf8"),
        spid: input.spid,
        grade: input.grade,
        observed_at: input.observedAt,
      });
      if (!best || evidence.point_count > best.evidence.point_count) {
        best = { raw, evidence };
      }
    } catch {
      // Not a supported price response.
    }
  }
  if (!best) {
    throw new TypeError(`no price-history response found for spid=${input.spid}`);
  }
  return best;
}

async function defaultLaunchBrowser(headless: boolean): Promise<BrowserLike> {
  let imported: typeof import("playwright");
  try {
    imported = await import("playwright");
  } catch {
    throw new Error(
      "Playwright is not installed. Run npm install and npm run browser:install first.",
    );
  }
  return (await imported.chromium.launch({ headless })) as unknown as BrowserLike;
}

async function captureSeed(
  browser: BrowserLike,
  seed: SeedPlayer,
  options: Required<Omit<DatacenterPlaywrightOptions, "launchBrowser">>,
): Promise<DatacenterBrowserCapture> {
  const context = await browser.newContext({
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();
  const pending = new Set<Promise<void>>();
  const responses: ObservedResponse[] = [];
  let blockedStatus: { status: number; url: string } | null = null;

  page.on("response", (response) => {
    if (!isOfficialHost(response.url())) {
      return;
    }
    if (response.status() === 403 || response.status() === 429) {
      blockedStatus = { status: response.status(), url: response.url() };
    }
    const task = (async () => {
      const contentType = await response.headerValue("content-type");
      if (!isTextualContentType(contentType)) {
        return;
      }
      const body = await response.body();
      if (body.length > 5_000_000) {
        return;
      }
      responses.push({ url: response.url(), status: response.status(), body });
    })().catch(() => undefined);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });

  const observedAt = new Date().toISOString();
  const sourceUrl = playerUrl(seed);
  try {
    const navigation = await page.goto(sourceUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.navigationTimeoutMs,
    });
    if (!navigation) {
      throw new Error(`Data Center navigation returned no response for ${sourceUrl}`);
    }
    if (navigation.status() === 403 || navigation.status() === 429) {
      throw new Error(`Data Center returned ${navigation.status()} for ${sourceUrl}`);
    }
    if (navigation.status() >= 400) {
      throw new Error(`Data Center returned ${navigation.status()} for ${sourceUrl}`);
    }

    await page.waitForTimeout(options.settleMs);
    await trySelectLongestHistory(page);
    await page.waitForTimeout(options.settleMs);
    await Promise.allSettled([...pending]);

    const pageText = await waitForRenderedMetadata(
      page,
      seed.player_name,
      options.navigationTimeoutMs,
    );
    detectAccessControl(page.url(), pageText);
    if (blockedStatus) {
      throw new Error(
        `Data Center returned ${blockedStatus.status} for ${blockedStatus.url}`,
      );
    }

    const pageRaw = Buffer.from(await page.content(), "utf8");
    const price = selectPriceCandidate({
      responses,
      pageRaw,
      spid: seed.primary_instrument.spid,
      grade: seed.primary_instrument.grade,
      observedAt,
    });
    let metadata: BrowserMetadataExtraction;
    try {
      metadata = extractDatacenterMetadata({
        spid: seed.primary_instrument.spid,
        expected_player_name: seed.player_name,
        page_text: pageText,
        page_html: pageRaw.toString("utf8"),
        response_bodies: responses.map((item) => item.body.toString("utf8")),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new TypeError(
        `${message}; page_url=${page.url()}; body_chars=${pageText.length}; ` +
          `player_name_present=${pageText.includes(seed.player_name)}; responses=${responses.length}`,
      );
    }

    return {
      spid: seed.primary_instrument.spid,
      grade: seed.primary_instrument.grade,
      player_name: seed.player_name,
      observed_at: observedAt,
      source_url: sourceUrl,
      page_raw: pageRaw,
      page_sha256: sha256(pageRaw),
      price_raw: price.raw,
      price_sha256: sha256(price.raw),
      price_evidence: price.evidence,
      metadata,
    };
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

export async function collectDatacenterWithPlaywright(
  catalog: SeedCatalogDocument,
  input: DatacenterPlaywrightOptions = {},
): Promise<DatacenterBrowserCapture[]> {
  const options = {
    headless: input.headless ?? true,
    navigationTimeoutMs: input.navigationTimeoutMs ?? 60_000,
    settleMs: input.settleMs ?? 1500,
    delayBetweenPlayersMs: input.delayBetweenPlayersMs ?? 2500,
  };
  const launch = input.launchBrowser ?? (() => defaultLaunchBrowser(options.headless));
  const browser = await launch();
  const captures: DatacenterBrowserCapture[] = [];
  try {
    for (let index = 0; index < catalog.seeds.length; index += 1) {
      captures.push(await captureSeed(browser, catalog.seeds[index]!, options));
      if (index < catalog.seeds.length - 1 && options.delayBetweenPlayersMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.delayBetweenPlayersMs));
      }
    }
    return captures;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
