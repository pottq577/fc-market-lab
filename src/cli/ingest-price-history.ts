import { readFile } from "node:fs/promises";

import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import { countPriceDatabase, openMarketDatabase } from "../db/market-db.ts";
import { parseGate0BCoverageEvidenceDocument } from "../evidence/coverage-snapshots.ts";
import { indexRawPriceFilesByHash } from "../ingest/raw-price-files.ts";
import { normalizePriceHistorySnapshot } from "../normalize/price-history.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function instrumentKey(spid: string, grade: number): string {
  return `${spid}:${grade}`;
}

const args = process.argv.slice(2);
const catalogPath =
  readOption(args, "catalog") ?? "data/catalog/seed-catalog.json";
const coverageEvidencePath =
  readOption(args, "coverage-evidence") ??
  "data/evidence/gate-0b-price-coverage.json";
const rawDir = readOption(args, "raw-dir") ?? "data/raw/datacenter-price";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const migrationPath =
  readOption(args, "migration") ?? "db/migrations/001_price_history.sql";

const catalog = parseSeedCatalogDocument(
  JSON.parse(await readFile(catalogPath, "utf8")),
);
const coverage = parseGate0BCoverageEvidenceDocument(
  JSON.parse(await readFile(coverageEvidencePath, "utf8")),
);
if (coverage.catalog_id !== catalog.catalog_id) {
  throw new TypeError(
    `coverage evidence catalog_id=${coverage.catalog_id} does not match catalog_id=${catalog.catalog_id}`,
  );
}

const expectedByInstrument = new Map(
  coverage.snapshots.map((snapshot) => [
    instrumentKey(snapshot.spid, snapshot.grade),
    snapshot,
  ]),
);
const rawByHash = await indexRawPriceFilesByHash(rawDir);
const db = openMarketDatabase(dbPath, { migrationPath });

let sourceSnapshotsCreated = 0;
let pricePointsInserted = 0;
const ingested: Array<{
  player_key: string;
  instrument_id: string;
  raw_path: string;
  source_snapshot_created: boolean;
  price_points_inserted: number;
}> = [];

try {
  for (const seed of catalog.seeds) {
    const key = instrumentKey(
      seed.primary_instrument.spid,
      seed.primary_instrument.grade,
    );
    const expected = expectedByInstrument.get(key);
    if (!expected) {
      throw new TypeError(`missing Gate 0B coverage evidence for ${key}`);
    }
    if (!expected.raw_sha256) {
      throw new TypeError(
        `Gate 0B coverage evidence for ${key} has no raw_sha256`,
      );
    }

    const rawFile = rawByHash.get(expected.raw_sha256);
    if (!rawFile) {
      throw new TypeError(
        `raw capture ${expected.raw_sha256} for ${key} was not found under ${rawDir}`,
      );
    }

    const result = normalizePriceHistorySnapshot(db, {
      seed,
      expected,
      raw: rawFile.raw,
      source_id: coverage.source_id,
      capture_method: coverage.capture_method,
    });
    sourceSnapshotsCreated += result.source_snapshot_created ? 1 : 0;
    pricePointsInserted += result.price_points_inserted;
    ingested.push({
      player_key: seed.player_key,
      instrument_id: result.instrument_id,
      raw_path: rawFile.path,
      source_snapshot_created: result.source_snapshot_created,
      price_points_inserted: result.price_points_inserted,
    });
  }

  console.log(
    JSON.stringify(
      {
        status: "INGESTED",
        db_path: dbPath,
        catalog_id: catalog.catalog_id,
        instruments_processed: ingested.length,
        source_snapshots_created: sourceSnapshotsCreated,
        price_points_inserted: pricePointsInserted,
        totals: countPriceDatabase(db),
        ingested,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
