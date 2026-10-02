import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const BENCHMARK_SIGNAL_DIAGNOSTIC_VERSION = "market-benchmark-signal-diagnostic-v1";
export const DEFAULT_SIGNAL_TRIM_RATIO = 0.1;
export const DEFAULT_ZERO_DOMINANCE_THRESHOLD = 0.5;

const ZERO_EPSILON = 1e-12;
const MINIMUM_CLASSIFICATION_DAYS = 60;
const MEDIAN_ZERO_COLLAPSE_RATIO = 0.8;
const ALTERNATIVE_SIGNAL_MIN_RATIO = 0.2;

type BenchmarkPeriodType = "FIXED_PANEL_BACKCAST" | "CONTEMPORANEOUS";
type BaseStatus = "OK" | "NO_RESULT";

interface MetricRunRow {
  benchmark_metric_run_id: string;
  panel_family_id: string;
  timezone: string;
  input_hash: string;
  result_hash: string;
}

interface PanelRow {
  panel_id: string;
  panel_label: string;
  panel_size: number | bigint;
}

interface MemberRow {
  panel_id: string;
  player_id: string;
  anchor_instrument_id: string;
  population_weight: number;
}

interface FrozenPriceRow {
  instrument_id: string;
  source_snapshot_id: string;
  source_timestamp: string;
  observed_at: string;
  value: number | null;
  quality_status: string;
}

interface BaseReturnRow {
  panel_id: string;
  metric_date: string;
  period_type: BenchmarkPeriodType;
  value: number | null;
  status: BaseStatus;
  valid_count: number | bigint;
  total_count: number | bigint;
  valid_weight: number;
  total_weight: number;
  weighted_coverage: number;
}

interface WeightedValue {
  value: number;
  weight: number;
}

interface DiagnosticRow {
  panel_id: string;
  metric_date: string;
  period_type: BenchmarkPeriodType;
  base_status: BaseStatus;
  base_point_value: number | null;
  valid_count: number;
  total_count: number;
  valid_weight: number;
  total_weight: number;
  weighted_coverage: number;
  zero_count: number;
  positive_count: number;
  negative_count: number;
  zero_weight_ratio: number | null;
  positive_weight_ratio: number | null;
  negative_weight_ratio: number | null;
  weighted_median: number | null;
  weighted_mean: number | null;
  weighted_trimmed_mean: number | null;
}

export type SignalDiagnosticClassification =
  | "ZERO_INFLATED_MEDIAN_COLLAPSE"
  | "LOW_DIRECTIONAL_VARIATION"
  | "MEDIAN_RETAINS_DIRECTIONAL_SIGNAL"
  | "INSUFFICIENT_OK_DAYS";

export interface SignalDiagnosticPanelSummary {
  panel_id: string;
  panel_label: string;
  panel_size: number;
  diagnostic_dates: number;
  ok_dates: number;
  no_result_dates: number;
  zero_dominated_dates: number;
  median_zero_dates: number;
  mean_nonzero_dates: number;
  trimmed_mean_nonzero_dates: number;
  median_zero_but_mean_nonzero_dates: number;
  median_zero_ratio: number | null;
  mean_nonzero_ratio: number | null;
  trimmed_mean_nonzero_ratio: number | null;
  average_zero_weight_ratio: number | null;
  classification: SignalDiagnosticClassification;
}

export interface RunBenchmarkSignalDiagnosticResult {
  benchmark_signal_diagnostic_run_id: string;
  benchmark_metric_run_id: string;
  panel_family_id: string;
  diagnostic_version: string;
  trim_ratio: number;
  zero_dominance_threshold: number;
  input_hash: string;
  result_hash: string;
  diagnostic_rows: number;
  panels: SignalDiagnosticPanelSummary[];
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
    throw new TypeError("benchmark signal diagnostic payload must contain finite JSON values");
  }
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeRatio(
  value: number,
  field: string,
  upperExclusive: boolean,
): number {
  const upperOk = upperExclusive ? value < 1 : value <= 1;
  if (!Number.isFinite(value) || value < 0 || !upperOk) {
    throw new TypeError(
      `${field} must be >= 0 and ${upperExclusive ? "< 1" : "<= 1"}`,
    );
  }
  return value;
}

function dateInTimezone(timestamp: string, timezone: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`invalid timestamp: ${timestamp}`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");
  if (!year || !month || !day) throw new TypeError(`cannot format date in ${timezone}`);
  return `${year}-${month}-${day}`;
}

function previousDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function isZero(value: number): boolean {
  return Math.abs(value) <= ZERO_EPSILON;
}

function weightedMedian(values: WeightedValue[]): number {
  if (values.length === 0) throw new TypeError("weighted median requires values");
  const sorted = [...values].sort(
    (left, right) => left.value - right.value || left.weight - right.weight,
  );
  let totalWeight = 0;
  for (const item of sorted) {
    if (!Number.isFinite(item.value)) throw new TypeError("weighted median value must be finite");
    if (!Number.isFinite(item.weight) || item.weight <= 0) {
      throw new TypeError("weighted median weight must be positive and finite");
    }
    totalWeight += item.weight;
  }
  const target = totalWeight * 0.5;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= target) return item.value;
  }
  return sorted.at(-1)!.value;
}

export function weightedMean(values: WeightedValue[]): number {
  if (values.length === 0) throw new TypeError("weighted mean requires values");
  let weightedSum = 0;
  let totalWeight = 0;
  for (const item of values) {
    if (!Number.isFinite(item.value)) throw new TypeError("weighted mean value must be finite");
    if (!Number.isFinite(item.weight) || item.weight <= 0) {
      throw new TypeError("weighted mean weight must be positive and finite");
    }
    weightedSum += item.value * item.weight;
    totalWeight += item.weight;
  }
  return weightedSum / totalWeight;
}

export function weightedTrimmedMean(
  values: WeightedValue[],
  trimRatio = DEFAULT_SIGNAL_TRIM_RATIO,
): number {
  if (values.length === 0) throw new TypeError("weighted trimmed mean requires values");
  if (!Number.isFinite(trimRatio) || trimRatio < 0 || trimRatio >= 0.5) {
    throw new TypeError("trimRatio must be >= 0 and < 0.5");
  }
  const sorted = [...values].sort(
    (left, right) => left.value - right.value || left.weight - right.weight,
  );
  let totalWeight = 0;
  for (const item of sorted) {
    if (!Number.isFinite(item.value)) {
      throw new TypeError("weighted trimmed mean value must be finite");
    }
    if (!Number.isFinite(item.weight) || item.weight <= 0) {
      throw new TypeError("weighted trimmed mean weight must be positive and finite");
    }
    totalWeight += item.weight;
  }
  const lower = totalWeight * trimRatio;
  const upper = totalWeight * (1 - trimRatio);
  let cumulative = 0;
  let keptWeight = 0;
  let weightedSum = 0;
  for (const item of sorted) {
    const start = cumulative;
    const end = cumulative + item.weight;
    const kept = Math.max(0, Math.min(end, upper) - Math.max(start, lower));
    if (kept > 0) {
      keptWeight += kept;
      weightedSum += item.value * kept;
    }
    cumulative = end;
  }
  if (keptWeight <= 0) throw new TypeError("trimRatio removed all weighted observations");
  return weightedSum / keptWeight;
}

function metricRun(db: DatabaseSync, runId: string): MetricRunRow {
  const row = db.prepare(
    `SELECT benchmark_metric_run_id, panel_family_id, timezone, input_hash, result_hash
     FROM benchmark_metric_run
     WHERE benchmark_metric_run_id = ? AND status = 'SUCCEEDED'`,
  ).get(runId) as MetricRunRow | undefined;
  if (!row) throw new TypeError(`unknown benchmark metric run: ${runId}`);
  return row;
}

export function resolveBenchmarkSignalMetricRunId(
  db: DatabaseSync,
  requested?: string,
): string {
  if (requested !== undefined) {
    const value = requested.trim();
    if (value === "") throw new TypeError("benchmarkMetricRunId must not be empty");
    return metricRun(db, value).benchmark_metric_run_id;
  }
  const row = db.prepare(
    `SELECT benchmark_metric_run_id
     FROM benchmark_metric_run
     WHERE status = 'SUCCEEDED'
     ORDER BY analysis_cutoff DESC, created_at DESC, benchmark_metric_run_id DESC
     LIMIT 1`,
  ).get() as { benchmark_metric_run_id: string } | undefined;
  if (!row) throw new TypeError("no benchmark metric run exists");
  return row.benchmark_metric_run_id;
}

function panels(db: DatabaseSync, panelFamilyId: string): PanelRow[] {
  const rows = db.prepare(
    `SELECT panel_id, panel_label, panel_size
     FROM benchmark_panel
     WHERE panel_family_id = ?
     ORDER BY panel_size, panel_id`,
  ).all(panelFamilyId) as PanelRow[];
  if (rows.length === 0) throw new TypeError(`panel family ${panelFamilyId} has no panels`);
  return rows;
}

function members(db: DatabaseSync, panelId: string): MemberRow[] {
  return db.prepare(
    `SELECT panel_id, player_id, anchor_instrument_id, population_weight
     FROM benchmark_panel_member
     WHERE panel_id = ?
     ORDER BY admission_rank, player_id`,
  ).all(panelId) as MemberRow[];
}

function baseReturns(
  db: DatabaseSync,
  benchmarkMetricRunId: string,
  panelId: string,
): BaseReturnRow[] {
  return db.prepare(
    `SELECT panel_id, metric_date, period_type, value, status,
            valid_count, total_count, valid_weight, total_weight, weighted_coverage
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ?
       AND panel_id = ?
       AND metric_name = 'RETURN_1D'
     ORDER BY metric_date`,
  ).all(benchmarkMetricRunId, panelId) as BaseReturnRow[];
}

function frozenReturns(
  db: DatabaseSync,
  benchmarkMetricRunId: string,
  timezone: string,
): Map<string, Map<string, number | null>> {
  const rows = db.prepare(
    `SELECT instrument_id, source_snapshot_id, source_timestamp,
            observed_at, value, quality_status
     FROM benchmark_metric_input_price
     WHERE benchmark_metric_run_id = ?
     ORDER BY instrument_id, source_timestamp, observed_at, source_snapshot_id`,
  ).all(benchmarkMetricRunId) as FrozenPriceRow[];
  if (rows.length === 0) throw new TypeError(`benchmark metric run ${benchmarkMetricRunId} has no frozen prices`);

  const daily = new Map<string, FrozenPriceRow & { date: string; valid: boolean }>();
  for (const row of rows) {
    const date = dateInTimezone(row.source_timestamp, timezone);
    const key = `${row.instrument_id}\0${date}`;
    const candidate = {
      ...row,
      date,
      valid:
        (row.quality_status === "VALID" || row.quality_status === "UNCHANGED_RUN") &&
        row.value !== null &&
        row.value > 0,
    };
    const previous = daily.get(key);
    if (
      !previous ||
      candidate.source_timestamp > previous.source_timestamp ||
      (candidate.source_timestamp === previous.source_timestamp && candidate.observed_at > previous.observed_at) ||
      (candidate.source_timestamp === previous.source_timestamp &&
        candidate.observed_at === previous.observed_at &&
        candidate.source_snapshot_id > previous.source_snapshot_id)
    ) {
      daily.set(key, candidate);
    }
  }

  const byInstrument = new Map<string, Array<FrozenPriceRow & { date: string; valid: boolean }>>();
  for (const point of daily.values()) {
    const values = byInstrument.get(point.instrument_id) ?? [];
    values.push(point);
    byInstrument.set(point.instrument_id, values);
  }

  const result = new Map<string, Map<string, number | null>>();
  for (const [instrumentId, points] of byInstrument) {
    points.sort((left, right) => left.date.localeCompare(right.date));
    const byDate = new Map(points.map((point) => [point.date, point]));
    const returns = new Map<string, number | null>();
    for (const point of points) {
      const previous = byDate.get(previousDate(point.date));
      if (!previous || !previous.valid || !point.valid) {
        returns.set(point.date, null);
      } else {
        returns.set(point.date, round(point.value! / previous.value! - 1));
      }
    }
    result.set(instrumentId, returns);
  }
  return result;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-10;
}

function diagnosticRowsForPanel(
  panel: PanelRow,
  panelMembers: MemberRow[],
  rows: BaseReturnRow[],
  returns: Map<string, Map<string, number | null>>,
  trimRatio: number,
): DiagnosticRow[] {
  if (panelMembers.length !== Number(panel.panel_size)) {
    throw new TypeError(`panel ${panel.panel_id} membership size mismatch`);
  }
  const totalWeight = panelMembers.reduce((sum, member) => sum + member.population_weight, 0);
  return rows.map((base) => {
    const valid: WeightedValue[] = [];
    let zeroCount = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    let zeroWeight = 0;
    let positiveWeight = 0;
    let negativeWeight = 0;
    for (const member of panelMembers) {
      const value = returns.get(member.anchor_instrument_id)?.get(base.metric_date);
      if (value === undefined || value === null) continue;
      valid.push({ value, weight: member.population_weight });
      if (isZero(value)) {
        zeroCount += 1;
        zeroWeight += member.population_weight;
      } else if (value > 0) {
        positiveCount += 1;
        positiveWeight += member.population_weight;
      } else {
        negativeCount += 1;
        negativeWeight += member.population_weight;
      }
    }
    const validWeight = valid.reduce((sum, item) => sum + item.weight, 0);
    const coverage = validWeight / totalWeight;
    const median = valid.length > 0 ? round(weightedMedian(valid)) : null;
    const mean = valid.length > 0 ? round(weightedMean(valid)) : null;
    const trimmed = valid.length > 0 ? round(weightedTrimmedMean(valid, trimRatio)) : null;

    if (valid.length !== Number(base.valid_count)) {
      throw new TypeError(
        `diagnostic ${panel.panel_label} ${base.metric_date} valid_count ${valid.length} differs from benchmark ${String(base.valid_count)}`,
      );
    }
    if (!closeEnough(round(validWeight), Number(base.valid_weight))) {
      throw new TypeError(`diagnostic ${panel.panel_label} ${base.metric_date} valid_weight mismatch`);
    }
    if (!closeEnough(round(coverage), Number(base.weighted_coverage))) {
      throw new TypeError(`diagnostic ${panel.panel_label} ${base.metric_date} weighted_coverage mismatch`);
    }
    if (
      base.status === "OK" &&
      (base.value === null || median === null || !closeEnough(median, base.value))
    ) {
      throw new TypeError(`diagnostic ${panel.panel_label} ${base.metric_date} weighted median mismatch`);
    }

    return {
      panel_id: panel.panel_id,
      metric_date: base.metric_date,
      period_type: base.period_type,
      base_status: base.status,
      base_point_value: base.value,
      valid_count: valid.length,
      total_count: panelMembers.length,
      valid_weight: round(validWeight),
      total_weight: round(totalWeight),
      weighted_coverage: round(coverage),
      zero_count: zeroCount,
      positive_count: positiveCount,
      negative_count: negativeCount,
      zero_weight_ratio: validWeight > 0 ? round(zeroWeight / validWeight) : null,
      positive_weight_ratio: validWeight > 0 ? round(positiveWeight / validWeight) : null,
      negative_weight_ratio: validWeight > 0 ? round(negativeWeight / validWeight) : null,
      weighted_median: median,
      weighted_mean: mean,
      weighted_trimmed_mean: trimmed,
    };
  });
}

function classify(summary: {
  okDates: number;
  medianZeroDates: number;
  meanNonzeroDates: number;
  trimmedMeanNonzeroDates: number;
}): SignalDiagnosticClassification {
  if (summary.okDates < MINIMUM_CLASSIFICATION_DAYS) return "INSUFFICIENT_OK_DAYS";
  const medianZeroRatio = summary.medianZeroDates / summary.okDates;
  const alternativeSignalRatio = Math.max(
    summary.meanNonzeroDates / summary.okDates,
    summary.trimmedMeanNonzeroDates / summary.okDates,
  );
  if (
    medianZeroRatio >= MEDIAN_ZERO_COLLAPSE_RATIO &&
    alternativeSignalRatio >= ALTERNATIVE_SIGNAL_MIN_RATIO
  ) {
    return "ZERO_INFLATED_MEDIAN_COLLAPSE";
  }
  if (medianZeroRatio >= MEDIAN_ZERO_COLLAPSE_RATIO) return "LOW_DIRECTIONAL_VARIATION";
  return "MEDIAN_RETAINS_DIRECTIONAL_SIGNAL";
}

function summarizePanel(
  panel: PanelRow,
  rows: DiagnosticRow[],
  zeroDominanceThreshold: number,
): SignalDiagnosticPanelSummary {
  const ok = rows.filter((row) => row.base_status === "OK");
  const zeroRatios = ok
    .map((row) => row.zero_weight_ratio)
    .filter((value): value is number => value !== null);
  const medianZeroDates = ok.filter(
    (row) => row.weighted_median !== null && isZero(row.weighted_median),
  ).length;
  const meanNonzeroDates = ok.filter(
    (row) => row.weighted_mean !== null && !isZero(row.weighted_mean),
  ).length;
  const trimmedMeanNonzeroDates = ok.filter(
    (row) => row.weighted_trimmed_mean !== null && !isZero(row.weighted_trimmed_mean),
  ).length;
  const medianZeroButMeanNonzeroDates = ok.filter(
    (row) =>
      row.weighted_median !== null &&
      isZero(row.weighted_median) &&
      row.weighted_mean !== null &&
      !isZero(row.weighted_mean),
  ).length;
  const ratio = (count: number): number | null => ok.length > 0 ? round(count / ok.length) : null;
  return {
    panel_id: panel.panel_id,
    panel_label: panel.panel_label,
    panel_size: Number(panel.panel_size),
    diagnostic_dates: rows.length,
    ok_dates: ok.length,
    no_result_dates: rows.length - ok.length,
    zero_dominated_dates: ok.filter(
      (row) => row.zero_weight_ratio !== null && row.zero_weight_ratio >= zeroDominanceThreshold,
    ).length,
    median_zero_dates: medianZeroDates,
    mean_nonzero_dates: meanNonzeroDates,
    trimmed_mean_nonzero_dates: trimmedMeanNonzeroDates,
    median_zero_but_mean_nonzero_dates: medianZeroButMeanNonzeroDates,
    median_zero_ratio: ratio(medianZeroDates),
    mean_nonzero_ratio: ratio(meanNonzeroDates),
    trimmed_mean_nonzero_ratio: ratio(trimmedMeanNonzeroDates),
    average_zero_weight_ratio: zeroRatios.length > 0
      ? round(zeroRatios.reduce((sum, value) => sum + value, 0) / zeroRatios.length)
      : null,
    classification: classify({
      okDates: ok.length,
      medianZeroDates,
      meanNonzeroDates,
      trimmedMeanNonzeroDates,
    }),
  };
}

export function runBenchmarkSignalDiagnostic(
  db: DatabaseSync,
  input: {
    benchmarkMetricRunId: string;
    diagnosticVersion?: string;
    trimRatio?: number;
    zeroDominanceThreshold?: number;
    createdAt?: string;
  },
): RunBenchmarkSignalDiagnosticResult {
  const metric = metricRun(db, input.benchmarkMetricRunId.trim());
  const diagnosticVersion = input.diagnosticVersion ?? BENCHMARK_SIGNAL_DIAGNOSTIC_VERSION;
  if (diagnosticVersion.trim() === "") throw new TypeError("diagnosticVersion must not be empty");
  const trimRatio = normalizeRatio(
    input.trimRatio ?? DEFAULT_SIGNAL_TRIM_RATIO,
    "trimRatio",
    true,
  );
  if (trimRatio >= 0.5) throw new TypeError("trimRatio must be < 0.5");
  const zeroDominanceThreshold = normalizeRatio(
    input.zeroDominanceThreshold ?? DEFAULT_ZERO_DOMINANCE_THRESHOLD,
    "zeroDominanceThreshold",
    false,
  );
  if (zeroDominanceThreshold === 0) {
    throw new TypeError("zeroDominanceThreshold must be > 0");
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  const panelRows = panels(db, metric.panel_family_id);
  const returnMap = frozenReturns(db, metric.benchmark_metric_run_id, metric.timezone);
  const manifest = {
    benchmark_metric_run_id: metric.benchmark_metric_run_id,
    benchmark_metric_input_hash: metric.input_hash,
    benchmark_metric_result_hash: metric.result_hash,
    diagnostic_version: diagnosticVersion,
    trim_ratio: trimRatio,
    zero_dominance_threshold: zeroDominanceThreshold,
  };
  const inputHash = sha256(canonicalJson(manifest));
  const diagnosticRunId = deterministicId("benchmark_signal_diagnostic_run", inputHash);

  const rows: DiagnosticRow[] = [];
  for (const panel of panelRows) {
    rows.push(...diagnosticRowsForPanel(
      panel,
      members(db, panel.panel_id),
      baseReturns(db, metric.benchmark_metric_run_id, panel.panel_id),
      returnMap,
      trimRatio,
    ));
  }
  rows.sort((left, right) =>
    `${left.panel_id}\0${left.metric_date}`.localeCompare(`${right.panel_id}\0${right.metric_date}`),
  );
  const resultHash = sha256(canonicalJson(rows));

  db.exec("BEGIN IMMEDIATE");
  try {
    const runInsert = db.prepare(
      `INSERT OR IGNORE INTO benchmark_signal_diagnostic_run(
        benchmark_signal_diagnostic_run_id, benchmark_metric_run_id,
        diagnostic_version, trim_ratio, zero_dominance_threshold,
        input_hash, created_at, status, result_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?)`,
    ).run(
      diagnosticRunId,
      metric.benchmark_metric_run_id,
      diagnosticVersion,
      trimRatio,
      zeroDominanceThreshold,
      inputHash,
      createdAt,
      resultHash,
    );
    const existing = db.prepare(
      `SELECT input_hash, result_hash
       FROM benchmark_signal_diagnostic_run
       WHERE benchmark_signal_diagnostic_run_id = ?`,
    ).get(diagnosticRunId) as { input_hash: string; result_hash: string };
    if (existing.input_hash !== inputHash || existing.result_hash !== resultHash) {
      throw new TypeError(`benchmark signal diagnostic identity conflict for ${diagnosticRunId}`);
    }

    const insert = db.prepare(
      `INSERT OR IGNORE INTO benchmark_signal_diagnostic(
        benchmark_signal_diagnostic_run_id, panel_id, metric_date,
        period_type, base_status, base_point_value,
        valid_count, total_count, valid_weight, total_weight, weighted_coverage,
        zero_count, positive_count, negative_count,
        zero_weight_ratio, positive_weight_ratio, negative_weight_ratio,
        weighted_median, weighted_mean, weighted_trimmed_mean
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(
        diagnosticRunId,
        row.panel_id,
        row.metric_date,
        row.period_type,
        row.base_status,
        row.base_point_value,
        row.valid_count,
        row.total_count,
        row.valid_weight,
        row.total_weight,
        row.weighted_coverage,
        row.zero_count,
        row.positive_count,
        row.negative_count,
        row.zero_weight_ratio,
        row.positive_weight_ratio,
        row.negative_weight_ratio,
        row.weighted_median,
        row.weighted_mean,
        row.weighted_trimmed_mean,
      );
    }
    const persisted = db.prepare(
      `SELECT COUNT(*) AS count
       FROM benchmark_signal_diagnostic
       WHERE benchmark_signal_diagnostic_run_id = ?`,
    ).get(diagnosticRunId) as { count: number | bigint };
    if (Number(persisted.count) !== rows.length) {
      throw new Error(
        `signal diagnostic ${diagnosticRunId} persisted ${String(persisted.count)} rows, expected ${rows.length}`,
      );
    }
    db.exec("COMMIT");

    return {
      benchmark_signal_diagnostic_run_id: diagnosticRunId,
      benchmark_metric_run_id: metric.benchmark_metric_run_id,
      panel_family_id: metric.panel_family_id,
      diagnostic_version: diagnosticVersion,
      trim_ratio: trimRatio,
      zero_dominance_threshold: zeroDominanceThreshold,
      input_hash: inputHash,
      result_hash: resultHash,
      diagnostic_rows: rows.length,
      panels: panelRows.map((panel) => summarizePanel(
        panel,
        rows.filter((row) => row.panel_id === panel.panel_id),
        zeroDominanceThreshold,
      )),
      created: Number(runInsert.changes) === 1,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
