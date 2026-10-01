import { openMarketDatabase } from "../db/market-db.ts";
import { runEventReplay } from "../analysis/event-replay.ts";
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
    `SELECT ar.analysis_run_id
     FROM analysis_run ar
     JOIN dataset_snapshot ds ON ds.dataset_snapshot_id = ar.dataset_snapshot_id
     WHERE ar.status = 'SUCCEEDED'
       AND ar.result_hash IS NOT NULL
       AND ds.schema_version >= 7
     ORDER BY ar.created_at DESC, ar.analysis_run_id DESC
     LIMIT 1`,
  ).get() as { analysis_run_id: string } | undefined)?.analysis_run_id;
  if (!analysisRunId) {
    throw new TypeError(
      "no replay-ready analysis run exists; run prepare:analysis and run:metrics first",
    );
  }
  const result = runEventReplay(db, analysisRunId);
  console.log(JSON.stringify({
    status: "SUCCEEDED",
    db_path: dbPath,
    ...result,
  }, null, 2));
} finally {
  db.close();
}
