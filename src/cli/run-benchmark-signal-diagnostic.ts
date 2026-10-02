import {
  BENCHMARK_SIGNAL_DIAGNOSTIC_VERSION,
  DEFAULT_SIGNAL_TRIM_RATIO,
  DEFAULT_ZERO_DOMINANCE_THRESHOLD,
  resolveBenchmarkSignalMetricRunId,
  runBenchmarkSignalDiagnostic,
} from "../benchmark/signal-diagnostic.ts";
import { openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function ratioOption(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`--${name} must be numeric`);
  return parsed;
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const requestedMetricRun = readOption(args, "metric-run");
const diagnosticVersion =
  readOption(args, "diagnostic-version") ?? BENCHMARK_SIGNAL_DIAGNOSTIC_VERSION;
const trimRatio = ratioOption(
  readOption(args, "trim-ratio"),
  DEFAULT_SIGNAL_TRIM_RATIO,
  "trim-ratio",
);
const zeroDominanceThreshold = ratioOption(
  readOption(args, "zero-dominance-threshold"),
  DEFAULT_ZERO_DOMINANCE_THRESHOLD,
  "zero-dominance-threshold",
);
const createdAt = readOption(args, "created-at");

const db = openMarketDatabase(dbPath);
try {
  const benchmarkMetricRunId = resolveBenchmarkSignalMetricRunId(db, requestedMetricRun);
  const result = runBenchmarkSignalDiagnostic(db, {
    benchmarkMetricRunId,
    diagnosticVersion,
    trimRatio,
    zeroDominanceThreshold,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });
  console.log(JSON.stringify({ status: "READY", db_path: dbPath, ...result }, null, 2));
} finally {
  db.close();
}
