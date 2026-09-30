import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildDatacenterPriceCaptureEvidence } from "../evidence/datacenter-price-history.ts";

export const DATACENTER_PRICE_ENDPOINT =
  "https://m.fconline.nexon.com/datacenter/PlayerPriceGraph";
export const DEFAULT_COLLECTION_DELAY_MS = 1_500;
export const MIN_COLLECTION_DELAY_MS = 1_000;
export const DEFAULT_COLLECTION_TIMEOUT_MS = 15_000;
export const DEFAULT_COLLECTION_MAX_RETRIES = 2;

export interface PriceCollectionTarget {
  spid: string;
  grade: number;
}

export interface PriceCollectionOptions {
  endpoint?: string;
  outputDir?: string;
  delayMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}

export interface CollectedPriceSnapshot {
  target: PriceCollectionTarget;
  observed_at: string;
  raw_path: string;
  metadata_path: string;
  raw_sha256: string;
  point_count: number;
  native_granularity: string;
  history_span: string;
}

export class CollectionHaltedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CollectionHaltedError";
    this.status = status;
  }
}

function assertTarget(target: PriceCollectionTarget): void {
  if (!/^\d+$/.test(target.spid)) {
    throw new TypeError("spid must contain digits only");
  }
  if (!Number.isInteger(target.grade) || target.grade < 1 || target.grade > 13) {
    throw new TypeError("grade must be an integer from 1 to 13");
  }
}

function normalizeOptions(options: PriceCollectionOptions) {
  const delayMs = options.delayMs ?? DEFAULT_COLLECTION_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_COLLECTION_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_COLLECTION_MAX_RETRIES;

  if (!Number.isInteger(delayMs) || delayMs < MIN_COLLECTION_DELAY_MS) {
    throw new TypeError(
      `delayMs must be an integer >= ${MIN_COLLECTION_DELAY_MS}`,
    );
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
    throw new TypeError("maxRetries must be an integer from 0 to 5");
  }

  return {
    endpoint: options.endpoint ?? DATACENTER_PRICE_ENDPOINT,
    outputDir: options.outputDir ?? "data/raw/datacenter-price",
    delayMs,
    timeoutMs,
    maxRetries,
    fetchImpl: options.fetchImpl ?? fetch,
    sleep:
      options.sleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds))),
    now: options.now ?? (() => new Date()),
  };
}

async function requestOnce(
  target: PriceCollectionTarget,
  endpoint: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const body = new URLSearchParams({
    spid: target.spid,
    n1strong: String(target.grade),
  });

  return fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Accept: "text/html, */*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: `https://m.fconline.nexon.com/datacenter/playerinfo?spid=${target.spid}`,
      "User-Agent": "fc-market-lab/0.0.0 (local research PoC)",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function fetchWithRetry(
  target: PriceCollectionTarget,
  options: ReturnType<typeof normalizeOptions>,
): Promise<{ response: Response; raw: string }> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      const response = await requestOnce(
        target,
        options.endpoint,
        options.timeoutMs,
        options.fetchImpl,
      );

      if (response.status === 403 || response.status === 429) {
        throw new CollectionHaltedError(
          response.status,
          `Data Center collection halted on HTTP ${response.status}; do not retry or bypass the restriction`,
        );
      }

      if (response.ok) {
        return { response, raw: await response.text() };
      }

      if (response.status < 500 || response.status > 599) {
        throw new Error(`Data Center request failed with HTTP ${response.status}`);
      }

      lastError = new Error(`Data Center request failed with HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof CollectionHaltedError) {
        throw error;
      }
      lastError = error;
    }

    if (attempt < options.maxRetries) {
      await options.sleep(options.delayMs * 2 ** attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Data Center request failed");
}

function fileSafeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

export async function collectDatacenterPriceTarget(
  target: PriceCollectionTarget,
  inputOptions: PriceCollectionOptions = {},
): Promise<CollectedPriceSnapshot> {
  assertTarget(target);
  const options = normalizeOptions(inputOptions);
  const observedAt = options.now().toISOString();
  const { response, raw } = await fetchWithRetry(target, options);
  const evidence = buildDatacenterPriceCaptureEvidence({
    raw,
    spid: target.spid,
    grade: target.grade,
    observed_at: observedAt,
  });

  const dateDir = join(options.outputDir, observedAt.slice(0, 10));
  await mkdir(dateDir, { recursive: true });

  const basename = `${target.spid}-g${target.grade}-${fileSafeTimestamp(observedAt)}`;
  const rawPath = join(dateDir, `${basename}.html`);
  const metadataPath = join(dateDir, `${basename}.json`);

  await writeFile(rawPath, raw, { encoding: "utf8", flag: "wx" });
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        collector: "experimental-datacenter-price",
        collector_version: 1,
        source_url: options.endpoint,
        method: "POST",
        request: { spid: target.spid, n1strong: target.grade },
        response_status: response.status,
        response_content_type: response.headers.get("content-type"),
        observed_at: observedAt,
        raw_sha256: evidence.raw_sha256,
        evidence,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );

  return {
    target,
    observed_at: observedAt,
    raw_path: rawPath,
    metadata_path: metadataPath,
    raw_sha256: evidence.raw_sha256,
    point_count: evidence.point_count,
    native_granularity: evidence.native_granularity,
    history_span: evidence.gate_update.history_span,
  };
}

export async function collectDatacenterPriceTargets(
  targets: PriceCollectionTarget[],
  inputOptions: PriceCollectionOptions = {},
): Promise<CollectedPriceSnapshot[]> {
  if (targets.length === 0) {
    throw new TypeError("at least one collection target is required");
  }

  const options = normalizeOptions(inputOptions);
  const seen = new Set<string>();
  for (const target of targets) {
    assertTarget(target);
    const key = `${target.spid}:${target.grade}`;
    if (seen.has(key)) {
      throw new TypeError(`duplicate collection target: ${key}`);
    }
    seen.add(key);
  }

  const results: CollectedPriceSnapshot[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    if (!target) {
      continue;
    }
    results.push(await collectDatacenterPriceTarget(target, options));
    if (index < targets.length - 1) {
      await options.sleep(options.delayMs);
    }
  }
  return results;
}
