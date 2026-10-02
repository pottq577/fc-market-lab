import {
  BENCHMARK_METRIC_VERSION,
  DEFAULT_BENCHMARK_PRICE_SEMANTICS,
  DEFAULT_BENCHMARK_TIMEZONE,
  DEFAULT_MINIMUM_WEIGHTED_COVERAGE,
  resolveBenchmarkMetricAnalysisCutoff,
  resolveBenchmarkMetricPanelFamilyId,
  runBenchmarkMetrics,
} from "../benchmark/metrics.ts";
import { openMarketDatabase } from "../db/market-db.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function coverage(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MINIMUM_WEIGHTED_COVERAGE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new TypeError("--min-weighted-coverage must be > 0 and <= 1");
  }
  return parsed;
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const requestedFamily = readOption(args, "family");
const requestedCutoff = readOption(args, "analysis-cutoff");
const metricVersion = readOption(args, "metric-version") ?? BENCHMARK_METRIC_VERSION;
const timezone = readOption(args, "timezone") ?? DEFAULT_BENCHMARK_TIMEZONE;
const priceSemantics =
  readOption(args, "price-semantics") ?? DEFAULT_BENCHMARK_PRICE_SEMANTICS;
const minimumWeightedCoverage = coverage(
  readOption(args, "min-weighted-coverage"),
);
const createdAt = readOption(args, "created-at");

const db = openMarketDatabase(dbPath);
try {
  const panelFamilyId = resolveBenchmarkMetricPanelFamilyId(db, requestedFamily);
  const analysisCutoff =
    requestedCutoff ??
    resolveBenchmarkMetricAnalysisCutoff(db, panelFamilyId, priceSemantics);
  const result = runBenchmarkMetrics(db, {
    panelFamilyId,
    analysisCutoff,
    metricVersion,
    timezone,
    priceSemantics,
    minimumWeightedCoverage,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });
  console.log(
    JSON.stringify(
      {
        status: "READY",
        db_path: dbPath,
        ...result,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
