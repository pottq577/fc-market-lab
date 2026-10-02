import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { benchmarkReturnAggregation } from "./metrics.ts";

export const BENCHMARK_UNCERTAINTY_VERSION = "market-benchmark-uncertainty-v1";
export const BENCHMARK_UNCERTAINTY_V2_VERSION = "market-benchmark-uncertainty-v2";
export const BENCHMARK_UNCERTAINTY_METHOD = "STRATIFIED_PLAYER_BOOTSTRAP";
export const DEFAULT_BOOTSTRAP_REPLICATES = 1000;
export const DEFAULT_BOOTSTRAP_CONFIDENCE_LEVEL = 0.95;
export const DEFAULT_BOOTSTRAP_SAMPLE_SEED = "market-benchmark-bootstrap-v1";
export const DEFAULT_MINIMUM_VALID_REPLICATE_RATIO = 0.8;
export const MINIMUM_BOOTSTRAP_STRATUM_SIZE = 2;

export type BenchmarkMetricName =
  | "RETURN_1D"
  | "INDEX"
  | "BREADTH"
  | "IQR"
  | "MAD";
export type BenchmarkPeriodType = "FIXED_PANEL_BACKCAST" | "CONTEMPORANEOUS";
export type BenchmarkUncertaintyStatus =
  | "OK"
  | "BASE_NO_RESULT"
  | "INSUFFICIENT_UNCERTAINTY_SAMPLE";

interface MetricRunRow {
  benchmark_metric_run_id: string;
  panel_family_id: string;
  metric_version: string;
  analysis_cutoff: string;
  timezone: string;
  price_semantics: string;
  minimum_weighted_coverage: number;
  input_hash: string;
  result_hash: string;
}

interface PanelRow {
  panel_id: string;
  panel_label: string;
  panel_size: number | bigint;
  effective_from: string;
}

interface MemberRow {
  panel_id: string;
  player_id: string;
  stratum_id: string;
  anchor_instrument_id: string;
  population_weight: number;
  admission_rank: number | bigint;
}

interface FrozenPriceRow {
  instrument_id: string;
  source_snapshot_id: string;
  source_timestamp: string;
  observed_at: string;
  value: number | null;
  quality_status: string;
}

interface ReturnPoint {
  value: number | null;
  valid: boolean;
}

interface BaseMetricRow {
  panel_id: string;
  metric_date: string;
  period_type: BenchmarkPeriodType;
  metric_name: BenchmarkMetricName;
  value: number | null;
  status: "OK" | "NO_RESULT";
}

interface Distribution {
  values: Float64Array;
  count: number;
}

interface DateDistributions {
  RETURN_1D: Distribution;
  INDEX: Distribution;
  BREADTH: Distribution;
  IQR: Distribution;
  MAD: Distribution;
}

interface UncertaintyRow {
  panel_id: string;
  metric_date: string;
  period_type: BenchmarkPeriodType;
  metric_name: BenchmarkMetricName;
  point_value: number | null;
  lower_value: number | null;
  upper_value: number | null;
  status: BenchmarkUncertaintyStatus;
  valid_replicates: number;
  total_replicates: number;
  details: Record<string, unknown>;
}

export interface BenchmarkUncertaintyPanelSummary {
  panel_id: string;
  panel_label: string;
  panel_size: number;
  uncertainty_rows: number;
  ok_rows: number;
  base_no_result_rows: number;
  insufficient_rows: number;
  return_ci_dates: number;
}

export interface RunBenchmarkUncertaintyResult {
  benchmark_uncertainty_run_id: string;
  benchmark_metric_run_id: string;
  panel_family_id: string;
  uncertainty_version: string;
  method: typeof BENCHMARK_UNCERTAINTY_METHOD;
  replicates: number;
  confidence_level: number;
  sample_seed: string;
  minimum_valid_replicate_ratio: number;
  input_hash: string;
  uncertainty_rows: number;
  ok_rows: number;
  base_no_result_rows: number;
  insufficient_rows: number;
  result_hash: string;
  panels: BenchmarkUncertaintyPanelSummary[];
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
    throw new TypeError("benchmark uncertainty payload must contain finite JSON values");
  }
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function normalizeRatio(value: number, field: string, allowOne: boolean): number {
  const upperOk = allowOne ? value <= 1 : value < 1;
  if (!Number.isFinite(value) || value <= 0 || !upperOk) {
    throw new TypeError(`${field} must be > 0 and ${allowOne ? "<= 1" : "< 1"}`);
  }
  return value;
}

function previousDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
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

export function sampleQuantile(values: number[], probability: number): number {
  if (values.length === 0) throw new TypeError("sample quantile requires values");
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new TypeError("sample quantile probability must be between 0 and 1");
  }
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function latestMetricRun(db: DatabaseSync): MetricRunRow {
  const row = db.prepare(
    `SELECT benchmark_metric_run_id, panel_family_id, metric_version,
            analysis_cutoff, timezone, price_semantics,
            minimum_weighted_coverage, input_hash, result_hash
     FROM benchmark_metric_run
     ORDER BY analysis_cutoff DESC, created_at DESC, benchmark_metric_run_id DESC
     LIMIT 1`,
  ).get() as MetricRunRow | undefined;
  if (!row) throw new TypeError("no benchmark metric run exists");
  return row;
}

export function resolveBenchmarkMetricRunId(
  db: DatabaseSync,
  requested?: string,
): string {
  if (requested === undefined) return latestMetricRun(db).benchmark_metric_run_id;
  const value = requested.trim();
  if (value === "") throw new TypeError("benchmarkMetricRunId must not be empty");
  const row = db.prepare(
    `SELECT benchmark_metric_run_id
     FROM benchmark_metric_run
     WHERE benchmark_metric_run_id = ?`,
  ).get(value) as { benchmark_metric_run_id: string } | undefined;
  if (!row) throw new TypeError(`unknown benchmark metric run: ${value}`);
  return row.benchmark_metric_run_id;
}

function metricRun(db: DatabaseSync, runId: string): MetricRunRow {
  const row = db.prepare(
    `SELECT benchmark_metric_run_id, panel_family_id, metric_version,
            analysis_cutoff, timezone, price_semantics,
            minimum_weighted_coverage, input_hash, result_hash
     FROM benchmark_metric_run
     WHERE benchmark_metric_run_id = ?`,
  ).get(runId) as MetricRunRow | undefined;
  if (!row) throw new TypeError(`unknown benchmark metric run: ${runId}`);
  return row;
}

function panelRows(db: DatabaseSync, panelFamilyId: string): PanelRow[] {
  const rows = db.prepare(
    `SELECT panel_id, panel_label, panel_size, effective_from
     FROM benchmark_panel
     WHERE panel_family_id = ?
     ORDER BY panel_size, panel_id`,
  ).all(panelFamilyId) as PanelRow[];
  if (rows.length === 0) throw new TypeError(`panel family ${panelFamilyId} has no panels`);
  return rows;
}

function memberRows(db: DatabaseSync, panelId: string): MemberRow[] {
  return db.prepare(
    `SELECT panel_id, player_id, stratum_id, anchor_instrument_id,
            population_weight, admission_rank
     FROM benchmark_panel_member
     WHERE panel_id = ?
     ORDER BY admission_rank, player_id`,
  ).all(panelId) as MemberRow[];
}

function frozenReturns(
  db: DatabaseSync,
  metricRunId: string,
  timezone: string,
): Map<string, Map<string, ReturnPoint>> {
  const rows = db.prepare(
    `SELECT instrument_id, source_snapshot_id, source_timestamp,
            observed_at, value, quality_status
     FROM benchmark_metric_input_price
     WHERE benchmark_metric_run_id = ?
     ORDER BY instrument_id, source_timestamp, observed_at, source_snapshot_id`,
  ).all(metricRunId) as FrozenPriceRow[];
  if (rows.length === 0) throw new TypeError(`benchmark metric run ${metricRunId} has no frozen prices`);

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

  const pricesByInstrument = new Map<string, Array<FrozenPriceRow & { date: string; valid: boolean }>>();
  for (const point of daily.values()) {
    const values = pricesByInstrument.get(point.instrument_id) ?? [];
    values.push(point);
    pricesByInstrument.set(point.instrument_id, values);
  }

  const result = new Map<string, Map<string, ReturnPoint>>();
  for (const [instrumentId, points] of pricesByInstrument) {
    points.sort((left, right) => left.date.localeCompare(right.date));
    const byDate = new Map(points.map((point) => [point.date, point]));
    const returns = new Map<string, ReturnPoint>();
    for (const point of points) {
      const previous = byDate.get(previousDate(point.date));
      if (!previous || !previous.valid || !point.valid) {
        returns.set(point.date, { value: null, valid: false });
      } else {
        returns.set(point.date, {
          value: round(point.value! / previous.value! - 1),
          valid: true,
        });
      }
    }
    result.set(instrumentId, returns);
  }
  return result;
}

function baseMetricRows(
  db: DatabaseSync,
  metricRunId: string,
  panelId: string,
): BaseMetricRow[] {
  return db.prepare(
    `SELECT panel_id, metric_date, period_type, metric_name, value, status
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ? AND panel_id = ?
     ORDER BY metric_date, metric_name`,
  ).all(metricRunId, panelId) as BaseMetricRow[];
}

function deterministicIndex(
  sampleSeed: string,
  panelId: string,
  replicate: number,
  stratumId: string,
  draw: number,
  size: number,
): number {
  const digest = createHash("sha256")
    .update(sampleSeed)
    .update("\0")
    .update(panelId)
    .update("\0")
    .update(String(replicate))
    .update("\0")
    .update(stratumId)
    .update("\0")
    .update(String(draw))
    .digest();
  return Number(digest.readBigUInt64BE(0) % BigInt(size));
}

function emptyDistribution(replicates: number): Distribution {
  return { values: new Float64Array(replicates), count: 0 };
}

function pushDistribution(distribution: Distribution, value: number): void {
  distribution.values[distribution.count] = value;
  distribution.count += 1;
}

function distributionValues(distribution: Distribution): number[] {
  return Array.from(distribution.values.subarray(0, distribution.count));
}

function effectiveWeight(
  counts: Uint16Array,
  members: MemberRow[],
  index: number,
): number {
  return counts[index]! * members[index]!.population_weight;
}

function weightedQuantileFromSorted(
  sortedIndices: number[],
  values: Float64Array,
  counts: Uint16Array,
  members: MemberRow[],
  totalWeight: number,
  probability: number,
): number {
  const target = probability * totalWeight;
  let cumulative = 0;
  let fallback: number | null = null;
  for (const index of sortedIndices) {
    const weight = effectiveWeight(counts, members, index);
    if (weight <= 0) continue;
    fallback = values[index]!;
    cumulative += weight;
    if (cumulative >= target) return values[index]!;
  }
  if (fallback === null) throw new TypeError("weighted quantile has no sampled values");
  return fallback;
}

function weightedMeanFromSorted(
  sortedIndices: number[],
  values: Float64Array,
  counts: Uint16Array,
  members: MemberRow[],
  totalWeight: number,
): number {
  let weightedSum = 0;
  let observedWeight = 0;
  for (const index of sortedIndices) {
    const weight = effectiveWeight(counts, members, index);
    if (weight <= 0) continue;
    weightedSum += values[index]! * weight;
    observedWeight += weight;
  }
  if (observedWeight <= 0 || Math.abs(observedWeight - totalWeight) > 0.000001) {
    throw new TypeError("weighted mean bootstrap weight does not match valid weight");
  }
  return weightedSum / observedWeight;
}

function weightedMadFromSorted(
  sortedIndices: number[],
  values: Float64Array,
  counts: Uint16Array,
  members: MemberRow[],
  totalWeight: number,
  center: number,
): number {
  let right = 0;
  while (right < sortedIndices.length && values[sortedIndices[right]!]! < center) right += 1;
  let left = right - 1;
  let cumulative = 0;
  const target = totalWeight * 0.5;
  let fallback = 0;

  while (left >= 0 || right < sortedIndices.length) {
    while (left >= 0 && effectiveWeight(counts, members, sortedIndices[left]!) <= 0) left -= 1;
    while (
      right < sortedIndices.length &&
      effectiveWeight(counts, members, sortedIndices[right]!) <= 0
    ) right += 1;
    if (left < 0 && right >= sortedIndices.length) break;

    const leftDeviation = left >= 0
      ? Math.abs(values[sortedIndices[left]!]! - center)
      : Number.POSITIVE_INFINITY;
    const rightDeviation = right < sortedIndices.length
      ? Math.abs(values[sortedIndices[right]!]! - center)
      : Number.POSITIVE_INFINITY;
    const useLeft = leftDeviation <= rightDeviation;
    const index = useLeft ? sortedIndices[left--]! : sortedIndices[right++]!;
    const deviation = useLeft ? leftDeviation : rightDeviation;
    const weight = effectiveWeight(counts, members, index);
    if (weight <= 0) continue;
    fallback = deviation;
    cumulative += weight;
    if (cumulative >= target) return deviation;
  }
  return fallback;
}

function bootstrapPanel(
  panel: PanelRow,
  members: MemberRow[],
  returns: Map<string, Map<string, ReturnPoint>>,
  baseRows: BaseMetricRow[],
  input: {
    metricVersion: string;
    replicates: number;
    confidenceLevel: number;
    sampleSeed: string;
    minimumValidReplicateRatio: number;
    minimumWeightedCoverage: number;
  },
): UncertaintyRow[] {
  if (members.length !== Number(panel.panel_size)) {
    throw new TypeError(`panel ${panel.panel_id} has ${members.length} members, expected ${String(panel.panel_size)}`);
  }
  const returnAggregation = benchmarkReturnAggregation(input.metricVersion);
  const byStratum = new Map<string, number[]>();
  members.forEach((member, index) => {
    if (!Number.isFinite(member.population_weight) || member.population_weight <= 0) {
      throw new TypeError(`panel ${panel.panel_id} has invalid population weight`);
    }
    const indices = byStratum.get(member.stratum_id) ?? [];
    indices.push(index);
    byStratum.set(member.stratum_id, indices);
  });
  const stratumSizes = Object.fromEntries(
    [...byStratum.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([stratum, indices]) => [stratum, indices.length]),
  );
  const supported = [...byStratum.values()].every(
    (indices) => indices.length >= MINIMUM_BOOTSTRAP_STRATUM_SIZE,
  );

  const returnRows = baseRows.filter((row) => row.metric_name === "RETURN_1D");
  const baseByKey = new Map(baseRows.map((row) => [`${row.metric_date}\0${row.metric_name}`, row]));
  const dates = returnRows.map((row) => row.metric_date);
  const distributions = new Map<string, DateDistributions>();
  const valuesByDate = new Map<string, Float64Array>();
  const sortedByDate = new Map<string, number[]>();

  for (const row of returnRows) {
    if (row.status !== "OK" || !supported) continue;
    const values = new Float64Array(members.length);
    values.fill(Number.NaN);
    const validIndices: number[] = [];
    members.forEach((member, index) => {
      const point = returns.get(member.anchor_instrument_id)?.get(row.metric_date);
      if (point?.valid && point.value !== null) {
        values[index] = point.value;
        validIndices.push(index);
      }
    });
    validIndices.sort((left, right) =>
      values[left]! - values[right]! || members[left]!.player_id.localeCompare(members[right]!.player_id),
    );
    valuesByDate.set(row.metric_date, values);
    sortedByDate.set(row.metric_date, validIndices);
    distributions.set(row.metric_date, {
      RETURN_1D: emptyDistribution(input.replicates),
      INDEX: emptyDistribution(input.replicates),
      BREADTH: emptyDistribution(input.replicates),
      IQR: emptyDistribution(input.replicates),
      MAD: emptyDistribution(input.replicates),
    });
  }

  if (supported) {
    const sortedStrata = [...byStratum.entries()].sort(([left], [right]) => left.localeCompare(right));
    const counts = new Uint16Array(members.length);
    for (let replicate = 0; replicate < input.replicates; replicate += 1) {
      counts.fill(0);
      for (const [stratumId, indices] of sortedStrata) {
        for (let draw = 0; draw < indices.length; draw += 1) {
          const selected = deterministicIndex(
            input.sampleSeed,
            panel.panel_id,
            replicate,
            stratumId,
            draw,
            indices.length,
          );
          counts[indices[selected]!] += 1;
        }
      }

      let totalWeight = 0;
      for (let index = 0; index < members.length; index += 1) {
        totalWeight += effectiveWeight(counts, members, index);
      }
      let previousIndexValue: number | null = null;
      let previousIndexDate: string | null = null;

      for (const date of dates) {
        const baseReturn = baseByKey.get(`${date}\0RETURN_1D`)!;
        if (baseReturn.status !== "OK") {
          previousIndexValue = null;
          previousIndexDate = null;
          continue;
        }
        const sortedIndices = sortedByDate.get(date) ?? [];
        const values = valuesByDate.get(date)!;
        let validWeight = 0;
        let positiveWeight = 0;
        for (const index of sortedIndices) {
          const weight = effectiveWeight(counts, members, index);
          if (weight <= 0) continue;
          validWeight += weight;
          if (values[index]! > 0) positiveWeight += weight;
        }
        const coverage = totalWeight === 0 ? 0 : validWeight / totalWeight;
        if (validWeight <= 0 || coverage < input.minimumWeightedCoverage) {
          previousIndexValue = null;
          previousIndexDate = null;
          continue;
        }

        const medianCenter = weightedQuantileFromSorted(
          sortedIndices,
          values,
          counts,
          members,
          validWeight,
          0.5,
        );
        const returnCenter = returnAggregation === "WEIGHTED_MEAN_PLAYER_RETURN"
          ? weightedMeanFromSorted(
              sortedIndices,
              values,
              counts,
              members,
              validWeight,
            )
          : medianCenter;
        const q25 = weightedQuantileFromSorted(
          sortedIndices,
          values,
          counts,
          members,
          validWeight,
          0.25,
        );
        const q75 = weightedQuantileFromSorted(
          sortedIndices,
          values,
          counts,
          members,
          validWeight,
          0.75,
        );
        const mad = weightedMadFromSorted(
          sortedIndices,
          values,
          counts,
          members,
          validWeight,
          medianCenter,
        );
        const target = distributions.get(date)!;
        pushDistribution(target.RETURN_1D, round(returnCenter));
        pushDistribution(target.BREADTH, round(positiveWeight / validWeight));
        pushDistribution(target.IQR, round(q75 - q25));
        pushDistribution(target.MAD, round(mad));

        const continuous =
          previousIndexValue !== null && previousIndexDate === previousDate(date);
        const base = continuous ? previousIndexValue! : 100;
        const indexValue = round(base * (1 + returnCenter));
        pushDistribution(target.INDEX, indexValue);
        previousIndexValue = indexValue;
        previousIndexDate = date;
      }
    }
  }

  const alpha = (1 - input.confidenceLevel) / 2;
  const rows: UncertaintyRow[] = [];
  for (const base of baseRows) {
    const commonDetails = {
      method: BENCHMARK_UNCERTAINTY_METHOD,
      confidence_level: input.confidenceLevel,
      sample_seed: input.sampleSeed,
      minimum_valid_replicate_ratio: input.minimumValidReplicateRatio,
      minimum_bootstrap_stratum_size: MINIMUM_BOOTSTRAP_STRATUM_SIZE,
      stratum_sizes: stratumSizes,
      sampling_unit: "PLAYER",
      sampling_policy: "WITH_REPLACEMENT_WITHIN_STRATUM",
      time_series_policy: "WHOLE_PLAYER_SERIES_PER_REPLICATE",
      metric_version: input.metricVersion,
      return_aggregation: returnAggregation,
    };
    if (base.status !== "OK") {
      rows.push({
        panel_id: panel.panel_id,
        metric_date: base.metric_date,
        period_type: base.period_type,
        metric_name: base.metric_name,
        point_value: null,
        lower_value: null,
        upper_value: null,
        status: "BASE_NO_RESULT",
        valid_replicates: 0,
        total_replicates: input.replicates,
        details: { ...commonDetails, reason: "BASE_METRIC_NO_RESULT" },
      });
      continue;
    }
    if (!supported) {
      rows.push({
        panel_id: panel.panel_id,
        metric_date: base.metric_date,
        period_type: base.period_type,
        metric_name: base.metric_name,
        point_value: base.value,
        lower_value: null,
        upper_value: null,
        status: "INSUFFICIENT_UNCERTAINTY_SAMPLE",
        valid_replicates: 0,
        total_replicates: input.replicates,
        details: { ...commonDetails, reason: "STRATUM_BELOW_MINIMUM_SAMPLE" },
      });
      continue;
    }

    const distribution = distributions.get(base.metric_date)?.[base.metric_name];
    const validReplicates = distribution?.count ?? 0;
    const validRatio = validReplicates / input.replicates;
    if (!distribution || validRatio < input.minimumValidReplicateRatio) {
      rows.push({
        panel_id: panel.panel_id,
        metric_date: base.metric_date,
        period_type: base.period_type,
        metric_name: base.metric_name,
        point_value: base.value,
        lower_value: null,
        upper_value: null,
        status: "INSUFFICIENT_UNCERTAINTY_SAMPLE",
        valid_replicates: validReplicates,
        total_replicates: input.replicates,
        details: {
          ...commonDetails,
          reason: "VALID_REPLICATE_RATIO_BELOW_THRESHOLD",
          valid_replicate_ratio: round(validRatio),
        },
      });
      continue;
    }

    const distributionValuesArray = distributionValues(distribution);
    rows.push({
      panel_id: panel.panel_id,
      metric_date: base.metric_date,
      period_type: base.period_type,
      metric_name: base.metric_name,
      point_value: base.value,
      lower_value: round(sampleQuantile(distributionValuesArray, alpha)),
      upper_value: round(sampleQuantile(distributionValuesArray, 1 - alpha)),
      status: "OK",
      valid_replicates: validReplicates,
      total_replicates: input.replicates,
      details: {
        ...commonDetails,
        valid_replicate_ratio: round(validRatio),
        interval: "PERCENTILE",
      },
    });
  }
  return rows;
}

export function runBenchmarkUncertainty(
  db: DatabaseSync,
  input: {
    benchmarkMetricRunId: string;
    uncertaintyVersion?: string;
    replicates?: number;
    confidenceLevel?: number;
    sampleSeed?: string;
    minimumValidReplicateRatio?: number;
    createdAt?: string;
  },
): RunBenchmarkUncertaintyResult {
  const run = metricRun(db, input.benchmarkMetricRunId.trim());
  const uncertaintyVersion = input.uncertaintyVersion ?? BENCHMARK_UNCERTAINTY_VERSION;
  const replicates = normalizeInteger(
    input.replicates ?? DEFAULT_BOOTSTRAP_REPLICATES,
    "replicates",
  );
  const confidenceLevel = normalizeRatio(
    input.confidenceLevel ?? DEFAULT_BOOTSTRAP_CONFIDENCE_LEVEL,
    "confidenceLevel",
    false,
  );
  const minimumValidReplicateRatio = normalizeRatio(
    input.minimumValidReplicateRatio ?? DEFAULT_MINIMUM_VALID_REPLICATE_RATIO,
    "minimumValidReplicateRatio",
    true,
  );
  const sampleSeed = input.sampleSeed ?? DEFAULT_BOOTSTRAP_SAMPLE_SEED;
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (uncertaintyVersion.trim() === "" || sampleSeed.trim() === "") {
    throw new TypeError("uncertaintyVersion and sampleSeed must not be empty");
  }

  const panels = panelRows(db, run.panel_family_id);
  const membersByPanel = new Map<string, MemberRow[]>();
  for (const panel of panels) {
    const members = memberRows(db, panel.panel_id);
    if (members.length !== Number(panel.panel_size)) {
      throw new TypeError(`panel ${panel.panel_id} membership size mismatch`);
    }
    membersByPanel.set(panel.panel_id, members);
  }
  const returns = frozenReturns(db, run.benchmark_metric_run_id, run.timezone);
  const manifest = {
    benchmark_metric_run_id: run.benchmark_metric_run_id,
    benchmark_metric_input_hash: run.input_hash,
    benchmark_metric_result_hash: run.result_hash,
    uncertainty_version: uncertaintyVersion,
    method: BENCHMARK_UNCERTAINTY_METHOD,
    replicates,
    confidence_level: confidenceLevel,
    sample_seed: sampleSeed,
    minimum_valid_replicate_ratio: minimumValidReplicateRatio,
    panels: panels.map((panel) => ({
      panel_id: panel.panel_id,
      panel_size: Number(panel.panel_size),
      members: membersByPanel.get(panel.panel_id)!.map((member) => ({
        player_id: member.player_id,
        stratum_id: member.stratum_id,
        anchor_instrument_id: member.anchor_instrument_id,
        population_weight: member.population_weight,
      })),
    })),
  };
  const inputHash = sha256(canonicalJson(manifest));
  const uncertaintyRunId = deterministicId("benchmark_uncertainty_run", inputHash);

  const rows: UncertaintyRow[] = [];
  for (const panel of panels) {
    rows.push(...bootstrapPanel(
      panel,
      membersByPanel.get(panel.panel_id)!,
      returns,
      baseMetricRows(db, run.benchmark_metric_run_id, panel.panel_id),
      {
        metricVersion: run.metric_version,
        replicates,
        confidenceLevel,
        sampleSeed,
        minimumValidReplicateRatio,
        minimumWeightedCoverage: run.minimum_weighted_coverage,
      },
    ));
  }
  rows.sort((left, right) =>
    `${left.panel_id}\0${left.metric_date}\0${left.metric_name}`.localeCompare(
      `${right.panel_id}\0${right.metric_date}\0${right.metric_name}`,
    ),
  );
  const resultHash = sha256(canonicalJson(rows));

  db.exec("BEGIN IMMEDIATE");
  try {
    const runInsert = db.prepare(
      `INSERT OR IGNORE INTO benchmark_uncertainty_run(
        benchmark_uncertainty_run_id, benchmark_metric_run_id,
        uncertainty_version, method, replicates, confidence_level,
        sample_seed, minimum_valid_replicate_ratio, input_hash,
        created_at, status, result_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?)`,
    ).run(
      uncertaintyRunId,
      run.benchmark_metric_run_id,
      uncertaintyVersion,
      BENCHMARK_UNCERTAINTY_METHOD,
      replicates,
      confidenceLevel,
      sampleSeed,
      minimumValidReplicateRatio,
      inputHash,
      createdAt,
      resultHash,
    );

    const existing = db.prepare(
      `SELECT input_hash, result_hash
       FROM benchmark_uncertainty_run
       WHERE benchmark_uncertainty_run_id = ?`,
    ).get(uncertaintyRunId) as { input_hash: string; result_hash: string };
    if (existing.input_hash !== inputHash || existing.result_hash !== resultHash) {
      throw new TypeError(`benchmark uncertainty run identity conflict for ${uncertaintyRunId}`);
    }

    const insert = db.prepare(
      `INSERT OR IGNORE INTO benchmark_metric_uncertainty(
        benchmark_uncertainty_run_id, panel_id, metric_date, period_type,
        metric_name, point_value, lower_value, upper_value, status,
        valid_replicates, total_replicates, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(
        uncertaintyRunId,
        row.panel_id,
        row.metric_date,
        row.period_type,
        row.metric_name,
        row.point_value,
        row.lower_value,
        row.upper_value,
        row.status,
        row.valid_replicates,
        row.total_replicates,
        canonicalJson(row.details),
      );
    }
    const persisted = db.prepare(
      `SELECT COUNT(*) AS count
       FROM benchmark_metric_uncertainty
       WHERE benchmark_uncertainty_run_id = ?`,
    ).get(uncertaintyRunId) as { count: number | bigint };
    if (Number(persisted.count) !== rows.length) {
      throw new Error(
        `uncertainty run ${uncertaintyRunId} persisted ${String(persisted.count)} rows, expected ${rows.length}`,
      );
    }
    db.exec("COMMIT");

    const summaries = panels.map((panel) => {
      const panelRows = rows.filter((row) => row.panel_id === panel.panel_id);
      return {
        panel_id: panel.panel_id,
        panel_label: panel.panel_label,
        panel_size: Number(panel.panel_size),
        uncertainty_rows: panelRows.length,
        ok_rows: panelRows.filter((row) => row.status === "OK").length,
        base_no_result_rows: panelRows.filter((row) => row.status === "BASE_NO_RESULT").length,
        insufficient_rows: panelRows.filter(
          (row) => row.status === "INSUFFICIENT_UNCERTAINTY_SAMPLE",
        ).length,
        return_ci_dates: panelRows.filter(
          (row) => row.metric_name === "RETURN_1D" && row.status === "OK",
        ).length,
      };
    });
    return {
      benchmark_uncertainty_run_id: uncertaintyRunId,
      benchmark_metric_run_id: run.benchmark_metric_run_id,
      panel_family_id: run.panel_family_id,
      uncertainty_version: uncertaintyVersion,
      method: BENCHMARK_UNCERTAINTY_METHOD,
      replicates,
      confidence_level: confidenceLevel,
      sample_seed: sampleSeed,
      minimum_valid_replicate_ratio: minimumValidReplicateRatio,
      input_hash: inputHash,
      uncertainty_rows: rows.length,
      ok_rows: rows.filter((row) => row.status === "OK").length,
      base_no_result_rows: rows.filter((row) => row.status === "BASE_NO_RESULT").length,
      insufficient_rows: rows.filter(
        (row) => row.status === "INSUFFICIENT_UNCERTAINTY_SAMPLE",
      ).length,
      result_hash: resultHash,
      panels: summaries,
      created: Number(runInsert.changes) === 1,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
