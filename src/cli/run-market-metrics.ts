import { countAnalysisDatabase, openMarketDatabase } from "../db/market-db.ts";
import { runMarketMetrics } from "../analysis/market-metrics.ts";

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
const db = openMarketDatabase(dbPath);
try {
  const analysisRunId = requestedRun ?? (db.prepare(
    `SELECT analysis_run_id
     FROM analysis_run
     ORDER BY created_at DESC, analysis_run_id DESC
     LIMIT 1`,
  ).get() as { analysis_run_id: string } | undefined)?.analysis_run_id;
  if (!analysisRunId) {
    throw new TypeError("analysis_run is empty; run prepare:analysis first");
  }
  const result = runMarketMetrics(db, analysisRunId);
  console.log(JSON.stringify({
    status: "SUCCEEDED",
    db_path: dbPath,
    ...result,
    totals: countAnalysisDatabase(db),
  }, null, 2));
} finally {
  db.close();
}
