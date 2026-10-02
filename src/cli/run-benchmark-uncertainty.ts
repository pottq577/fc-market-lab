import {
  BENCHMARK_UNCERTAINTY_VERSION,
  DEFAULT_BOOTSTRAP_CONFIDENCE_LEVEL,
  DEFAULT_BOOTSTRAP_REPLICATES,
  DEFAULT_BOOTSTRAP_SAMPLE_SEED,
  DEFAULT_MINIMUM_VALID_REPLICATE_RATIO,
  resolveBenchmarkMetricRunId,
  runBenchmarkUncertainty,
} from "../benchmark/uncertainty.ts";
import { openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function integerOption(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`--${name} must be a positive integer`);
  }
  return parsed;
}

function ratioOption(
  value: string | undefined,
  fallback: number,
  name: string,
  allowOne: boolean,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  const upperOk = allowOne ? parsed <= 1 : parsed < 1;
  if (!Number.isFinite(parsed) || parsed <= 0 || !upperOk) {
    throw new TypeError(`--${name} must be > 0 and ${allowOne ? "<= 1" : "< 1"}`);
  }
  return parsed;
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const requestedMetricRun = readOption(args, "metric-run");
const uncertaintyVersion =
  readOption(args, "uncertainty-version") ?? BENCHMARK_UNCERTAINTY_VERSION;
const replicates = integerOption(
  readOption(args, "replicates"),
  DEFAULT_BOOTSTRAP_REPLICATES,
  "replicates",
);
const confidenceLevel = ratioOption(
  readOption(args, "confidence-level"),
  DEFAULT_BOOTSTRAP_CONFIDENCE_LEVEL,
  "confidence-level",
  false,
);
const sampleSeed = readOption(args, "sample-seed") ?? DEFAULT_BOOTSTRAP_SAMPLE_SEED;
const minimumValidReplicateRatio = ratioOption(
  readOption(args, "min-valid-replicate-ratio"),
  DEFAULT_MINIMUM_VALID_REPLICATE_RATIO,
  "min-valid-replicate-ratio",
  true,
);
const createdAt = readOption(args, "created-at");

const db = openMarketDatabase(dbPath);
try {
  const benchmarkMetricRunId = resolveBenchmarkMetricRunId(db, requestedMetricRun);
  const result = runBenchmarkUncertainty(db, {
    benchmarkMetricRunId,
    uncertaintyVersion,
    replicates,
    confidenceLevel,
    sampleSeed,
    minimumValidReplicateRatio,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });
  console.log(JSON.stringify({ status: "READY", db_path: dbPath, ...result }, null, 2));
} finally {
  db.close();
}
