import {
  BENCHMARK_SIGNAL_CANDIDATE_VERSION,
  DEFAULT_CANDIDATE_DIRECTION_MATCH_RATIO_MIN,
  DEFAULT_CANDIDATE_MINIMUM_COMMON_VALID_DAYS,
  DEFAULT_CANDIDATE_RETURN_MEDIAN_ABS_DIFF_MAX,
  DEFAULT_CANDIDATE_RETURN_P95_ABS_DIFF_MAX,
  DEFAULT_MOVER_WINSOR_RATIO,
  resolveBenchmarkSignalDiagnosticRunId,
  runBenchmarkSignalCandidates,
} from "../benchmark/signal-candidates.ts";
import { openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(
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
const requestedDiagnosticRun = readOption(args, "diagnostic-run");
const evaluationVersion =
  readOption(args, "evaluation-version") ?? BENCHMARK_SIGNAL_CANDIDATE_VERSION;
const moverWinsorRatio = numberOption(
  readOption(args, "mover-winsor-ratio"),
  DEFAULT_MOVER_WINSOR_RATIO,
  "mover-winsor-ratio",
);
const minimumCommonValidDays = numberOption(
  readOption(args, "min-common-valid-days"),
  DEFAULT_CANDIDATE_MINIMUM_COMMON_VALID_DAYS,
  "min-common-valid-days",
);
const returnMedianAbsDiffMax = numberOption(
  readOption(args, "max-return-median-abs-diff"),
  DEFAULT_CANDIDATE_RETURN_MEDIAN_ABS_DIFF_MAX,
  "max-return-median-abs-diff",
);
const returnP95AbsDiffMax = numberOption(
  readOption(args, "max-return-p95-abs-diff"),
  DEFAULT_CANDIDATE_RETURN_P95_ABS_DIFF_MAX,
  "max-return-p95-abs-diff",
);
const directionMatchRatioMin = numberOption(
  readOption(args, "min-direction-match-ratio"),
  DEFAULT_CANDIDATE_DIRECTION_MATCH_RATIO_MIN,
  "min-direction-match-ratio",
);
const createdAt = readOption(args, "created-at");

const db = openMarketDatabase(dbPath);
try {
  const benchmarkSignalDiagnosticRunId = resolveBenchmarkSignalDiagnosticRunId(
    db,
    requestedDiagnosticRun,
  );
  const result = runBenchmarkSignalCandidates(db, {
    benchmarkSignalDiagnosticRunId,
    evaluationVersion,
    moverWinsorRatio,
    minimumCommonValidDays,
    returnMedianAbsDiffMax,
    returnP95AbsDiffMax,
    directionMatchRatioMin,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });
  console.log(JSON.stringify({ status: "READY", db_path: dbPath, ...result }, null, 2));
} finally {
  db.close();
}
