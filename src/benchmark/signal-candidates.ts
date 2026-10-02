import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const BENCHMARK_SIGNAL_CANDIDATE_VERSION = "market-benchmark-signal-candidates-v1";
export const DEFAULT_MOVER_WINSOR_RATIO = 0.1;
export const DEFAULT_CANDIDATE_MINIMUM_COMMON_VALID_DAYS = 60;
export const DEFAULT_CANDIDATE_RETURN_MEDIAN_ABS_DIFF_MAX = 0.0025;
export const DEFAULT_CANDIDATE_RETURN_P95_ABS_DIFF_MAX = 0.01;
export const DEFAULT_CANDIDATE_DIRECTION_MATCH_RATIO_MIN = 0.9;

const ZERO_EPSILON = 1e-12;

export type SignalCandidateName =
  | "WEIGHTED_MEAN"
  | "ACTIVITY_SCALED_MOVER_MEDIAN"
  | "ACTIVITY_SCALED_MOVER_WINSORIZED_MEAN";
export type SignalCandidatePairStatus = "PASS" | "FAIL" | "INSUFFICIENT";

type BenchmarkPeriodType = "FIXED_PANEL_BACKCAST" | "CONTEMPORANEOUS";
type CandidateMetricStatus = "OK" | "ZERO_ACTIVITY" | "BASE_NO_RESULT";

interface SignalDiagnosticRunRow {
  benchmark_signal_diagnostic_run_id: string;
  benchmark_metric_run_id: string;
  input_hash: string;
  result_hash: string;
}

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
  anchor_instrument_id: string;
  population_weight: number;
}

interface FrozenPriceRow {
  instrument_id: string;
  source_snapshot_id: string;
  source_timestamp: string;
  observed_at: string;
  value: number | bigint | null;
  quality_status: string;
}

interface BaseReturnRow {
  panel_id: string;
  metric_date: string;
  period_type: BenchmarkPeriodType;
  status: "OK" | "NO_RESULT";
}

interface WeightedValue {
  value: number;
  weight: number;
}

interface ReturnPoint {
  value: number | null;
  valid: boolean;
}

interface CandidateMetricRow {
  panel_id: string;
  metric_date: string;
  period_type: BenchmarkPeriodType;
  status: CandidateMetricStatus;
  valid_count: number;
  mover_count: number;
  valid_weight: number;
  mover_weight: number;
  activity_weight_ratio: number | null;
  weighted_mean: number | null;
  mover_weighted_mean: number | null;
  mover_weighted_median: number | null;
  mover_winsorized_mean: number | null;
  activity_scaled_mover_median: number | null;
  activity_scaled_mover_winsorized_mean: number | null;
}

export interface CandidatePanelSummary {
  candidate_name: SignalCandidateName;
  panel_id: string;
  panel_label: string;
  panel_size: number;
  valid_dates: number;
  signal_dates: number;
  signal_ratio: number | null;
  median_abs_return: number | null;
  p95_abs_return: number | null;
}

export interface CandidatePairSummary {
  candidate_name: SignalCandidateName;
  smaller_panel_id: string;
  smaller_panel_label: string;
  smaller_panel_size: number;
  larger_panel_id: string;
  larger_panel_label: string;
  larger_panel_size: number;
  common_valid_days: number;
  direction_compared_days: number;
  return_median_abs_diff: number | null;
  return_p95_abs_diff: number | null;
  return_direction_match_ratio: number | null;
  status: SignalCandidatePairStatus;
  reasons: string[];
}

export interface CandidateEvaluationSummary {
  candidate_name: SignalCandidateName;
  panels: CandidatePanelSummary[];
  pairs: CandidatePairSummary[];
  all_pairs_pass: boolean;
  terminal_pair_status: SignalCandidatePairStatus | null;
}

export interface RunBenchmarkSignalCandidatesResult {
  benchmark_signal_candidate_run_id: string;
  benchmark_signal_diagnostic_run_id: string;
  benchmark_metric_run_id: string;
  panel_family_id: string;
  evaluation_version: string;
  mover_winsor_ratio: number;
  minimum_common_valid_days: number;
  return_median_abs_diff_max: number;
  return_p95_abs_diff_max: number;
  direction_match_ratio_min: number;
  input_hash: string;
  result_hash: string;
  metric_rows: number;
  candidates: CandidateEvaluationSummary[];
  created: boolean;
}

const CANDIDATES: readonly SignalCandidateName[] = [
  "WEIGHTED_MEAN",
  "ACTIVITY_SCALED_MOVER_MEDIAN",
  "ACTIVITY_SCALED_MOVER_WINSORIZED_MEAN",
];

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
    throw new TypeError("benchmark signal candidate payload must contain finite JSON values");
  }
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeRatio(value: number, field: string, upperExclusive = false): number {
  const upperOk = upperExclusive ? value < 1 : value <= 1;
  if (!Number.isFinite(value) || value < 0 || !upperOk) {
    throw new TypeError(`${field} must be >= 0 and ${upperExclusive ? "< 1" : "<= 1"}`);
  }
  return value;
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

function assertWeightedValues(values: WeightedValue[]): void {
  if (values.length === 0) throw new TypeError("weighted statistic requires values");
  for (const item of values) {
    if (!Number.isFinite(item.value)) throw new TypeError("weighted value must be finite");
    if (!Number.isFinite(item.weight) || item.weight <= 0) {
      throw new TypeError("weighted weight must be positive and finite");
    }
  }
}

export function weightedMean(values: WeightedValue[]): number {
  assertWeightedValues(values);
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

export function weightedQuantile(values: WeightedValue[], probability: number): number {
  assertWeightedValues(values);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new TypeError("weighted quantile probability must be between 0 and 1");
  }
  const sorted = [...values].sort(
    (left, right) => left.value - right.value || left.weight - right.weight,
  );
  if (probability === 0) return sorted[0]!.value;
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  const target = probability * totalWeight;
  let cumulative = 0;
  for (const item of sorted) {
    cumulative += item.weight;
    if (cumulative >= target) return item.value;
  }
  return sorted.at(-1)!.value;
}

export function weightedMedian(values: WeightedValue[]): number {
  return weightedQuantile(values, 0.5);
}

export function weightedWinsorizedMean(
  values: WeightedValue[],
  winsorRatio = DEFAULT_MOVER_WINSOR_RATIO,
): number {
  assertWeightedValues(values);
  normalizeRatio(winsorRatio, "winsorRatio", true);
  if (winsorRatio >= 0.5) throw new TypeError("winsorRatio must be < 0.5");
  const lower = weightedQuantile(values, winsorRatio);
  const upper = weightedQuantile(values, 1 - winsorRatio);
  return weightedMean(
    values.map((item) => ({
      value: Math.min(upper, Math.max(lower, item.value)),
      weight: item.weight,
    })),
  );
}

export function candidateDay(
  values: WeightedValue[],
  winsorRatio = DEFAULT_MOVER_WINSOR_RATIO,
): {
  activity_weight_ratio: number;
  weighted_mean: number;
  mover_weighted_mean: number | null;
  mover_weighted_median: number | null;
  mover_winsorized_mean: number | null;
  activity_scaled_mover_median: number;
  activity_scaled_mover_winsorized_mean: number;
  mover_count: number;
  mover_weight: number;
} {
  assertWeightedValues(values);
  const validWeight = values.reduce((sum, item) => sum + item.weight, 0);
  const movers = values.filter((item) => !isZero(item.value));
  const moverWeight = movers.reduce((sum, item) => sum + item.weight, 0);
  const activity = moverWeight / validWeight;
  const mean = weightedMean(values);
  if (movers.length === 0) {
    return {
      activity_weight_ratio: 0,
      weighted_mean: 0,
      mover_weighted_mean: null,
      mover_weighted_median: null,
      mover_winsorized_mean: null,
      activity_scaled_mover_median: 0,
      activity_scaled_mover_winsorized_mean: 0,
      mover_count: 0,
      mover_weight: 0,
    };
  }
  const moverMean = weightedMean(movers);
  const moverMedian = weightedMedian(movers);
  const moverWinsorizedMean = weightedWinsorizedMean(movers, winsorRatio);
  const decomposedMean = activity * moverMean;
  if (Math.abs(mean - decomposedMean) > 1e-10) {
    throw new Error(
      `weighted mean decomposition drift: direct=${mean}, activity*moverMean=${decomposedMean}`,
    );
  }
  return {
    activity_weight_ratio: round(activity),
    weighted_mean: round(mean),
    mover_weighted_mean: round(moverMean),
    mover_weighted_median: round(moverMedian),
    mover_winsorized_mean: round(moverWinsorizedMean),
    activity_scaled_mover_median: round(activity * moverMedian),
    activity_scaled_mover_winsorized_mean: round(activity * moverWinsorizedMean),
    mover_count: movers.length,
    mover_weight: round(moverWeight),
  };
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

function diagnosticRun(db: DatabaseSync, runId: string): SignalDiagnosticRunRow {
  const row = db.prepare(
    `SELECT benchmark_signal_diagnostic_run_id, benchmark_metric_run_id,
            input_hash, result_hash
     FROM benchmark_signal_diagnostic_run
     WHERE benchmark_signal_diagnostic_run_id = ? AND status = 'SUCCEEDED'`,
  ).get(runId) as SignalDiagnosticRunRow | undefined;
  if (!row) throw new TypeError(`unknown benchmark signal diagnostic run: ${runId}`);
  return row;
}

export function resolveBenchmarkSignalDiagnosticRunId(
  db: DatabaseSync,
  requested?: string,
): string {
  if (requested !== undefined) {
    const value = requested.trim();
    if (value === "") throw new TypeError("benchmarkSignalDiagnosticRunId must not be empty");
    return diagnosticRun(db, value).benchmark_signal_diagnostic_run_id;
  }
  const row = db.prepare(
    `SELECT benchmark_signal_diagnostic_run_id
     FROM benchmark_signal_diagnostic_run
     WHERE status = 'SUCCEEDED'
     ORDER BY created_at DESC, benchmark_signal_diagnostic_run_id DESC
     LIMIT 1`,
  ).get() as { benchmark_signal_diagnostic_run_id: string } | undefined;
  if (!row) throw new TypeError("no benchmark signal diagnostic run exists");
  return row.benchmark_signal_diagnostic_run_id;
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

function panels(db: DatabaseSync, panelFamilyId: string): PanelRow[] {
  const rows = db.prepare(
    `SELECT panel_id, panel_label, panel_size
     FROM benchmark_panel
     WHERE panel_family_id = ?
     ORDER BY panel_size, panel_id`,
  ).all(panelFamilyId) as PanelRow[];
  if (rows.length < 2) {
    throw new TypeError(`panel family ${panelFamilyId} requires at least two panels`);
  }
  return rows;
}

function members(db: DatabaseSync, panelId: string): MemberRow[] {
  const rows = db.prepare(
    `SELECT panel_id, anchor_instrument_id, population_weight
     FROM benchmark_panel_member
     WHERE panel_id = ?
     ORDER BY admission_rank, player_id`,
  ).all(panelId) as MemberRow[];
  if (rows.length === 0) throw new TypeError(`panel ${panelId} has no members`);
  return rows;
}

function frozenPrices(db: DatabaseSync, metricRunId: string): FrozenPriceRow[] {
  return db.prepare(
    `SELECT instrument_id, source_snapshot_id, source_timestamp,
            observed_at, value, quality_status
     FROM benchmark_metric_input_price
     WHERE benchmark_metric_run_id = ?
     ORDER BY instrument_id, source_timestamp, observed_at, source_snapshot_id`,
  ).all(metricRunId) as FrozenPriceRow[];
}

function dailyReturns(
  rows: FrozenPriceRow[],
  timezone: string,
): Map<string, Map<string, ReturnPoint>> {
  const daily = new Map<string, FrozenPriceRow & { date: string }>();
  for (const row of rows) {
    const date = dateInTimezone(row.source_timestamp, timezone);
    const key = `${row.instrument_id}\0${date}`;
    const candidate = { ...row, date };
    const previous = daily.get(key);
    if (
      !previous ||
      candidate.source_timestamp > previous.source_timestamp ||
      (candidate.source_timestamp === previous.source_timestamp &&
        candidate.observed_at > previous.observed_at) ||
      (candidate.source_timestamp === previous.source_timestamp &&
        candidate.observed_at === previous.observed_at &&
        candidate.source_snapshot_id > previous.source_snapshot_id)
    ) {
      daily.set(key, candidate);
    }
  }

  const pricesByInstrument = new Map<string, Map<string, FrozenPriceRow & { date: string }>>();
  for (const row of daily.values()) {
    const byDate = pricesByInstrument.get(row.instrument_id) ?? new Map();
    byDate.set(row.date, row);
    pricesByInstrument.set(row.instrument_id, byDate);
  }

  const result = new Map<string, Map<string, ReturnPoint>>();
  for (const [instrumentId, byDate] of pricesByInstrument) {
    const returns = new Map<string, ReturnPoint>();
    for (const [date, current] of byDate) {
      const previous = byDate.get(previousDate(date));
      const currentValid =
        (current.quality_status === "VALID" || current.quality_status === "UNCHANGED_RUN") &&
        current.value !== null && Number(current.value) > 0;
      const previousValid =
        previous !== undefined &&
        (previous.quality_status === "VALID" || previous.quality_status === "UNCHANGED_RUN") &&
        previous.value !== null && Number(previous.value) > 0;
      if (!currentValid || !previousValid) {
        returns.set(date, { value: null, valid: false });
      } else {
        returns.set(date, {
          value: round(Number(current.value) / Number(previous!.value) - 1),
          valid: true,
        });
      }
    }
    result.set(instrumentId, returns);
  }
  return result;
}

function baseReturnRows(db: DatabaseSync, metricRunId: string): BaseReturnRow[] {
  return db.prepare(
    `SELECT panel_id, metric_date, period_type, status
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ? AND metric_name = 'RETURN_1D'
     ORDER BY panel_id, metric_date`,
  ).all(metricRunId) as BaseReturnRow[];
}

function calculateMetricRows(
  panelRows: PanelRow[],
  baseRows: BaseReturnRow[],
  returns: Map<string, Map<string, ReturnPoint>>,
  membersByPanel: Map<string, MemberRow[]>,
  winsorRatio: number,
): CandidateMetricRow[] {
  const baseByPanel = new Map<string, BaseReturnRow[]>();
  for (const row of baseRows) {
    const values = baseByPanel.get(row.panel_id) ?? [];
    values.push(row);
    baseByPanel.set(row.panel_id, values);
  }

  const result: CandidateMetricRow[] = [];
  for (const panel of panelRows) {
    const panelMembers = membersByPanel.get(panel.panel_id)!;
    const rows = baseByPanel.get(panel.panel_id) ?? [];
    for (const base of rows) {
      const values: WeightedValue[] = [];
      for (const member of panelMembers) {
        const point = returns.get(member.anchor_instrument_id)?.get(base.metric_date);
        if (!point?.valid || point.value === null) continue;
        values.push({ value: point.value, weight: member.population_weight });
      }
      const validWeight = values.reduce((sum, item) => sum + item.weight, 0);
      const movers = values.filter((item) => !isZero(item.value));
      const moverWeight = movers.reduce((sum, item) => sum + item.weight, 0);
      if (base.status !== "OK") {
        result.push({
          panel_id: panel.panel_id,
          metric_date: base.metric_date,
          period_type: base.period_type,
          status: "BASE_NO_RESULT",
          valid_count: values.length,
          mover_count: movers.length,
          valid_weight: round(validWeight),
          mover_weight: round(moverWeight),
          activity_weight_ratio: null,
          weighted_mean: null,
          mover_weighted_mean: null,
          mover_weighted_median: null,
          mover_winsorized_mean: null,
          activity_scaled_mover_median: null,
          activity_scaled_mover_winsorized_mean: null,
        });
        continue;
      }
      if (values.length === 0) {
        throw new Error(`base RETURN_1D is OK but ${panel.panel_label} ${base.metric_date} has no valid returns`);
      }
      const evaluated = candidateDay(values, winsorRatio);
      result.push({
        panel_id: panel.panel_id,
        metric_date: base.metric_date,
        period_type: base.period_type,
        status: evaluated.mover_count === 0 ? "ZERO_ACTIVITY" : "OK",
        valid_count: values.length,
        mover_count: evaluated.mover_count,
        valid_weight: round(validWeight),
        mover_weight: evaluated.mover_weight,
        activity_weight_ratio: evaluated.activity_weight_ratio,
        weighted_mean: evaluated.weighted_mean,
        mover_weighted_mean: evaluated.mover_weighted_mean,
        mover_weighted_median: evaluated.mover_weighted_median,
        mover_winsorized_mean: evaluated.mover_winsorized_mean,
        activity_scaled_mover_median: evaluated.activity_scaled_mover_median,
        activity_scaled_mover_winsorized_mean:
          evaluated.activity_scaled_mover_winsorized_mean,
      });
    }
  }
  return result.sort((left, right) =>
    `${left.panel_id}\0${left.metric_date}`.localeCompare(`${right.panel_id}\0${right.metric_date}`),
  );
}

function candidateValue(
  row: CandidateMetricRow,
  candidate: SignalCandidateName,
): number | null {
  if (row.status === "BASE_NO_RESULT") return null;
  if (candidate === "WEIGHTED_MEAN") return row.weighted_mean;
  if (candidate === "ACTIVITY_SCALED_MOVER_MEDIAN") {
    return row.activity_scaled_mover_median;
  }
  return row.activity_scaled_mover_winsorized_mean;
}

function evaluatePair(
  candidate: SignalCandidateName,
  smaller: PanelRow,
  larger: PanelRow,
  rowsByPanel: Map<string, CandidateMetricRow[]>,
  thresholds: {
    minimumCommonValidDays: number;
    returnMedianAbsDiffMax: number;
    returnP95AbsDiffMax: number;
    directionMatchRatioMin: number;
  },
): CandidatePairSummary {
  const smallerByDate = new Map(
    (rowsByPanel.get(smaller.panel_id) ?? []).map((row) => [row.metric_date, row]),
  );
  const largerByDate = new Map(
    (rowsByPanel.get(larger.panel_id) ?? []).map((row) => [row.metric_date, row]),
  );
  const comparable: Array<{ smaller: number; larger: number }> = [];
  for (const [date, left] of smallerByDate) {
    const right = largerByDate.get(date);
    if (!right) continue;
    if (left.period_type !== right.period_type) {
      throw new TypeError(`candidate panel period_type mismatch on ${date}`);
    }
    const leftValue = candidateValue(left, candidate);
    const rightValue = candidateValue(right, candidate);
    if (leftValue === null || rightValue === null) continue;
    comparable.push({ smaller: leftValue, larger: rightValue });
  }
  const diffs = comparable.map((value) => Math.abs(value.smaller - value.larger));
  const directional = comparable.filter(
    (value) => !isZero(value.smaller) || !isZero(value.larger),
  );
  const matches = directional.filter(
    (value) => Math.sign(value.smaller) === Math.sign(value.larger),
  ).length;
  const medianDiff = diffs.length > 0 ? round(sampleQuantile(diffs, 0.5)) : null;
  const p95Diff = diffs.length > 0 ? round(sampleQuantile(diffs, 0.95)) : null;
  const directionRatio = directional.length > 0
    ? round(matches / directional.length)
    : null;

  const insufficient: string[] = [];
  if (comparable.length < thresholds.minimumCommonValidDays) {
    insufficient.push("COMMON_VALID_DAYS");
  }
  if (directional.length === 0) insufficient.push("DIRECTION_COMPARABLE_DAYS");

  let status: SignalCandidatePairStatus;
  let reasons: string[];
  if (insufficient.length > 0) {
    status = "INSUFFICIENT";
    reasons = insufficient;
  } else {
    const failed: string[] = [];
    if (medianDiff! > thresholds.returnMedianAbsDiffMax) {
      failed.push("RETURN_MEDIAN_ABS_DIFF");
    }
    if (p95Diff! > thresholds.returnP95AbsDiffMax) {
      failed.push("RETURN_P95_ABS_DIFF");
    }
    if (directionRatio! < thresholds.directionMatchRatioMin) {
      failed.push("RETURN_DIRECTION_MATCH_RATIO");
    }
    status = failed.length === 0 ? "PASS" : "FAIL";
    reasons = failed;
  }

  return {
    candidate_name: candidate,
    smaller_panel_id: smaller.panel_id,
    smaller_panel_label: smaller.panel_label,
    smaller_panel_size: Number(smaller.panel_size),
    larger_panel_id: larger.panel_id,
    larger_panel_label: larger.panel_label,
    larger_panel_size: Number(larger.panel_size),
    common_valid_days: comparable.length,
    direction_compared_days: directional.length,
    return_median_abs_diff: medianDiff,
    return_p95_abs_diff: p95Diff,
    return_direction_match_ratio: directionRatio,
    status,
    reasons,
  };
}

function panelSummary(
  candidate: SignalCandidateName,
  panel: PanelRow,
  rows: CandidateMetricRow[],
): CandidatePanelSummary {
  const values = rows
    .map((row) => candidateValue(row, candidate))
    .filter((value): value is number => value !== null);
  const absolute = values.map(Math.abs);
  const signalDates = values.filter((value) => !isZero(value)).length;
  return {
    candidate_name: candidate,
    panel_id: panel.panel_id,
    panel_label: panel.panel_label,
    panel_size: Number(panel.panel_size),
    valid_dates: values.length,
    signal_dates: signalDates,
    signal_ratio: values.length === 0 ? null : round(signalDates / values.length),
    median_abs_return: absolute.length === 0 ? null : round(sampleQuantile(absolute, 0.5)),
    p95_abs_return: absolute.length === 0 ? null : round(sampleQuantile(absolute, 0.95)),
  };
}

export function runBenchmarkSignalCandidates(
  db: DatabaseSync,
  input: {
    benchmarkSignalDiagnosticRunId: string;
    evaluationVersion?: string;
    moverWinsorRatio?: number;
    minimumCommonValidDays?: number;
    returnMedianAbsDiffMax?: number;
    returnP95AbsDiffMax?: number;
    directionMatchRatioMin?: number;
    createdAt?: string;
  },
): RunBenchmarkSignalCandidatesResult {
  const diagnostic = diagnosticRun(db, input.benchmarkSignalDiagnosticRunId.trim());
  const metric = metricRun(db, diagnostic.benchmark_metric_run_id);
  const evaluationVersion = input.evaluationVersion ?? BENCHMARK_SIGNAL_CANDIDATE_VERSION;
  if (evaluationVersion.trim() === "") throw new TypeError("evaluationVersion must not be empty");
  const moverWinsorRatio = normalizeRatio(
    input.moverWinsorRatio ?? DEFAULT_MOVER_WINSOR_RATIO,
    "moverWinsorRatio",
    true,
  );
  if (moverWinsorRatio >= 0.5) throw new TypeError("moverWinsorRatio must be < 0.5");
  const minimumCommonValidDays = normalizePositiveInteger(
    input.minimumCommonValidDays ?? DEFAULT_CANDIDATE_MINIMUM_COMMON_VALID_DAYS,
    "minimumCommonValidDays",
  );
  const returnMedianAbsDiffMax = normalizeNonNegative(
    input.returnMedianAbsDiffMax ?? DEFAULT_CANDIDATE_RETURN_MEDIAN_ABS_DIFF_MAX,
    "returnMedianAbsDiffMax",
  );
  const returnP95AbsDiffMax = normalizeNonNegative(
    input.returnP95AbsDiffMax ?? DEFAULT_CANDIDATE_RETURN_P95_ABS_DIFF_MAX,
    "returnP95AbsDiffMax",
  );
  const directionMatchRatioMin = normalizeRatio(
    input.directionMatchRatioMin ?? DEFAULT_CANDIDATE_DIRECTION_MATCH_RATIO_MIN,
    "directionMatchRatioMin",
  );
  const createdAt = input.createdAt ?? new Date().toISOString();

  const panelRows = panels(db, metric.panel_family_id);
  const membersByPanel = new Map(panelRows.map((panel) => [panel.panel_id, members(db, panel.panel_id)]));
  const frozen = frozenPrices(db, metric.benchmark_metric_run_id);
  const returns = dailyReturns(frozen, metric.timezone);
  const baseRows = baseReturnRows(db, metric.benchmark_metric_run_id);
  const metricRows = calculateMetricRows(
    panelRows,
    baseRows,
    returns,
    membersByPanel,
    moverWinsorRatio,
  );
  const rowsByPanel = new Map<string, CandidateMetricRow[]>();
  for (const row of metricRows) {
    const values = rowsByPanel.get(row.panel_id) ?? [];
    values.push(row);
    rowsByPanel.set(row.panel_id, values);
  }

  const thresholds = {
    minimumCommonValidDays,
    returnMedianAbsDiffMax,
    returnP95AbsDiffMax,
    directionMatchRatioMin,
  };
  const evaluations: CandidateEvaluationSummary[] = CANDIDATES.map((candidate) => {
    const panelSummaries = panelRows.map((panel) =>
      panelSummary(candidate, panel, rowsByPanel.get(panel.panel_id) ?? []),
    );
    const pairs: CandidatePairSummary[] = [];
    for (let index = 0; index < panelRows.length - 1; index += 1) {
      pairs.push(
        evaluatePair(
          candidate,
          panelRows[index]!,
          panelRows[index + 1]!,
          rowsByPanel,
          thresholds,
        ),
      );
    }
    return {
      candidate_name: candidate,
      panels: panelSummaries,
      pairs,
      all_pairs_pass: pairs.length > 0 && pairs.every((pair) => pair.status === "PASS"),
      terminal_pair_status: pairs.at(-1)?.status ?? null,
    };
  });

  const manifest = {
    benchmark_signal_diagnostic_run_id: diagnostic.benchmark_signal_diagnostic_run_id,
    diagnostic_input_hash: diagnostic.input_hash,
    diagnostic_result_hash: diagnostic.result_hash,
    benchmark_metric_run_id: metric.benchmark_metric_run_id,
    metric_input_hash: metric.input_hash,
    metric_result_hash: metric.result_hash,
    panel_family_id: metric.panel_family_id,
    evaluation_version: evaluationVersion,
    mover_winsor_ratio: moverWinsorRatio,
    thresholds,
    panels: panelRows.map((panel) => ({
      panel_id: panel.panel_id,
      panel_label: panel.panel_label,
      panel_size: Number(panel.panel_size),
    })),
  };
  const inputHash = sha256(canonicalJson(manifest));
  const runId = deterministicId("benchmark_signal_candidate_run", inputHash);
  const resultPayload = { metric_rows: metricRows, candidates: evaluations };
  const resultHash = sha256(canonicalJson(resultPayload));

  db.exec("BEGIN IMMEDIATE");
  try {
    const runInsert = db.prepare(
      `INSERT OR IGNORE INTO benchmark_signal_candidate_run(
        benchmark_signal_candidate_run_id, benchmark_signal_diagnostic_run_id,
        benchmark_metric_run_id, panel_family_id, evaluation_version,
        mover_winsor_ratio, minimum_common_valid_days,
        return_median_abs_diff_max, return_p95_abs_diff_max,
        direction_match_ratio_min, input_hash, created_at, status, result_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?)`,
    ).run(
      runId,
      diagnostic.benchmark_signal_diagnostic_run_id,
      metric.benchmark_metric_run_id,
      metric.panel_family_id,
      evaluationVersion,
      moverWinsorRatio,
      minimumCommonValidDays,
      returnMedianAbsDiffMax,
      returnP95AbsDiffMax,
      directionMatchRatioMin,
      inputHash,
      createdAt,
      resultHash,
    );

    const existing = db.prepare(
      `SELECT input_hash, result_hash
       FROM benchmark_signal_candidate_run
       WHERE benchmark_signal_candidate_run_id = ?`,
    ).get(runId) as { input_hash: string; result_hash: string };
    if (existing.input_hash !== inputHash || existing.result_hash !== resultHash) {
      throw new TypeError(`benchmark signal candidate run identity conflict for ${runId}`);
    }

    const insertMetric = db.prepare(
      `INSERT OR IGNORE INTO benchmark_signal_candidate_metric(
        benchmark_signal_candidate_run_id, panel_id, metric_date, period_type,
        status, valid_count, mover_count, valid_weight, mover_weight,
        activity_weight_ratio, weighted_mean, mover_weighted_mean,
        mover_weighted_median, mover_winsorized_mean,
        activity_scaled_mover_median,
        activity_scaled_mover_winsorized_mean
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of metricRows) {
      insertMetric.run(
        runId,
        row.panel_id,
        row.metric_date,
        row.period_type,
        row.status,
        row.valid_count,
        row.mover_count,
        row.valid_weight,
        row.mover_weight,
        row.activity_weight_ratio,
        row.weighted_mean,
        row.mover_weighted_mean,
        row.mover_weighted_median,
        row.mover_winsorized_mean,
        row.activity_scaled_mover_median,
        row.activity_scaled_mover_winsorized_mean,
      );
    }

    const insertPair = db.prepare(
      `INSERT OR IGNORE INTO benchmark_signal_candidate_pair(
        benchmark_signal_candidate_run_id, candidate_name,
        smaller_panel_id, larger_panel_id, smaller_panel_size, larger_panel_size,
        common_valid_days, direction_compared_days,
        return_median_abs_diff, return_p95_abs_diff,
        return_direction_match_ratio, status, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const evaluation of evaluations) {
      for (const pair of evaluation.pairs) {
        insertPair.run(
          runId,
          pair.candidate_name,
          pair.smaller_panel_id,
          pair.larger_panel_id,
          pair.smaller_panel_size,
          pair.larger_panel_size,
          pair.common_valid_days,
          pair.direction_compared_days,
          pair.return_median_abs_diff,
          pair.return_p95_abs_diff,
          pair.return_direction_match_ratio,
          pair.status,
          canonicalJson({ reasons: pair.reasons }),
        );
      }
    }

    const persistedMetrics = db.prepare(
      `SELECT COUNT(*) AS count FROM benchmark_signal_candidate_metric
       WHERE benchmark_signal_candidate_run_id = ?`,
    ).get(runId) as { count: number | bigint };
    if (Number(persistedMetrics.count) !== metricRows.length) {
      throw new Error(
        `signal candidate run ${runId} persisted ${String(persistedMetrics.count)} metrics, expected ${metricRows.length}`,
      );
    }
    const expectedPairs = evaluations.reduce((sum, item) => sum + item.pairs.length, 0);
    const persistedPairs = db.prepare(
      `SELECT COUNT(*) AS count FROM benchmark_signal_candidate_pair
       WHERE benchmark_signal_candidate_run_id = ?`,
    ).get(runId) as { count: number | bigint };
    if (Number(persistedPairs.count) !== expectedPairs) {
      throw new Error(
        `signal candidate run ${runId} persisted ${String(persistedPairs.count)} pairs, expected ${expectedPairs}`,
      );
    }
    db.exec("COMMIT");

    return {
      benchmark_signal_candidate_run_id: runId,
      benchmark_signal_diagnostic_run_id: diagnostic.benchmark_signal_diagnostic_run_id,
      benchmark_metric_run_id: metric.benchmark_metric_run_id,
      panel_family_id: metric.panel_family_id,
      evaluation_version: evaluationVersion,
      mover_winsor_ratio: moverWinsorRatio,
      minimum_common_valid_days: minimumCommonValidDays,
      return_median_abs_diff_max: returnMedianAbsDiffMax,
      return_p95_abs_diff_max: returnP95AbsDiffMax,
      direction_match_ratio_min: directionMatchRatioMin,
      input_hash: inputHash,
      result_hash: resultHash,
      metric_rows: metricRows.length,
      candidates: evaluations,
      created: Number(runInsert.changes) === 1,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
