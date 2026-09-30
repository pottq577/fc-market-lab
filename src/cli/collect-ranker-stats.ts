import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readFile } from "node:fs/promises";
import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import {
  collectOpenApiRankerStats,
  DEFAULT_RANKER_MATCHTYPE,
  rankerStatsTargetsFromDatabase,
} from "../collect/openapi-ranker-stats.ts";
import { openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function fileTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

const args = process.argv.slice(2);
const catalogPath =
  readOption(args, "catalog") ?? "data/catalog/seed-catalog.json";
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const rawDir = readOption(args, "raw-dir") ?? "data/raw/openapi-ranker-stats";
const manifestPath = readOption(args, "manifest") ?? join(rawDir, "latest.json");
const matchtype = Number(readOption(args, "matchtype") ?? DEFAULT_RANKER_MATCHTYPE);
const apiKey = process.env.NEXON_OPEN_API_KEY ?? "";
if (apiKey.trim() === "") {
  throw new TypeError("NEXON_OPEN_API_KEY environment variable is required");
}

const catalog = parseSeedCatalogDocument(
  JSON.parse(await readFile(catalogPath, "utf8")),
);
const db = openMarketDatabase(dbPath);
let targets;
try {
  targets = rankerStatsTargetsFromDatabase(db, catalog);
} finally {
  db.close();
}

const observedAt = new Date().toISOString();
const artifacts = await collectOpenApiRankerStats(targets, {
  apiKey,
  matchtype,
  observedAt,
});
const dateDir = join(rawDir, observedAt.slice(0, 10));
await mkdir(dateDir, { recursive: true });
const manifestArtifacts = [];
for (let index = 0; index < artifacts.length; index += 1) {
  const artifact = artifacts[index]!;
  const path = join(
    dateDir,
    `ranker-stats-${fileTimestamp(observedAt)}-${index + 1}.json`,
  );
  await writeFile(path, artifact.raw);
  manifestArtifacts.push({
    path,
    source_url: artifact.source_url,
    targets: artifact.targets,
  });
}

const manifest = {
  schema_version: 1,
  observed_at: observedAt,
  matchtype,
  artifacts: manifestArtifacts,
};
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ status: "COLLECTED", manifest_path: manifestPath, ...manifest }, null, 2));
