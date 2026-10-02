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
    throw new Error("working tree is dirty; commit Stage 19 before publishing the benchmark");
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
  );
  const result = publishBenchmarkRun(db, {
    benchmarkConvergenceRunId,
    codeCommit: readOption(args, "commit") ?? cleanGitCommit(),
    schemaVersion: MARKET_SCHEMA_VERSION,
  });
  console.log(JSON.stringify({ status: "READY", db_path: dbPath, ...result }, null, 2));
} finally {
  db.close();
}
