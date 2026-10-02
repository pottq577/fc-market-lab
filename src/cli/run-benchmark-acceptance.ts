import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  resolveBenchmarkAcceptanceAnalysisRunId,
  runBenchmarkAcceptance,
} from "../acceptance/benchmark-acceptance.ts";
import { openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const requireComplete = args.includes("--require-complete");
const db = openMarketDatabase(dbPath);
try {
  const analysisRunId = resolveBenchmarkAcceptanceAnalysisRunId(db, readOption(args, "run"));
  const result = runBenchmarkAcceptance(db, { analysisRunId });
  const outputPath = readOption(args, "output") ??
    `data/exports/acceptance/benchmark-${analysisRunId}.json`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...result, output_path: outputPath }, null, 2));
  if (requireComplete && result.status !== "COMPLETE") process.exitCode = 2;
} finally {
  db.close();
}
