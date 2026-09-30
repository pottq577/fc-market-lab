import { readFile } from "node:fs/promises";

import type { RankerStatsArtifact, RankerStatsTarget } from "../collect/openapi-ranker-stats.ts";
import { countMetadataUsageDatabase, openMarketDatabase } from "../db/market-db.ts";
import { normalizeRankerStats } from "../normalize/ranker-stats.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTarget(value: unknown, context: string): RankerStatsTarget {
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const spid = String(value.spid ?? "");
  const position_code = Number(value.position_code);
  if (!/^\d+$/.test(spid) || !Number.isInteger(position_code) || position_code < 0) {
    throw new TypeError(`${context} is invalid`);
  }
  return { spid, position_code };
}

const args = process.argv.slice(2);
const manifestPath =
  readOption(args, "manifest") ?? "data/raw/openapi-ranker-stats/latest.json";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
if (!isRecord(manifest) || manifest.schema_version !== 1) {
  throw new TypeError("ranker stats manifest schema_version must be 1");
}
if (typeof manifest.observed_at !== "string" || Number.isNaN(Date.parse(manifest.observed_at))) {
  throw new TypeError("ranker stats manifest observed_at must be a timestamp");
}
if (!Number.isInteger(manifest.matchtype) || (manifest.matchtype as number) <= 0) {
  throw new TypeError("ranker stats manifest matchtype must be a positive integer");
}
if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
  throw new TypeError("ranker stats manifest artifacts must be a non-empty array");
}

const artifacts: RankerStatsArtifact[] = [];
for (let index = 0; index < manifest.artifacts.length; index += 1) {
  const item = manifest.artifacts[index];
  const context = `manifest.artifacts[${index}]`;
  if (!isRecord(item) || typeof item.path !== "string" || typeof item.source_url !== "string") {
    throw new TypeError(`${context} is invalid`);
  }
  if (!Array.isArray(item.targets) || item.targets.length === 0) {
    throw new TypeError(`${context}.targets must be a non-empty array`);
  }
  artifacts.push({
    source_url: item.source_url,
    observed_at: manifest.observed_at,
    matchtype: manifest.matchtype as number,
    targets: item.targets.map((target, targetIndex) =>
      parseTarget(target, `${context}.targets[${targetIndex}]`),
    ),
    raw: await readFile(item.path),
  });
}

const db = openMarketDatabase(dbPath);
try {
  const result = normalizeRankerStats(db, artifacts);
  console.log(
    JSON.stringify(
      {
        status: "INGESTED",
        db_path: dbPath,
        manifest_path: manifestPath,
        ...result,
        totals: countMetadataUsageDatabase(db),
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
