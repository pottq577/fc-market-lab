import type { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_BENCHMARK_PRICE_SEMANTICS,
  DEFAULT_BENCHMARK_TIMEZONE,
  DEFAULT_MINIMUM_WEIGHTED_COVERAGE,
  BENCHMARK_METRIC_V2_VERSION,
  runBenchmarkMetrics,
} from "../benchmark/metrics.ts";
import {
  BENCHMARK_UNCERTAINTY_V2_VERSION,
  DEFAULT_BOOTSTRAP_CONFIDENCE_LEVEL,
  DEFAULT_BOOTSTRAP_REPLICATES,
  DEFAULT_BOOTSTRAP_SAMPLE_SEED,
  DEFAULT_MINIMUM_VALID_REPLICATE_RATIO,
  runBenchmarkUncertainty,
} from "../benchmark/uncertainty.ts";
import {
  DEFAULT_BREADTH_MEDIAN_ABS_DIFF_MAX,
  runBenchmarkConvergence,
} from "../benchmark/convergence.ts";
import { openMarketDatabase } from "../db/market-db.ts";

const REFINEMENT_PANEL_SIZES = [
  200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800,
] as const;
const REFINEMENT_PANEL_SIZES_JSON = JSON.stringify(REFINEMENT_PANEL_SIZES);
const BENCHMARK_V2_CONVERGENCE_VERSION =
  "market-benchmark-convergence-v2-weighted-mean";
const EXPECTED_SELECTED_PANEL_SIZE = 300;
const PARITY_TOLERANCE = 1e-12;

interface SourceCandidateRun {
  benchmark_signal_candidate_run_id: string;
  panel_family_id: string;
  analysis_cutoff: string;
  timezone: string;
  price_semantics: string;
  minimum_weighted_coverage: number;
  minimum_common_valid_days: number | bigint;
  return_median_abs_diff_max: number;
  return_p95_abs_diff_max: number;
  direction_match_ratio_min: number;
}

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

function sourceCandidateRun(
  db: DatabaseSync,
  requested?: string,
): SourceCandidateRun {
  const select = `SELECT
      bscr.benchmark_signal_candidate_run_id,
      bscr.panel_family_id,
      bmr.analysis_cutoff,
      bmr.timezone,
      bmr.price_semantics,
      bmr.minimum_weighted_coverage,
      bscr.minimum_common_valid_days,
      bscr.return_median_abs_diff_max,
      bscr.return_p95_abs_diff_max,
      bscr.direction_match_ratio_min
    FROM benchmark_signal_candidate_run bscr
    JOIN benchmark_metric_run bmr
      ON bmr.benchmark_metric_run_id = bscr.benchmark_metric_run_id
    JOIN benchmark_panel_family bpf
      ON bpf.panel_family_id = bscr.panel_family_id
    WHERE bscr.status = 'SUCCEEDED'
      AND bpf.panel_sizes_json = ?`;

  if (requested !== undefined) {
    const value = requested.trim();
    if (value === "") throw new TypeError("--candidate-run must not be empty");
    const row = db.prepare(
      `${select} AND bscr.benchmark_signal_candidate_run_id = ?`,
    ).get(REFINEMENT_PANEL_SIZES_JSON, value) as SourceCandidateRun | undefined;
    if (!row) {
      throw new TypeError(
        `signal candidate run ${value} is not the dense refinement family`,
      );
    }
    return row;
  }

  const row = db.prepare(
    `${select}
     ORDER BY bscr.created_at DESC, bscr.benchmark_signal_candidate_run_id DESC
     LIMIT 1`,
  ).get(REFINEMENT_PANEL_SIZES_JSON) as SourceCandidateRun | undefined;
  if (!row) {
    throw new TypeError(
      "no dense refinement signal candidate run exists; run benchmark:panel-refinement first",
    );
  }
  return row;
}

function weightedMeanParity(
  db: DatabaseSync,
  candidateRunId: string,
  metricRunId: string,
): { compared_rows: number; mismatch_rows: number; max_abs_diff: number } {
  const rows = db.prepare(
    `SELECT bm.metric_date, bm.panel_id, bm.status AS metric_status,
            bm.value AS metric_value,
            bscm.status AS candidate_status,
            bscm.weighted_mean AS candidate_value
     FROM benchmark_metric bm
     LEFT JOIN benchmark_signal_candidate_metric bscm
       ON bscm.benchmark_signal_candidate_run_id = ?
      AND bscm.panel_id = bm.panel_id
      AND bscm.metric_date = bm.metric_date
     WHERE bm.benchmark_metric_run_id = ?
       AND bm.metric_name = 'RETURN_1D'
     ORDER BY bm.panel_id, bm.metric_date`,
  ).all(candidateRunId, metricRunId) as Array<{
    metric_date: string;
    panel_id: string;
    metric_status: "OK" | "NO_RESULT";
    metric_value: number | null;
    candidate_status: "OK" | "ZERO_ACTIVITY" | "BASE_NO_RESULT" | null;
    candidate_value: number | null;
  }>;

  if (rows.length === 0) {
    throw new TypeError(`metric run ${metricRunId} has no RETURN_1D rows`);
  }

  let mismatchRows = 0;
  let maxAbsDiff = 0;
  for (const row of rows) {
    if (row.metric_status === "NO_RESULT") {
      if (row.candidate_status !== "BASE_NO_RESULT") mismatchRows += 1;
      continue;
    }
    if (
      row.candidate_status === null ||
      row.candidate_status === "BASE_NO_RESULT" ||
      row.metric_value === null ||
      row.candidate_value === null
    ) {
      mismatchRows += 1;
      continue;
    }
    const diff = Math.abs(row.metric_value - row.candidate_value);
    maxAbsDiff = Math.max(maxAbsDiff, diff);
    if (diff > PARITY_TOLERANCE) mismatchRows += 1;
  }
  return {
    compared_rows: rows.length,
    mismatch_rows: mismatchRows,
    max_abs_diff: Number(maxAbsDiff.toFixed(12)),
  };
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const requestedCandidateRun = readOption(args, "candidate-run");
const createdAt = readOption(args, "created-at");
const replicates = positiveIntegerOption(
  readOption(args, "replicates"),
  DEFAULT_BOOTSTRAP_REPLICATES,
  "replicates",
);

const db = openMarketDatabase(dbPath);
try {
  const source = sourceCandidateRun(db, requestedCandidateRun);
  const metric = runBenchmarkMetrics(db, {
    panelFamilyId: source.panel_family_id,
    analysisCutoff: source.analysis_cutoff,
    metricVersion: BENCHMARK_METRIC_V2_VERSION,
    timezone: source.timezone ?? DEFAULT_BENCHMARK_TIMEZONE,
    priceSemantics: source.price_semantics ?? DEFAULT_BENCHMARK_PRICE_SEMANTICS,
    minimumWeightedCoverage:
      source.minimum_weighted_coverage ?? DEFAULT_MINIMUM_WEIGHTED_COVERAGE,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });

  const parity = weightedMeanParity(
    db,
    source.benchmark_signal_candidate_run_id,
    metric.benchmark_metric_run_id,
  );
  if (parity.mismatch_rows !== 0) {
    throw new TypeError(
      `v2 weighted mean differs from candidate evaluation in ${parity.mismatch_rows} rows`,
    );
  }

  const uncertainty = runBenchmarkUncertainty(db, {
    benchmarkMetricRunId: metric.benchmark_metric_run_id,
    uncertaintyVersion: BENCHMARK_UNCERTAINTY_V2_VERSION,
    replicates,
    confidenceLevel: DEFAULT_BOOTSTRAP_CONFIDENCE_LEVEL,
    sampleSeed: DEFAULT_BOOTSTRAP_SAMPLE_SEED,
    minimumValidReplicateRatio: DEFAULT_MINIMUM_VALID_REPLICATE_RATIO,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });

  const convergence = runBenchmarkConvergence(db, {
    benchmarkUncertaintyRunId: uncertainty.benchmark_uncertainty_run_id,
    convergenceVersion: BENCHMARK_V2_CONVERGENCE_VERSION,
    minimumCommonValidDays: Number(source.minimum_common_valid_days),
    returnMedianAbsDiffMax: source.return_median_abs_diff_max,
    returnP95AbsDiffMax: source.return_p95_abs_diff_max,
    directionMatchRatioMin: source.direction_match_ratio_min,
    breadthMedianAbsDiffMax: DEFAULT_BREADTH_MEDIAN_ABS_DIFF_MAX,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });

  const ready =
    convergence.benchmark_status === "STABLE" &&
    convergence.selected_panel_size === EXPECTED_SELECTED_PANEL_SIZE;

  console.log(JSON.stringify({
    status: "READY",
    db_path: dbPath,
    decision_gate: ready ? "READY_FOR_V2_PUBLICATION" : "REVIEW_REQUIRED",
    expected_return_aggregation: "WEIGHTED_MEAN_PLAYER_RETURN",
    expected_selected_panel_size: EXPECTED_SELECTED_PANEL_SIZE,
    source_candidate_run_id: source.benchmark_signal_candidate_run_id,
    panel_family_id: source.panel_family_id,
    benchmark_metric_run_id: metric.benchmark_metric_run_id,
    metric_version: metric.metric_version,
    weighted_mean_parity: parity,
    benchmark_uncertainty_run_id: uncertainty.benchmark_uncertainty_run_id,
    uncertainty_version: uncertainty.uncertainty_version,
    benchmark_convergence_run_id: convergence.benchmark_convergence_run_id,
    convergence_version: convergence.convergence_version,
    benchmark_status: convergence.benchmark_status,
    selected_panel_id: convergence.selected_panel_id,
    selected_panel_label: convergence.selected_panel_label,
    selected_panel_size: convergence.selected_panel_size,
    pairs: convergence.pairs,
    created: {
      metric_run: metric.created,
      uncertainty_run: uncertainty.created,
      convergence_run: convergence.created,
    },
  }, null, 2));
} finally {
  db.close();
}
