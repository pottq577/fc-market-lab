import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const BENCHMARK_CONVERGENCE_VERSION = "market-benchmark-convergence-v1";
export const DEFAULT_MINIMUM_COMMON_VALID_DAYS = 60;
export const DEFAULT_RETURN_MEDIAN_ABS_DIFF_MAX = 0.0025;
export const DEFAULT_RETURN_P95_ABS_DIFF_MAX = 0.01;
export const DEFAULT_DIRECTION_MATCH_RATIO_MIN = 0.9;
export const DEFAULT_BREADTH_MEDIAN_ABS_DIFF_MAX = 0.05;

export type PanelConvergenceStatus = "PASS" | "FAIL" | "INSUFFICIENT";
export type BenchmarkConvergenceStatus = "STABLE" | "UNSTABLE";

type ComparableMetricName = "RETURN_1D" | "BREADTH";
type BenchmarkPeriodType = "FIXED_PANEL_BACKCAST" | "CONTEMPORANEOUS";

interface UncertaintyRunRow {
  benchmark_uncertainty_run_id: string;
  benchmark_metric_run_id: string;
  input_hash: string;
  result_hash: string;
}

interface MetricRunRow {
  benchmark_metric_run_id: string;
  panel_family_id: string;
  input_hash: string;
  result_hash: string;
}

interface PanelRow {
  panel_id: string;
  panel_label: string;
  panel_size: number | bigint;
}

interface MetricRow {
  panel_id: string;
  metric_date: string;
  period_type: BenchmarkPeriodType;
  metric_name: ComparableMetricName;
  value: number;
}

export interface PanelConvergenceSummary {
  smaller_panel_id: string;
  smaller_panel_label: string;
  smaller_panel_size: number;
  larger_panel_id: string;
  larger_panel_label: string;
  larger_panel_size: number;
  common_valid_return_days: number;
  common_valid_breadth_days: number;
  direction_compared_days: number;
  return_median_abs_diff: number | null;
  return_p95_abs_diff: number | null;
  return_direction_match_ratio: number | null;
  breadth_median_abs_diff: number | null;
  status: PanelConvergenceStatus;
  reasons: string[];
}

export interface RunBenchmarkConvergenceResult {
  benchmark_convergence_run_id: string;
  benchmark_uncertainty_run_id: string;
  benchmark_metric_run_id: string;
  panel_family_id: string;
  convergence_version: string;
  minimum_common_valid_days: number;
  return_median_abs_diff_max: number;
  return_p95_abs_diff_max: number;
  direction_match_ratio_min: number;
  breadth_median_abs_diff_max: number;
  benchmark_status: BenchmarkConvergenceStatus;
  selected_panel_id: string | null;
  selected_panel_label: string | null;
  selected_panel_size: number | null;
  input_hash: string;
  result_hash: string;
  pairs: PanelConvergenceSummary[];
  created: boolean;
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

function canonicalJson(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean" ||
      (typeof input === "number" && Number.isFinite(input))
    ) {
      return input;
    }
    throw new TypeError("benchmark convergence payload must contain finite JSON values");
  }
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

function normalizePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function normalizeNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite non-negative number`);
  }
  return value;
}

function normalizeRatio(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be between 0 and 1`);
  }
  return value;
}

function sampleQuantile(values: number[], probability: number): number {
  if (values.length === 0) throw new TypeError("sample quantile requires values");
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function latestUncertaintyRun(db: DatabaseSync): UncertaintyRunRow {
  const row = db.prepare(
    `SELECT benchmark_uncertainty_run_id, benchmark_metric_run_id,
            input_hash, result_hash
     FROM benchmark_uncertainty_run
     WHERE status = 'SUCCEEDED'
     ORDER BY created_at DESC, benchmark_uncertainty_run_id DESC
     LIMIT 1`,
  ).get() as UncertaintyRunRow | undefined;
  if (!row) throw new TypeError("no benchmark uncertainty run exists");
  return row;
}

export function resolveBenchmarkUncertaintyRunId(
  db: DatabaseSync,
  requested?: string,
): string {
  if (requested === undefined) return latestUncertaintyRun(db).benchmark_uncertainty_run_id;
  const value = requested.trim();
  if (value === "") throw new TypeError("benchmarkUncertaintyRunId must not be empty");
  const row = db.prepare(
    `SELECT benchmark_uncertainty_run_id
     FROM benchmark_uncertainty_run
     WHERE benchmark_uncertainty_run_id = ? AND status = 'SUCCEEDED'`,
  ).get(value) as { benchmark_uncertainty_run_id: string } | undefined;
  if (!row) throw new TypeError(`unknown benchmark uncertainty run: ${value}`);
  return row.benchmark_uncertainty_run_id;
}

function uncertaintyRun(db: DatabaseSync, runId: string): UncertaintyRunRow {
  const row = db.prepare(
    `SELECT benchmark_uncertainty_run_id, benchmark_metric_run_id,
            input_hash, result_hash
     FROM benchmark_uncertainty_run
     WHERE benchmark_uncertainty_run_id = ? AND status = 'SUCCEEDED'`,
  ).get(runId) as UncertaintyRunRow | undefined;
  if (!row) throw new TypeError(`unknown benchmark uncertainty run: ${runId}`);
  return row;
}

function metricRun(db: DatabaseSync, runId: string): MetricRunRow {
  const row = db.prepare(
    `SELECT benchmark_metric_run_id, panel_family_id, input_hash, result_hash
     FROM benchmark_metric_run
     WHERE benchmark_metric_run_id = ? AND status = 'SUCCEEDED'`,
  ).get(runId) as MetricRunRow | undefined;
  if (!row) throw new TypeError(`unknown benchmark metric run: ${runId}`);
  return row;
}

function panels(db: DatabaseSync, panelFamilyId: string): PanelRow[] {
  const rows = db.prepare(
    `SELECT panel_id, panel_label, panel_size
     FROM benchmark_panel
     WHERE panel_family_id = ?
     ORDER BY panel_size, panel_id`,
  ).all(panelFamilyId) as PanelRow[];
  if (rows.length < 3) {
    throw new TypeError(`panel family ${panelFamilyId} requires at least three nested panels`);
  }
  for (let index = 0; index < rows.length; index += 1) {
    const panel = rows[index]!;
    const size = Number(panel.panel_size);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new TypeError(`panel ${panel.panel_id} has invalid panel_size`);
    }
    if (panel.panel_label !== `P${size}`) {
      throw new TypeError(`panel ${panel.panel_id} label does not match panel_size`);
    }
    if (index > 0 && size <= Number(rows[index - 1]!.panel_size)) {
      throw new TypeError(`panel family ${panelFamilyId} panel sizes must increase`);
    }
  }
  return rows;
}

function metricRows(db: DatabaseSync, metricRunId: string): MetricRow[] {
  return db.prepare(
    `SELECT panel_id, metric_date, period_type, metric_name, value
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ?
       AND metric_name IN ('RETURN_1D', 'BREADTH')
       AND status = 'OK'
     ORDER BY panel_id, metric_name, metric_date`,
  ).all(metricRunId) as MetricRow[];
}

function indexMetrics(rows: MetricRow[]): Map<string, Map<ComparableMetricName, Map<string, MetricRow>>> {
  const result = new Map<string, Map<ComparableMetricName, Map<string, MetricRow>>>();
  for (const row of rows) {
    if (!Number.isFinite(row.value)) {
      throw new TypeError(`metric ${row.panel_id} ${row.metric_name} ${row.metric_date} is not finite`);
    }
    let byMetric = result.get(row.panel_id);
    if (!byMetric) {
      byMetric = new Map();
      result.set(row.panel_id, byMetric);
    }
    let byDate = byMetric.get(row.metric_name);
    if (!byDate) {
      byDate = new Map();
      byMetric.set(row.metric_name, byDate);
    }
    byDate.set(row.metric_date, row);
  }
  return result;
}

function compareMetric(
  smaller: Map<string, MetricRow>,
  larger: Map<string, MetricRow>,
): Array<{ smaller: number; larger: number }> {
  const values: Array<{ smaller: number; larger: number }> = [];
  for (const [date, left] of smaller) {
    const right = larger.get(date);
    if (!right) continue;
    if (left.period_type !== right.period_type) {
      throw new TypeError(`panel period_type mismatch on ${date}`);
    }
    values.push({ smaller: left.value, larger: right.value });
  }
  return values;
}

function evaluatePair(
  smaller: PanelRow,
  larger: PanelRow,
  indexed: Map<string, Map<ComparableMetricName, Map<string, MetricRow>>>,
  thresholds: {
    minimumCommonValidDays: number;
    returnMedianAbsDiffMax: number;
    returnP95AbsDiffMax: number;
    directionMatchRatioMin: number;
    breadthMedianAbsDiffMax: number;
  },
): PanelConvergenceSummary {
  const smallerMetrics = indexed.get(smaller.panel_id) ?? new Map();
  const largerMetrics = indexed.get(larger.panel_id) ?? new Map();
  const returns = compareMetric(
    smallerMetrics.get("RETURN_1D") ?? new Map(),
    largerMetrics.get("RETURN_1D") ?? new Map(),
  );
  const breadth = compareMetric(
    smallerMetrics.get("BREADTH") ?? new Map(),
    largerMetrics.get("BREADTH") ?? new Map(),
  );

  const returnDiffs = returns.map((value) => Math.abs(value.smaller - value.larger));
  const breadthDiffs = breadth.map((value) => Math.abs(value.smaller - value.larger));
  const directional = returns.filter(
    (value) => value.smaller !== 0 || value.larger !== 0,
  );
  const directionMatches = directional.filter(
    (value) => Math.sign(value.smaller) === Math.sign(value.larger),
  ).length;

  const returnMedianAbsDiff = returnDiffs.length > 0
    ? round(sampleQuantile(returnDiffs, 0.5))
    : null;
  const returnP95AbsDiff = returnDiffs.length > 0
    ? round(sampleQuantile(returnDiffs, 0.95))
    : null;
  const directionMatchRatio = directional.length > 0
    ? round(directionMatches / directional.length)
    : null;
  const breadthMedianAbsDiff = breadthDiffs.length > 0
    ? round(sampleQuantile(breadthDiffs, 0.5))
    : null;

  const insufficientReasons: string[] = [];
  if (returns.length < thresholds.minimumCommonValidDays) {
    insufficientReasons.push("RETURN_COMMON_VALID_DAYS");
  }
  if (breadth.length < thresholds.minimumCommonValidDays) {
    insufficientReasons.push("BREADTH_COMMON_VALID_DAYS");
  }
  if (directional.length === 0) {
    insufficientReasons.push("DIRECTION_COMPARABLE_DAYS");
  }

  let status: PanelConvergenceStatus;
  let reasons: string[];
  if (insufficientReasons.length > 0) {
    status = "INSUFFICIENT";
    reasons = insufficientReasons;
  } else {
    const failed: string[] = [];
    if (returnMedianAbsDiff! > thresholds.returnMedianAbsDiffMax) {
      failed.push("RETURN_MEDIAN_ABS_DIFF");
    }
    if (returnP95AbsDiff! > thresholds.returnP95AbsDiffMax) {
      failed.push("RETURN_P95_ABS_DIFF");
    }
    if (directionMatchRatio! < thresholds.directionMatchRatioMin) {
      failed.push("RETURN_DIRECTION_MATCH_RATIO");
    }
    if (breadthMedianAbsDiff! > thresholds.breadthMedianAbsDiffMax) {
      failed.push("BREADTH_MEDIAN_ABS_DIFF");
    }
    status = failed.length === 0 ? "PASS" : "FAIL";
    reasons = failed;
  }

  return {
    smaller_panel_id: smaller.panel_id,
    smaller_panel_label: smaller.panel_label,
    smaller_panel_size: Number(smaller.panel_size),
    larger_panel_id: larger.panel_id,
    larger_panel_label: larger.panel_label,
    larger_panel_size: Number(larger.panel_size),
    common_valid_return_days: returns.length,
    common_valid_breadth_days: breadth.length,
    direction_compared_days: directional.length,
    return_median_abs_diff: returnMedianAbsDiff,
    return_p95_abs_diff: returnP95AbsDiff,
    return_direction_match_ratio: directionMatchRatio,
    breadth_median_abs_diff: breadthMedianAbsDiff,
    status,
    reasons,
  };
}

function selectedStablePanel(
  panelRows: PanelRow[],
  pairs: PanelConvergenceSummary[],
): PanelRow | null {
  if (pairs.at(-1)?.status !== "PASS") return null;
  for (let index = 1; index < panelRows.length - 1; index += 1) {
    if (pairs[index - 1]?.status === "PASS" && pairs[index]?.status === "PASS") {
      return panelRows[index]!;
    }
  }
  return null;
}

export function runBenchmarkConvergence(
  db: DatabaseSync,
  input: {
    benchmarkUncertaintyRunId: string;
    convergenceVersion?: string;
    minimumCommonValidDays?: number;
    returnMedianAbsDiffMax?: number;
    returnP95AbsDiffMax?: number;
    directionMatchRatioMin?: number;
    breadthMedianAbsDiffMax?: number;
    createdAt?: string;
  },
): RunBenchmarkConvergenceResult {
  const uncertainty = uncertaintyRun(db, input.benchmarkUncertaintyRunId.trim());
  const metric = metricRun(db, uncertainty.benchmark_metric_run_id);
  const convergenceVersion = input.convergenceVersion ?? BENCHMARK_CONVERGENCE_VERSION;
  if (convergenceVersion.trim() === "") {
    throw new TypeError("convergenceVersion must not be empty");
  }
  const minimumCommonValidDays = normalizePositiveInteger(
    input.minimumCommonValidDays ?? DEFAULT_MINIMUM_COMMON_VALID_DAYS,
    "minimumCommonValidDays",
  );
  const returnMedianAbsDiffMax = normalizeNonNegative(
    input.returnMedianAbsDiffMax ?? DEFAULT_RETURN_MEDIAN_ABS_DIFF_MAX,
    "returnMedianAbsDiffMax",
  );
  const returnP95AbsDiffMax = normalizeNonNegative(
    input.returnP95AbsDiffMax ?? DEFAULT_RETURN_P95_ABS_DIFF_MAX,
    "returnP95AbsDiffMax",
  );
  const directionMatchRatioMin = normalizeRatio(
    input.directionMatchRatioMin ?? DEFAULT_DIRECTION_MATCH_RATIO_MIN,
    "directionMatchRatioMin",
  );
  const breadthMedianAbsDiffMax = normalizeNonNegative(
    input.breadthMedianAbsDiffMax ?? DEFAULT_BREADTH_MEDIAN_ABS_DIFF_MAX,
    "breadthMedianAbsDiffMax",
  );
  const createdAt = input.createdAt ?? new Date().toISOString();

  const panelRows = panels(db, metric.panel_family_id);
  const thresholds = {
    minimumCommonValidDays,
    returnMedianAbsDiffMax,
    returnP95AbsDiffMax,
    directionMatchRatioMin,
    breadthMedianAbsDiffMax,
  };
  const manifest = {
    benchmark_uncertainty_run_id: uncertainty.benchmark_uncertainty_run_id,
    benchmark_uncertainty_input_hash: uncertainty.input_hash,
    benchmark_uncertainty_result_hash: uncertainty.result_hash,
    benchmark_metric_run_id: metric.benchmark_metric_run_id,
    benchmark_metric_input_hash: metric.input_hash,
    benchmark_metric_result_hash: metric.result_hash,
    panel_family_id: metric.panel_family_id,
    convergence_version: convergenceVersion,
    thresholds,
    panels: panelRows.map((panel) => ({
      panel_id: panel.panel_id,
      panel_label: panel.panel_label,
      panel_size: Number(panel.panel_size),
    })),
  };
  const inputHash = sha256(canonicalJson(manifest));
  const convergenceRunId = deterministicId("benchmark_convergence_run", inputHash);
  const indexed = indexMetrics(metricRows(db, metric.benchmark_metric_run_id));
  const pairs: PanelConvergenceSummary[] = [];
  for (let index = 0; index < panelRows.length - 1; index += 1) {
    pairs.push(evaluatePair(panelRows[index]!, panelRows[index + 1]!, indexed, thresholds));
  }

  const selected = selectedStablePanel(panelRows, pairs);
  const benchmarkStatus: BenchmarkConvergenceStatus = selected ? "STABLE" : "UNSTABLE";
  const resultPayload = {
    benchmark_status: benchmarkStatus,
    selected_panel_id: selected?.panel_id ?? null,
    pairs,
  };
  const resultHash = sha256(canonicalJson(resultPayload));

  db.exec("BEGIN IMMEDIATE");
  try {
    const runInsert = db.prepare(
      `INSERT OR IGNORE INTO benchmark_convergence_run(
        benchmark_convergence_run_id, benchmark_uncertainty_run_id,
        benchmark_metric_run_id, panel_family_id, convergence_version,
        minimum_common_valid_days, return_median_abs_diff_max,
        return_p95_abs_diff_max, direction_match_ratio_min,
        breadth_median_abs_diff_max, input_hash, created_at,
        status, benchmark_status, selected_panel_id, result_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?, ?, ?)`,
    ).run(
      convergenceRunId,
      uncertainty.benchmark_uncertainty_run_id,
      metric.benchmark_metric_run_id,
      metric.panel_family_id,
      convergenceVersion,
      minimumCommonValidDays,
      returnMedianAbsDiffMax,
      returnP95AbsDiffMax,
      directionMatchRatioMin,
      breadthMedianAbsDiffMax,
      inputHash,
      createdAt,
      benchmarkStatus,
      selected?.panel_id ?? null,
      resultHash,
    );

    const existing = db.prepare(
      `SELECT input_hash, result_hash, benchmark_status, selected_panel_id
       FROM benchmark_convergence_run
       WHERE benchmark_convergence_run_id = ?`,
    ).get(convergenceRunId) as {
      input_hash: string;
      result_hash: string;
      benchmark_status: string;
      selected_panel_id: string | null;
    };
    if (
      existing.input_hash !== inputHash ||
      existing.result_hash !== resultHash ||
      existing.benchmark_status !== benchmarkStatus ||
      existing.selected_panel_id !== (selected?.panel_id ?? null)
    ) {
      throw new TypeError(`benchmark convergence run identity conflict for ${convergenceRunId}`);
    }

    const insertPair = db.prepare(
      `INSERT OR IGNORE INTO panel_convergence(
        benchmark_convergence_run_id, smaller_panel_id, larger_panel_id,
        smaller_panel_size, larger_panel_size,
        common_valid_return_days, common_valid_breadth_days,
        direction_compared_days, return_median_abs_diff,
        return_p95_abs_diff, return_direction_match_ratio,
        breadth_median_abs_diff, status, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const pair of pairs) {
      insertPair.run(
        convergenceRunId,
        pair.smaller_panel_id,
        pair.larger_panel_id,
        pair.smaller_panel_size,
        pair.larger_panel_size,
        pair.common_valid_return_days,
        pair.common_valid_breadth_days,
        pair.direction_compared_days,
        pair.return_median_abs_diff,
        pair.return_p95_abs_diff,
        pair.return_direction_match_ratio,
        pair.breadth_median_abs_diff,
        pair.status,
        canonicalJson({ reasons: pair.reasons }),
      );
    }

    const persisted = db.prepare(
      `SELECT COUNT(*) AS count
       FROM panel_convergence
       WHERE benchmark_convergence_run_id = ?`,
    ).get(convergenceRunId) as { count: number | bigint };
    if (Number(persisted.count) !== pairs.length) {
      throw new Error(
        `convergence run ${convergenceRunId} persisted ${String(persisted.count)} pairs, expected ${pairs.length}`,
      );
    }
    db.exec("COMMIT");

    return {
      benchmark_convergence_run_id: convergenceRunId,
      benchmark_uncertainty_run_id: uncertainty.benchmark_uncertainty_run_id,
      benchmark_metric_run_id: metric.benchmark_metric_run_id,
      panel_family_id: metric.panel_family_id,
      convergence_version: convergenceVersion,
      minimum_common_valid_days: minimumCommonValidDays,
      return_median_abs_diff_max: returnMedianAbsDiffMax,
      return_p95_abs_diff_max: returnP95AbsDiffMax,
      direction_match_ratio_min: directionMatchRatioMin,
      breadth_median_abs_diff_max: breadthMedianAbsDiffMax,
      benchmark_status: benchmarkStatus,
      selected_panel_id: selected?.panel_id ?? null,
      selected_panel_label: selected?.panel_label ?? null,
      selected_panel_size: selected ? Number(selected.panel_size) : null,
      input_hash: inputHash,
      result_hash: resultHash,
      pairs,
      created: Number(runInsert.changes) === 1,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
