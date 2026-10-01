import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

import { createAnalysisRun, createDatasetSnapshot, resolveLatestAnalysisCutoff } from "../analysis/run-context.ts";
import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import { MARKET_SCHEMA_VERSION, countAnalysisDatabase, openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function cleanGitCommit(): string {
  const status = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
  }).trim();
  if (status !== "") {
    throw new Error(
      "working tree is dirty; commit the analysis implementation first or pass --commit explicitly",
    );
  }
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const catalogPath = readOption(args, "catalog") ?? "data/catalog/seed-catalog.json";
const parametersPath = readOption(args, "parameters") ?? "data/analysis/analysis-parameters.json";
const analysisVersion = readOption(args, "analysis-version") ?? "poc-analysis-v1";
const catalog = parseSeedCatalogDocument(
  JSON.parse(await readFile(catalogPath, "utf8")),
);
const parameters = JSON.parse(await readFile(parametersPath, "utf8")) as unknown;
const db = openMarketDatabase(dbPath);
try {
  const analysisCutoff = readOption(args, "cutoff") ?? resolveLatestAnalysisCutoff(db);
  const snapshot = createDatasetSnapshot(db, catalog, {
    analysisCutoff,
    schemaVersion: MARKET_SCHEMA_VERSION,
  });
  const run = createAnalysisRun(db, {
    datasetSnapshotId: snapshot.dataset_snapshot_id,
    analysisVersion,
    parameters,
    codeCommit: readOption(args, "commit") ?? cleanGitCommit(),
  });
  console.log(JSON.stringify({
    status: "READY",
    db_path: dbPath,
    catalog_path: catalogPath,
    parameters_path: parametersPath,
    analysis_version: analysisVersion,
    snapshot,
    run,
    totals: countAnalysisDatabase(db),
  }, null, 2));
} finally {
  db.close();
}
