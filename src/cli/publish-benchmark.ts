import { execFileSync } from "node:child_process";

import {
  publishBenchmarkRun,
  resolveBenchmarkConvergenceRunId,
} from "../benchmark/publication.ts";
import { MARKET_SCHEMA_VERSION, openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function cleanGitCommit(): string {
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  if (status !== "") {
    throw new Error("working tree is dirty; commit benchmark changes before publishing");
  }
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const db = openMarketDatabase(dbPath);
try {
  const benchmarkConvergenceRunId = resolveBenchmarkConvergenceRunId(
    db,
    readOption(args, "convergence-run"),
    readOption(args, "convergence-version"),
  );
  const result = publishBenchmarkRun(db, {
    benchmarkConvergenceRunId,
    codeCommit: readOption(args, "commit") ?? cleanGitCommit(),
    schemaVersion: MARKET_SCHEMA_VERSION,
    ...(readOption(args, "analysis-version") !== undefined
      ? { analysisVersion: readOption(args, "analysis-version") }
      : {}),
    ...(readOption(args, "catalog-id") !== undefined
      ? { catalogId: readOption(args, "catalog-id") }
      : {}),
  });
  console.log(JSON.stringify({ status: "READY", db_path: dbPath, ...result }, null, 2));
} finally {
  db.close();
}
