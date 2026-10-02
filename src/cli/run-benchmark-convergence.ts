import {
  BENCHMARK_CONVERGENCE_VERSION,
  DEFAULT_BREADTH_MEDIAN_ABS_DIFF_MAX,
  DEFAULT_DIRECTION_MATCH_RATIO_MIN,
  DEFAULT_MINIMUM_COMMON_VALID_DAYS,
  DEFAULT_RETURN_MEDIAN_ABS_DIFF_MAX,
  DEFAULT_RETURN_P95_ABS_DIFF_MAX,
  resolveBenchmarkUncertaintyRunId,
  runBenchmarkConvergence,
} from "../benchmark/convergence.ts";
import { openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function positiveIntegerOption(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`--${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeOption(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new TypeError(`--${name} must be a finite non-negative number`);
  }
  return parsed;
}

function ratioOption(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new TypeError(`--${name} must be between 0 and 1`);
  }
  return parsed;
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const requestedUncertaintyRun = readOption(args, "uncertainty-run");
const convergenceVersion =
  readOption(args, "convergence-version") ?? BENCHMARK_CONVERGENCE_VERSION;
const minimumCommonValidDays = positiveIntegerOption(
  readOption(args, "min-common-valid-days"),
  DEFAULT_MINIMUM_COMMON_VALID_DAYS,
  "min-common-valid-days",
);
const returnMedianAbsDiffMax = nonNegativeOption(
  readOption(args, "max-return-median-abs-diff"),
  DEFAULT_RETURN_MEDIAN_ABS_DIFF_MAX,
  "max-return-median-abs-diff",
);
const returnP95AbsDiffMax = nonNegativeOption(
  readOption(args, "max-return-p95-abs-diff"),
  DEFAULT_RETURN_P95_ABS_DIFF_MAX,
  "max-return-p95-abs-diff",
);
const directionMatchRatioMin = ratioOption(
  readOption(args, "min-direction-match-ratio"),
  DEFAULT_DIRECTION_MATCH_RATIO_MIN,
  "min-direction-match-ratio",
);
const breadthMedianAbsDiffMax = nonNegativeOption(
  readOption(args, "max-breadth-median-abs-diff"),
  DEFAULT_BREADTH_MEDIAN_ABS_DIFF_MAX,
  "max-breadth-median-abs-diff",
);
const createdAt = readOption(args, "created-at");

const db = openMarketDatabase(dbPath);
try {
  const benchmarkUncertaintyRunId = resolveBenchmarkUncertaintyRunId(
    db,
    requestedUncertaintyRun,
  );
  const result = runBenchmarkConvergence(db, {
    benchmarkUncertaintyRunId,
    convergenceVersion,
    minimumCommonValidDays,
    returnMedianAbsDiffMax,
    returnP95AbsDiffMax,
    directionMatchRatioMin,
    breadthMedianAbsDiffMax,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });
  console.log(JSON.stringify({ status: "READY", db_path: dbPath, ...result }, null, 2));
} finally {
  db.close();
}
