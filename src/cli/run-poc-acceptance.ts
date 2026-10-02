import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { runPocAcceptance } from "../acceptance/poc-acceptance.ts";
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
const requestedRun = readOption(args, "run");
const requireComplete = args.includes("--require-complete");
const db = openMarketDatabase(dbPath);

try {
  const analysisRunId = requestedRun ?? (db.prepare(
    `SELECT ar.analysis_run_id
     FROM analysis_run ar
     WHERE EXISTS (
       SELECT 1 FROM analysis_metric am
       WHERE am.analysis_run_id = ar.analysis_run_id
     )
     ORDER BY ar.created_at DESC, ar.analysis_run_id DESC
     LIMIT 1`,
  ).get() as { analysis_run_id: string } | undefined)?.analysis_run_id;
  if (!analysisRunId) {
    throw new TypeError("analysis_run is empty; run prepare:analysis first");
  }

  const result = await runPocAcceptance(db, {
    analysisRunId,
    sourceViabilityPath: readOption(args, "source-viability") ?? "data/evidence/source-viability.json",
    catalogPath: readOption(args, "catalog") ?? "data/catalog/seed-catalog.json",
    coverageEvidencePath: readOption(args, "coverage-evidence") ?? "data/evidence/gate-0b-price-coverage.json",
    classAvailabilityPath: readOption(args, "class-availability") ?? "data/evidence/class-market-availability.json",
    packagePath: readOption(args, "package") ?? "package.json",
    analysisModelPath: readOption(args, "analysis-model") ?? "docs/design/analysis-model.md",
  });

  const outputPath = readOption(args, "output") ??
    `data/exports/acceptance/${analysisRunId}.json`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...result, output_path: outputPath }, null, 2));

  if (requireComplete && result.status !== "COMPLETE") {
    process.exitCode = 2;
  }
} finally {
  db.close();
}
