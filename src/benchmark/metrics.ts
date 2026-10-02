import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const BENCHMARK_METRIC_VERSION = "market-benchmark-metrics-v1";
export const BENCHMARK_METRIC_V2_VERSION = "market-benchmark-metrics-v2";
export const DEFAULT_BENCHMARK_TIMEZONE = "Asia/Seoul";
export const DEFAULT_BENCHMARK_PRICE_SEMANTICS = "MARKET_REFERENCE_PRICE";
export const DEFAULT_MINIMUM_WEIGHTED_COVERAGE = 0.8;

export type BenchmarkMetricName =
  | "RETURN_1D"
  | "INDEX"
  | "BREADTH"
  | "IQR"
  | "MAD";
export type BenchmarkMetricStatus = "OK" | "NO_RESULT";
export type BenchmarkPeriodType = "FIXED_PANEL_BACKCAST" | "CONTEMPORANEOUS";
export type BenchmarkReturnAggregation =
  | "WEIGHTED_MEDIAN_PLAYER_RETURN"
  | "WEIGHTED_MEAN_PLAYER_RETURN";

export function benchmarkReturnAggregation(metricVersion: string): BenchmarkReturnAggregation {
  return metricVersion === BENCHMARK_METRIC_V2_VERSION
    ? "WEIGHTED_MEAN_PLAYER_RETURN"
    : "WEIGHTED_MEDIAN_PLAYER_RETURN";
}

interface PanelRow {
  panel_id: string;
  panel_label: string;
  panel_size: number | bigint;
  effective_from: string;
}

interface PanelMemberRow {
  panel_id: string;
  player_id: string;
  anchor_instrument_id: string;
  population_weight: number;
}

interface FrozenPricePoint {
  instrument_id: string;
  source_snapshot_id: string;
  source_timestamp: string;
  observed_at: string;
  value: number | null;
  price_semantics: string;
  quality_status: string;
}

interface DailyPricePoint extends FrozenPricePoint {
  date: string;
  valid: boolean;
}

interface ReturnPoint {
  date: string;
  value: number | null;
  valid: boolean;
  reason: string | null;
}

interface WeightedValue {
  value: number;
  weight: number;
}

interface MetricRow {
  panel_id: string;
  metric_date: string;
  period_type: BenchmarkPeriodType;
  metric_name: BenchmarkMetricName;
  value: number | null;
  status: BenchmarkMetricStatus;
  valid_count: number;
  total_count: number;
  valid_weight: number;
  total_weight: number;
  weighted_coverage: number;
  details: Record<string, unknown>;
}

export interface BenchmarkMetricPanelSummary {
  panel_id: string;
  panel_label: string;
  panel_size: number;
  metric_dates: number;
  ok_return_dates: number;
  no_result_return_dates: number;
  fixed_panel_backcast_dates: number;
  contemporaneous_dates: number;
}

export interface RunBenchmarkMetricsResult {
  benchmark_metric_run_id: string;
  panel_family_id: string;
  metric_version: string;
  analysis_cutoff: string;
  timezone: string;
  price_semantics: string;
  minimum_weighted_coverage: number;
  input_hash: string;
  input_price_points: number;
  metric_rows: number;
  metric_dates: number;
  result_hash: string;
  panels: BenchmarkMetricPanelSummary[];
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
    throw new TypeError("benchmark metric payload must contain finite JSON values");
  }
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeTimestamp(value: string, field: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${field} must include an explicit timezone`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
  return parsed.toISOString();
}

function normalizeCoverage(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new TypeError("minimumWeightedCoverage must be > 0 and <= 1");
  }
  return value;
}

function dateInTimezone(timestamp: string, timezone: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`invalid timestamp: ${timestamp}`);
  }
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
  if (!year || !month || !day) {
    throw new TypeError(`cannot format date in timezone ${timezone}`);
  }
  return `${year}-${month}-${day}`;
}

function previousDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function placeholders(count: number): string {
  if (!Number.isInteger(count) || count <= 0) {
    throw new TypeError("placeholder count must be a positive integer");
  }
  return Array.from({ length: count }, () => "?").join(", ");
}

function assertWeightedValues(values: WeightedValue[]): void {
  if (values.length === 0) {
    throw new TypeError("weighted statistic requires at least one value");
  }
  for (const item of values) {
    if (!Number.isFinite(item.value)) {
      throw new TypeError("weighted statistic values must be finite");
    }
    if (!Number.isFinite(item.weight) || item.weight <= 0) {
      throw new TypeError("weighted statistic weights must be positive finite numbers");
    }
  }
}

export function weightedQuantile(values: WeightedValue[], probability: number): number {
  assertWeightedValues(values);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new TypeError("weighted quantile probability must be between 0 and 1");
  }
  const sorted = [...values].sort(
    (left, right) => left.value - right.value || left.weight - right.weight,
  );
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);
  const target = probability * totalWeight;
  if (probability === 0) return sorted[0]!.value;
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

export function weightedMean(values: WeightedValue[]): number {
  assertWeightedValues(values);
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  return values.reduce(
    (sum, item) => sum + item.value * item.weight,
    0,
  ) / totalWeight;
}

export function weightedDispersion(values: WeightedValue[]): {
  iqr: number;
  mad: number;
} {
  const center = weightedMedian(values);
  return {
    iqr: round(
      weightedQuantile(values, 0.75) - weightedQuantile(values, 0.25),
    ),
    mad: round(
      weightedMedian(
        values.map((item) => ({
          value: Math.abs(item.value - center),
          weight: item.weight,
        })),
      ),
    ),
  };
}

function panelRows(db: DatabaseSync, panelFamilyId: string): PanelRow[] {
  const rows = db
    .prepare(
      `SELECT panel_id, panel_label, panel_size, effective_from
       FROM benchmark_panel
       WHERE panel_family_id = ?
       ORDER BY panel_size, panel_id`,
    )
    .all(panelFamilyId) as PanelRow[];
  if (rows.length === 0) {
    throw new TypeError(`panel family ${panelFamilyId} contains no panels`);
  }
  return rows;
}

function panelMembers(
  db: DatabaseSync,
  panels: PanelRow[],
): Map<string, PanelMemberRow[]> {
  const result = new Map<string, PanelMemberRow[]>();
  let previousPlayers = new Set<string>();

  for (const [index, panel] of panels.entries()) {
    const rows = db
      .prepare(
        `SELECT panel_id, player_id, anchor_instrument_id, population_weight
         FROM benchmark_panel_member
         WHERE panel_id = ?
         ORDER BY admission_rank, player_id`,
      )
      .all(panel.panel_id) as PanelMemberRow[];
    const expectedSize = Number(panel.panel_size);
    if (rows.length !== expectedSize) {
      throw new TypeError(
        `panel ${panel.panel_id} has ${rows.length} members, expected ${expectedSize}`,
      );
    }
    const players = new Set(rows.map((row) => row.player_id));
    if (players.size !== rows.length) {
      throw new TypeError(`panel ${panel.panel_id} contains duplicate players`);
    }
    for (const row of rows) {
      if (!Number.isFinite(row.population_weight) || row.population_weight <= 0) {
        throw new TypeError(
          `panel ${panel.panel_id} player ${row.player_id} has invalid population weight`,
        );
      }
    }
    if (index > 0) {
      for (const playerId of previousPlayers) {
        if (!players.has(playerId)) {
          throw new TypeError(
            `panel family ${panels[0]!.panel_id} is not nested: ${playerId} disappears from ${panel.panel_id}`,
          );
        }
      }
    }
    previousPlayers = players;
    result.set(panel.panel_id, rows);
  }
  return result;
}

export function resolveBenchmarkMetricPanelFamilyId(
  db: DatabaseSync,
  requested?: string,
): string {
  if (requested !== undefined) {
    const value = requested.trim();
    if (value === "") throw new TypeError("panelFamilyId must not be empty");
    const row = db
      .prepare(
        `SELECT panel_family_id
         FROM benchmark_panel_family
         WHERE panel_family_id = ?`,
      )
      .get(value) as { panel_family_id: string } | undefined;
    if (!row) throw new TypeError(`unknown panel family: ${value}`);
    return row.panel_family_id;
  }
  const row = db
    .prepare(
      `SELECT panel_family_id
       FROM benchmark_panel_family
       WHERE stratification_basis = 'PRICE_ONLY'
       ORDER BY effective_from DESC, created_at DESC, panel_family_id DESC
       LIMIT 1`,
    )
    .get() as { panel_family_id: string } | undefined;
  if (!row) {
    throw new TypeError("no PRICE_ONLY benchmark panel family exists");
  }
  return row.panel_family_id;
}

export function resolveBenchmarkMetricAnalysisCutoff(
  db: DatabaseSync,
  panelFamilyId: string,
  priceSemantics = DEFAULT_BENCHMARK_PRICE_SEMANTICS,
): string {
  const panels = panelRows(db, panelFamilyId);
  const largest = panels.at(-1)!;
  const members = panelMembers(db, [largest]).get(largest.panel_id)!;
  const instrumentIds = members.map((member) => member.anchor_instrument_id);
  const row = db
    .prepare(
      `SELECT MAX(pp.observed_at) AS cutoff
       FROM price_point pp
       JOIN source_snapshot ss ON ss.source_snapshot_id = pp.source_snapshot_id
       WHERE pp.instrument_id IN (${placeholders(instrumentIds.length)})
         AND pp.price_semantics = ?
         AND ss.parse_status = 'PARSED'`,
    )
    .get(...instrumentIds, priceSemantics) as { cutoff: string | null };
  if (!row.cutoff) {
    throw new TypeError(
      `no ${priceSemantics} price observations exist for panel family ${panelFamilyId}`,
    );
  }
  return normalizeTimestamp(row.cutoff, "analysis cutoff");
}

function freezePricePoints(
  db: DatabaseSync,
  instrumentIds: string[],
  analysisCutoff: string,
  priceSemantics: string,
): FrozenPricePoint[] {
  const rows = db
    .prepare(
      `SELECT pp.instrument_id, pp.source_snapshot_id, pp.source_timestamp,
              pp.observed_at, pp.value, pp.price_semantics, pp.quality_status
       FROM price_point pp
       JOIN source_snapshot ss ON ss.source_snapshot_id = pp.source_snapshot_id
       WHERE pp.instrument_id IN (${placeholders(instrumentIds.length)})
         AND pp.source_timestamp <= ?
         AND pp.observed_at <= ?
         AND ss.observed_at <= ?
         AND ss.parse_status = 'PARSED'
         AND pp.price_semantics = ?
       ORDER BY pp.instrument_id, pp.source_timestamp,
                pp.observed_at, pp.source_snapshot_id`,
    )
    .all(
      ...instrumentIds,
      analysisCutoff,
      analysisCutoff,
      analysisCutoff,
      priceSemantics,
    ) as Array<{
    instrument_id: string;
    source_snapshot_id: string;
    source_timestamp: string;
    observed_at: string;
    value: number | bigint | null;
    price_semantics: string;
    quality_status: string;
  }>;

  const chosen = new Map<string, FrozenPricePoint>();
  for (const row of rows) {
    const key = `${row.instrument_id}\0${row.source_timestamp}`;
    const candidate: FrozenPricePoint = {
      instrument_id: row.instrument_id,
      source_snapshot_id: row.source_snapshot_id,
      source_timestamp: row.source_timestamp,
      observed_at: row.observed_at,
      value: row.value === null ? null : Number(row.value),
      price_semantics: row.price_semantics,
      quality_status: row.quality_status,
    };
    const previous = chosen.get(key);
    if (
      !previous ||
      candidate.observed_at > previous.observed_at ||
      (candidate.observed_at === previous.observed_at &&
        candidate.source_snapshot_id > previous.source_snapshot_id)
    ) {
      chosen.set(key, candidate);
    }
  }
  const result = [...chosen.values()].sort((left, right) =>
    `${left.instrument_id}\0${left.source_timestamp}`.localeCompare(
      `${right.instrument_id}\0${right.source_timestamp}`,
    ),
  );
  if (result.length === 0) {
    throw new TypeError(
      `no eligible frozen price points exist at or before ${analysisCutoff}`,
    );
  }
  return result;
}

function dailyPrices(
  frozen: FrozenPricePoint[],
  timezone: string,
): Map<string, DailyPricePoint[]> {
  const chosen = new Map<string, DailyPricePoint>();
  for (const point of frozen) {
    const date = dateInTimezone(point.source_timestamp, timezone);
    const key = `${point.instrument_id}\0${date}`;
    const candidate: DailyPricePoint = {
      ...point,
      date,
      valid:
        (point.quality_status === "VALID" ||
          point.quality_status === "UNCHANGED_RUN") &&
        point.value !== null &&
        point.value > 0,
    };
    const previous = chosen.get(key);
    if (
      !previous ||
      candidate.source_timestamp > previous.source_timestamp ||
      (candidate.source_timestamp === previous.source_timestamp &&
        candidate.observed_at > previous.observed_at) ||
      (candidate.source_timestamp === previous.source_timestamp &&
        candidate.observed_at === previous.observed_at &&
        candidate.source_snapshot_id > previous.source_snapshot_id)
    ) {
      chosen.set(key, candidate);
    }
  }

  const result = new Map<string, DailyPricePoint[]>();
  for (const point of chosen.values()) {
    const values = result.get(point.instrument_id) ?? [];
    values.push(point);
    result.set(point.instrument_id, values);
  }
  for (const values of result.values()) {
    values.sort((left, right) => left.date.localeCompare(right.date));
  }
  return result;
}

function instrumentReturns(
  prices: Map<string, DailyPricePoint[]>,
): Map<string, Map<string, ReturnPoint>> {
  const result = new Map<string, Map<string, ReturnPoint>>();
  for (const [instrumentId, points] of prices) {
    const byDate = new Map(points.map((point) => [point.date, point]));
    const returns = new Map<string, ReturnPoint>();
    for (const point of points) {
      const previous = byDate.get(previousDate(point.date));
      if (!previous) {
        returns.set(point.date, {
          date: point.date,
          value: null,
          valid: false,
          reason: "MISSING_PREVIOUS_DAY",
        });
      } else if (!previous.valid) {
        returns.set(point.date, {
          date: point.date,
          value: null,
          valid: false,
          reason: `INVALID_PREVIOUS_PRICE:${previous.quality_status}`,
        });
      } else if (!point.valid) {
        returns.set(point.date, {
          date: point.date,
          value: null,
          valid: false,
          reason: `INVALID_CURRENT_PRICE:${point.quality_status}`,
        });
      } else {
        returns.set(point.date, {
          date: point.date,
          value: round(point.value! / previous.value! - 1),
          valid: true,
          reason: null,
        });
      }
    }
    result.set(instrumentId, returns);
  }
  return result;
}

function periodType(
  date: string,
  effectiveFrom: string,
  timezone: string,
): BenchmarkPeriodType {
  return date < dateInTimezone(effectiveFrom, timezone)
    ? "FIXED_PANEL_BACKCAST"
    : "CONTEMPORANEOUS";
}

function weightedRowsForPanel(
  panel: PanelRow,
  members: PanelMemberRow[],
  returns: Map<string, Map<string, ReturnPoint>>,
  allDates: string[],
  timezone: string,
  metricVersion: string,
  minimumWeightedCoverage: number,
): MetricRow[] {
  const totalWeight = members.reduce(
    (sum, member) => sum + member.population_weight,
    0,
  );
  const returnAggregation = benchmarkReturnAggregation(metricVersion);
  const effectiveFrom = panel.effective_from;
  const rows: MetricRow[] = [];
  const returnRows = new Map<string, MetricRow>();

  for (const date of allDates) {
    const valid: WeightedValue[] = [];
    let positiveWeight = 0;
    for (const member of members) {
      const point = returns.get(member.anchor_instrument_id)?.get(date);
      if (!point?.valid || point.value === null) continue;
      valid.push({ value: point.value, weight: member.population_weight });
      if (point.value > 0) positiveWeight += member.population_weight;
    }
    const validWeight = valid.reduce((sum, item) => sum + item.weight, 0);
    const coverage = totalWeight === 0 ? 0 : validWeight / totalWeight;
    const ok = valid.length > 0 && coverage >= minimumWeightedCoverage;
    const common = {
      panel_id: panel.panel_id,
      metric_date: date,
      period_type: periodType(date, effectiveFrom, timezone),
      status: (ok ? "OK" : "NO_RESULT") as BenchmarkMetricStatus,
      valid_count: valid.length,
      total_count: members.length,
      valid_weight: round(validWeight),
      total_weight: round(totalWeight),
      weighted_coverage: round(coverage),
    };
    const noResultDetails = {
      reason: valid.length === 0
        ? "NO_VALID_PLAYER_RETURN"
        : "WEIGHTED_COVERAGE_BELOW_THRESHOLD",
      minimum_weighted_coverage: minimumWeightedCoverage,
      weight_policy: "NO_NONRESPONSE_WEIGHT_REDISTRIBUTION",
    };
    const center = ok
      ? round(
          returnAggregation === "WEIGHTED_MEAN_PLAYER_RETURN"
            ? weightedMean(valid)
            : weightedMedian(valid),
        )
      : null;
    const spread = ok ? weightedDispersion(valid) : null;
    const returnRow: MetricRow = {
      ...common,
      metric_name: "RETURN_1D",
      value: center,
      details: ok
        ? {
            aggregation: returnAggregation,
            minimum_weighted_coverage: minimumWeightedCoverage,
            weight_policy: "NO_NONRESPONSE_WEIGHT_REDISTRIBUTION",
          }
        : noResultDetails,
    };
    returnRows.set(date, returnRow);
    rows.push(returnRow);
    rows.push({
      ...common,
      metric_name: "BREADTH",
      value: ok ? round(positiveWeight / validWeight) : null,
      details: ok
        ? {
            aggregation: "WEIGHTED_POSITIVE_RETURN_SHARE",
            denominator: "VALID_PLAYER_WEIGHT",
          }
        : noResultDetails,
    });
    rows.push({
      ...common,
      metric_name: "IQR",
      value: spread?.iqr ?? null,
      details: ok
        ? { aggregation: "WEIGHTED_Q75_MINUS_Q25" }
        : noResultDetails,
    });
    rows.push({
      ...common,
      metric_name: "MAD",
      value: spread?.mad ?? null,
      details: ok
        ? { aggregation: "WEIGHTED_MEDIAN_ABSOLUTE_DEVIATION" }
        : noResultDetails,
    });
  }

  let previousIndex: number | null = null;
  let previousIndexDate: string | null = null;
  for (const date of allDates) {
    const source = returnRows.get(date)!;
    if (source.status !== "OK") {
      rows.push({
        ...source,
        metric_name: "INDEX",
        value: null,
        details: { reason: "RETURN_NO_RESULT" },
      });
      previousIndex = null;
      previousIndexDate = null;
      continue;
    }
    const continuous =
      previousIndex !== null && previousIndexDate === previousDate(date);
    const base = continuous ? previousIndex! : 100;
    const value = round(base * (1 + source.value!));
    rows.push({
      ...source,
      metric_name: "INDEX",
      value,
      details: {
        aggregation: "CHAINED_WEIGHTED_RETURN_INDEX",
        segment_start: !continuous,
        base_index: base,
      },
    });
    previousIndex = value;
    previousIndexDate = date;
  }
  return rows;
}

export function runBenchmarkMetrics(
  db: DatabaseSync,
  input: {
    panelFamilyId: string;
    analysisCutoff: string;
    metricVersion?: string;
    timezone?: string;
    priceSemantics?: string;
    minimumWeightedCoverage?: number;
    createdAt?: string;
  },
): RunBenchmarkMetricsResult {
  const panelFamilyId = input.panelFamilyId.trim();
  if (panelFamilyId === "") throw new TypeError("panelFamilyId must not be empty");
  const family = db
    .prepare(
      `SELECT panel_family_id, panel_version, stratification_basis
       FROM benchmark_panel_family
       WHERE panel_family_id = ?`,
    )
    .get(panelFamilyId) as
    | {
        panel_family_id: string;
        panel_version: string;
        stratification_basis: string;
      }
    | undefined;
  if (!family) throw new TypeError(`unknown panel family: ${panelFamilyId}`);
  if (family.stratification_basis !== "PRICE_ONLY") {
    throw new TypeError(
      `benchmark metrics require PRICE_ONLY panel family, got ${family.stratification_basis}`,
    );
  }

  const analysisCutoff = normalizeTimestamp(input.analysisCutoff, "analysisCutoff");
  const createdAt = normalizeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "createdAt",
  );
  const metricVersion = input.metricVersion ?? BENCHMARK_METRIC_VERSION;
  const timezone = input.timezone ?? DEFAULT_BENCHMARK_TIMEZONE;
  const priceSemantics =
    input.priceSemantics ?? DEFAULT_BENCHMARK_PRICE_SEMANTICS;
  const minimumWeightedCoverage = normalizeCoverage(
    input.minimumWeightedCoverage ?? DEFAULT_MINIMUM_WEIGHTED_COVERAGE,
  );
  if (metricVersion.trim() === "" || timezone.trim() === "" || priceSemantics.trim() === "") {
    throw new TypeError("metricVersion, timezone and priceSemantics must not be empty");
  }

  const panels = panelRows(db, panelFamilyId);
  const membersByPanel = panelMembers(db, panels);
  const maxPanel = panels.at(-1)!;
  const maxMembers = membersByPanel.get(maxPanel.panel_id)!;
  const instrumentIds = maxMembers.map((member) => member.anchor_instrument_id);
  const frozen = freezePricePoints(
    db,
    instrumentIds,
    analysisCutoff,
    priceSemantics,
  );
  const availableInstrumentIds = new Set(frozen.map((row) => row.instrument_id));
  for (const instrumentId of instrumentIds) {
    if (!availableInstrumentIds.has(instrumentId)) {
      throw new TypeError(
        `panel instrument ${instrumentId} has no frozen price input at ${analysisCutoff}`,
      );
    }
  }

  const prices = dailyPrices(frozen, timezone);
  const returns = instrumentReturns(prices);
  const allDates = [
    ...new Set(
      [...prices.values()].flatMap((points) => points.map((point) => point.date)),
    ),
  ].sort();
  if (allDates.length === 0) {
    throw new TypeError("benchmark metric input resolved to zero market dates");
  }

  const manifest = {
    panel_family_id: panelFamilyId,
    panel_version: family.panel_version,
    metric_version: metricVersion,
    analysis_cutoff: analysisCutoff,
    timezone,
    price_semantics: priceSemantics,
    minimum_weighted_coverage: minimumWeightedCoverage,
    panels: panels.map((panel) => ({
      panel_id: panel.panel_id,
      panel_label: panel.panel_label,
      panel_size: Number(panel.panel_size),
      effective_from: panel.effective_from,
      members: membersByPanel.get(panel.panel_id)!.map((member) => ({
        player_id: member.player_id,
        anchor_instrument_id: member.anchor_instrument_id,
        population_weight: member.population_weight,
      })),
    })),
    frozen_price_points: frozen,
  };
  const inputHash = sha256(canonicalJson(manifest));
  const runId = deterministicId("benchmark_metric_run", inputHash);

  const rows = panels.flatMap((panel) =>
    weightedRowsForPanel(
      panel,
      membersByPanel.get(panel.panel_id)!,
      returns,
      allDates,
      timezone,
      metricVersion,
      minimumWeightedCoverage,
    ),
  );
  rows.sort((left, right) =>
    `${left.panel_id}\0${left.metric_date}\0${left.metric_name}`.localeCompare(
      `${right.panel_id}\0${right.metric_date}\0${right.metric_name}`,
    ),
  );
  const resultHash = sha256(
    canonicalJson(
      rows.map((row) => ({
        ...row,
        details: row.details,
      })),
    ),
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    const runInsert = db
      .prepare(
        `INSERT OR IGNORE INTO benchmark_metric_run(
          benchmark_metric_run_id, panel_family_id, metric_version,
          analysis_cutoff, timezone, price_semantics,
          minimum_weighted_coverage, input_hash, created_at,
          status, result_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?)`,
      )
      .run(
        runId,
        panelFamilyId,
        metricVersion,
        analysisCutoff,
        timezone,
        priceSemantics,
        minimumWeightedCoverage,
        inputHash,
        createdAt,
        resultHash,
      );

    const existingRun = db
      .prepare(
        `SELECT input_hash, result_hash
         FROM benchmark_metric_run
         WHERE benchmark_metric_run_id = ?`,
      )
      .get(runId) as { input_hash: string; result_hash: string };
    if (existingRun.input_hash !== inputHash || existingRun.result_hash !== resultHash) {
      throw new TypeError(`benchmark metric run identity conflict for ${runId}`);
    }

    const inputInsert = db.prepare(
      `INSERT OR IGNORE INTO benchmark_metric_input_price(
        benchmark_metric_run_id, instrument_id, source_snapshot_id,
        source_timestamp, observed_at, value, price_semantics, quality_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const point of frozen) {
      inputInsert.run(
        runId,
        point.instrument_id,
        point.source_snapshot_id,
        point.source_timestamp,
        point.observed_at,
        point.value,
        point.price_semantics,
        point.quality_status,
      );
    }

    const metricInsert = db.prepare(
      `INSERT OR IGNORE INTO benchmark_metric(
        benchmark_metric_run_id, panel_id, metric_date, period_type,
        metric_name, value, status, valid_count, total_count,
        valid_weight, total_weight, weighted_coverage, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      metricInsert.run(
        runId,
        row.panel_id,
        row.metric_date,
        row.period_type,
        row.metric_name,
        row.value,
        row.status,
        row.valid_count,
        row.total_count,
        row.valid_weight,
        row.total_weight,
        row.weighted_coverage,
        canonicalJson(row.details),
      );
    }

    const frozenCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM benchmark_metric_input_price
         WHERE benchmark_metric_run_id = ?`,
      )
      .get(runId) as { count: number | bigint };
    if (Number(frozenCount.count) !== frozen.length) {
      throw new Error(
        `benchmark metric run ${runId} persisted ${String(frozenCount.count)} inputs, expected ${frozen.length}`,
      );
    }
    const metricCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM benchmark_metric
         WHERE benchmark_metric_run_id = ?`,
      )
      .get(runId) as { count: number | bigint };
    if (Number(metricCount.count) !== rows.length) {
      throw new Error(
        `benchmark metric run ${runId} persisted ${String(metricCount.count)} metrics, expected ${rows.length}`,
      );
    }

    db.exec("COMMIT");
    const summaries = panels.map((panel) => {
      const panelRows = rows.filter(
        (row) => row.panel_id === panel.panel_id && row.metric_name === "RETURN_1D",
      );
      return {
        panel_id: panel.panel_id,
        panel_label: panel.panel_label,
        panel_size: Number(panel.panel_size),
        metric_dates: panelRows.length,
        ok_return_dates: panelRows.filter((row) => row.status === "OK").length,
        no_result_return_dates: panelRows.filter((row) => row.status === "NO_RESULT").length,
      };
    });
    return {
      benchmark_metric_run_id: runId,
      panel_family_id: panelFamilyId,
      metric_version: metricVersion,
      analysis_cutoff: analysisCutoff,
      timezone,
      price_semantics: priceSemantics,
      minimum_weighted_coverage: minimumWeightedCoverage,
      input_hash: inputHash,
      input_price_points: frozen.length,
      metric_rows: rows.length,
      metric_dates: allDates.length,
      result_hash: resultHash,
      panels: summaries,
      created: Number(runInsert.changes) === 1,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
