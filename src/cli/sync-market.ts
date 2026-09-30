import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";

import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import { collectDatacenterWithPlaywright, DATACENTER_PLAYWRIGHT_CAPTURE_METHOD } from "../collect/datacenter-playwright.ts";
import { collectOpenApiMetadata } from "../collect/openapi-metadata.ts";
import {
  collectOpenApiRankerStats,
  DEFAULT_RANKER_MATCHTYPE,
  rankerStatsTargetsFromDatabase,
} from "../collect/openapi-ranker-stats.ts";
import {
  countMetadataUsageDatabase,
  countPriceDatabase,
  openMarketDatabase,
} from "../db/market-db.ts";
import {
  findClassMarketAvailability,
  parseClassMarketAvailabilityDocument,
} from "../evidence/class-market-availability.ts";
import { parseDatacenterMetadataEvidenceDocument } from "../evidence/datacenter-metadata.ts";
import type { CoverageSnapshot } from "../gates/coverage-viability.ts";
import type { RawHtmlFile } from "../ingest/raw-html-files.ts";
import { normalizeDatacenterMetadata } from "../normalize/datacenter-metadata.ts";
import { normalizeOpenApiMetadata } from "../normalize/openapi-metadata.ts";
import { normalizePriceHistorySnapshot } from "../normalize/price-history.ts";
import { normalizeRankerStats } from "../normalize/ranker-stats.ts";
import { normalizeSeedUsage } from "../normalize/seed-usage.ts";

try {
  loadEnvFile(".env");
} catch (error) {
  if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) {
    throw error;
  }
}

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function positiveNumber(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive number`);
  }
  return parsed;
}

function fileTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function latestObservedAt(db: ReturnType<typeof openMarketDatabase>, sourceId: string): string | null {
  const row = db
    .prepare(
      `SELECT observed_at
       FROM source_snapshot
       WHERE source_id = ? AND parse_status = 'PARSED'
       ORDER BY observed_at DESC, source_snapshot_id DESC
       LIMIT 1`,
    )
    .get(sourceId) as { observed_at: string } | undefined;
  return row?.observed_at ?? null;
}

function metadataRefreshDue(
  db: ReturnType<typeof openMarketDatabase>,
  now: string,
  refreshDays: number,
): boolean {
  const nowMs = Date.parse(now);
  const maxAgeMs = refreshDays * 24 * 60 * 60 * 1000;
  for (const kind of ["spid", "season", "position"] as const) {
    const observedAt = latestObservedAt(db, `nexon-open-api-${kind}-metadata`);
    if (!observedAt || nowMs - Date.parse(observedAt) >= maxAgeMs) {
      return true;
    }
  }
  return false;
}

async function persistBrowserCaptures(
  captures: Awaited<ReturnType<typeof collectDatacenterWithPlaywright>>,
  root: string,
): Promise<{
  rawByHash: Map<string, RawHtmlFile>;
  pricePaths: Map<string, string>;
  manifestPath: string;
}> {
  const rawByHash = new Map<string, RawHtmlFile>();
  const pricePaths = new Map<string, string>();
  const manifestEntries = [];

  for (const capture of captures) {
    const day = capture.observed_at.slice(0, 10);
    const stamp = fileTimestamp(capture.observed_at);
    const priceDir = join(root, "datacenter-price", day);
    const metadataDir = join(root, "datacenter-metadata", day);
    await Promise.all([
      mkdir(priceDir, { recursive: true }),
      mkdir(metadataDir, { recursive: true }),
    ]);
    const basename = `${capture.spid}-g${capture.grade}-${stamp}`;
    const pricePath = join(priceDir, `${basename}.html`);
    const metadataPath = join(metadataDir, `${basename}.html`);
    await Promise.all([
      writeFile(pricePath, capture.price_raw),
      writeFile(metadataPath, capture.page_raw),
    ]);
    rawByHash.set(capture.page_sha256, {
      path: metadataPath,
      raw: capture.page_raw,
      raw_sha256: capture.page_sha256,
    });
    pricePaths.set(`${capture.spid}:${capture.grade}`, pricePath);
    manifestEntries.push({
      spid: capture.spid,
      grade: capture.grade,
      observed_at: capture.observed_at,
      source_url: capture.source_url,
      price_path: pricePath,
      price_sha256: capture.price_sha256,
      metadata_path: metadataPath,
      metadata_sha256: capture.page_sha256,
    });
  }

  const manifestPath = join(root, "datacenter-browser", "latest.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        capture_method: DATACENTER_PLAYWRIGHT_CAPTURE_METHOD,
        captured_at: new Date().toISOString(),
        entries: manifestEntries,
      },
      null,
      2,
    )}\n`,
  );
  return { rawByHash, pricePaths, manifestPath };
}

async function persistOpenApiMetadata(
  artifacts: Awaited<ReturnType<typeof collectOpenApiMetadata>>,
  root: string,
): Promise<string> {
  const observedAt = artifacts[0]?.observed_at;
  if (!observedAt) {
    throw new TypeError("Open API metadata artifacts are empty");
  }
  const dayDir = join(root, "openapi-metadata", observedAt.slice(0, 10));
  await mkdir(dayDir, { recursive: true });
  const paths: Record<string, string> = {};
  for (const artifact of artifacts) {
    const path = join(
      dayDir,
      `${artifact.kind}-${fileTimestamp(artifact.observed_at)}.json`,
    );
    await writeFile(path, artifact.raw);
    paths[artifact.kind] = path;
  }
  const manifestPath = join(root, "openapi-metadata", "latest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      { schema_version: 1, observed_at: observedAt, artifacts: paths },
      null,
      2,
    )}\n`,
  );
  return manifestPath;
}

async function persistRankerStats(
  artifacts: Awaited<ReturnType<typeof collectOpenApiRankerStats>>,
  root: string,
  observedAt: string,
  matchtype: number,
): Promise<string> {
  const dayDir = join(root, "openapi-ranker-stats", observedAt.slice(0, 10));
  await mkdir(dayDir, { recursive: true });
  const entries = [];
  for (let index = 0; index < artifacts.length; index += 1) {
    const artifact = artifacts[index]!;
    const path = join(
      dayDir,
      `ranker-stats-${fileTimestamp(observedAt)}-${index + 1}.json`,
    );
    await writeFile(path, artifact.raw);
    entries.push({ path, source_url: artifact.source_url, targets: artifact.targets });
  }
  const manifestPath = join(root, "openapi-ranker-stats", "latest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schema_version: 1,
        observed_at: observedAt,
        matchtype,
        artifacts: entries,
      },
      null,
      2,
    )}\n`,
  );
  return manifestPath;
}

const args = process.argv.slice(2);
const catalogPath = readOption(args, "catalog") ?? "data/catalog/seed-catalog.json";
const availabilityPath =
  readOption(args, "class-availability") ?? "data/evidence/class-market-availability.json";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const rawRoot = readOption(args, "raw-root") ?? "data/raw";
const metadataRefreshDays = positiveNumber(
  process.env.FC_MARKET_METADATA_REFRESH_DAYS,
  7,
  "FC_MARKET_METADATA_REFRESH_DAYS",
);
const delayBetweenPlayersMs = positiveNumber(
  process.env.FC_MARKET_BROWSER_DELAY_MS,
  2500,
  "FC_MARKET_BROWSER_DELAY_MS",
);
const headless = process.env.FC_MARKET_BROWSER_HEADLESS !== "0";
const apiKey = process.env.NEXON_OPEN_API_KEY ?? "";

if (process.env.FC_MARKET_ENABLE_BROWSER_AUTOMATION !== "1") {
  throw new Error(
    "Browser automation is disabled. Set FC_MARKET_ENABLE_BROWSER_AUTOMATION=1 after reviewing data/evidence/datacenter-browser-automation-policy.json.",
  );
}
if (apiKey.trim() === "") {
  throw new TypeError("NEXON_OPEN_API_KEY environment variable is required");
}

const lockPath = join("data", ".sync-market.lock");
await mkdir(dirname(lockPath), { recursive: true });
let lock;
try {
  lock = await open(lockPath, "wx");
} catch (error) {
  if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST") {
    throw new Error(`market sync is already running (${lockPath} exists)`);
  }
  throw error;
}

try {
  const catalogRaw = await readFile(catalogPath);
  const catalog = parseSeedCatalogDocument(JSON.parse(catalogRaw.toString("utf8")));
  const availability = parseClassMarketAvailabilityDocument(
    JSON.parse(await readFile(availabilityPath, "utf8")),
  );
  const syncObservedAt = new Date().toISOString();

  const captures = await collectDatacenterWithPlaywright(catalog, {
    headless,
    delayBetweenPlayersMs,
  });
  const persistedBrowser = await persistBrowserCaptures(captures, rawRoot);

  const db = openMarketDatabase(dbPath);
  try {
    const priceResults = [];
    for (const capture of captures) {
      const classAvailability = findClassMarketAvailability(availability, capture.spid);
      if (!classAvailability) {
        throw new TypeError(`class availability is missing for spid=${capture.spid}`);
      }
      const expected: CoverageSnapshot = {
        spid: capture.spid,
        grade: capture.grade,
        class_code: classAvailability.class_code,
        observed_at: capture.observed_at,
        raw_sha256: capture.price_sha256,
        point_count: capture.price_evidence.point_count,
        first_source_date: capture.price_evidence.first_source_date,
        last_source_date: capture.price_evidence.last_source_date,
        observed_span_days: capture.price_evidence.observed_span_days,
        native_granularity: capture.price_evidence.native_granularity,
        source_path: persistedBrowser.pricePaths.get(`${capture.spid}:${capture.grade}`),
      };
      const seed = catalog.seeds.find(
        (item) =>
          item.primary_instrument.spid === capture.spid &&
          item.primary_instrument.grade === capture.grade,
      );
      if (!seed) {
        throw new TypeError(`browser capture ${capture.spid}:${capture.grade} is not in catalog`);
      }
      priceResults.push(
        normalizePriceHistorySnapshot(db, {
          seed,
          expected,
          raw: capture.price_raw,
          source_id: "fconline-datacenter-price-history",
          capture_method: DATACENTER_PLAYWRIGHT_CAPTURE_METHOD,
        }),
      );
    }

    let openApiMetadataResult: ReturnType<typeof normalizeOpenApiMetadata> | { skipped: true };
    let openApiMetadataManifest: string | null = null;
    if (metadataRefreshDue(db, syncObservedAt, metadataRefreshDays)) {
      const artifacts = await collectOpenApiMetadata({ observedAt: syncObservedAt });
      openApiMetadataManifest = await persistOpenApiMetadata(artifacts, rawRoot);
      openApiMetadataResult = normalizeOpenApiMetadata(db, { catalog, artifacts });
    } else {
      openApiMetadataResult = { skipped: true };
    }

    const frozenUsage = normalizeSeedUsage(db, { catalog, catalogRaw });
    const detailDocument = parseDatacenterMetadataEvidenceDocument({
      schema_version: 1,
      catalog_id: catalog.catalog_id,
      capture_method: DATACENTER_PLAYWRIGHT_CAPTURE_METHOD,
      entries: captures.map((capture) => ({
        spid: capture.spid,
        grade: capture.grade,
        player_name: capture.player_name,
        observed_at: capture.observed_at,
        source_url: capture.source_url,
        raw_sha256: capture.page_sha256,
        salary: capture.metadata.salary,
        positions: capture.metadata.positions,
        ovr: capture.metadata.ovr,
        stats: capture.metadata.stats,
        traits: capture.metadata.traits,
        clubs: capture.metadata.clubs,
        nations: capture.metadata.nations,
        team_colors: capture.metadata.team_colors,
      })),
    });
    const detail = normalizeDatacenterMetadata(db, {
      catalog,
      document: detailDocument,
      rawByHash: persistedBrowser.rawByHash,
    });

    const matchtype = Number(process.env.FC_MARKET_RANKER_MATCHTYPE ?? DEFAULT_RANKER_MATCHTYPE);
    if (!Number.isInteger(matchtype) || matchtype <= 0) {
      throw new TypeError("FC_MARKET_RANKER_MATCHTYPE must be a positive integer");
    }
    const targets = rankerStatsTargetsFromDatabase(db, catalog);
    const rankerArtifacts = await collectOpenApiRankerStats(targets, {
      apiKey,
      matchtype,
      observedAt: syncObservedAt,
    });
    const rankerManifest = await persistRankerStats(
      rankerArtifacts,
      rawRoot,
      syncObservedAt,
      matchtype,
    );
    const ranker = normalizeRankerStats(db, rankerArtifacts);

    console.log(
      JSON.stringify(
        {
          status: "SYNCED",
          observed_at: syncObservedAt,
          db_path: dbPath,
          browser_manifest: persistedBrowser.manifestPath,
          openapi_metadata_manifest: openApiMetadataManifest,
          ranker_manifest: rankerManifest,
          browser_captures: captures.length,
          price: {
            source_snapshots_created: priceResults.filter(
              (result) => result.source_snapshot_created,
            ).length,
            price_points_inserted: priceResults.reduce(
              (sum, result) => sum + result.price_points_inserted,
              0,
            ),
          },
          openapi_metadata: openApiMetadataResult,
          frozen_usage: frozenUsage,
          metadata_detail: detail,
          ranker_stats: ranker,
          totals: {
            ...countPriceDatabase(db),
            ...countMetadataUsageDatabase(db),
          },
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
} finally {
  await lock.close().catch(() => undefined);
  await unlink(lockPath).catch(() => undefined);
}
