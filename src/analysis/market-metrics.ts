import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

interface MetricThreshold {
  min_valid_count: number;
  min_coverage_ratio: number;
}

interface RegimeParameter {
  regime_id: string;
  event_id: string;
  class_filter: string[];
  grade_min: number | null;
  grade_max: number | null;
}

interface MarketMetricParameters {
  timezone: string;
  price_semantics: string;
  allow_regime_crossing: boolean;
  regimes: RegimeParameter[];
  sample_market: MetricThreshold;
  cross_player_cohort: MetricThreshold;
}

interface DailyPrice {
  date: string;
  source_timestamp: string;
  value: number | null;
  valid: boolean;
  reason: string | null;
}

interface ReturnPoint {
  date: string;
  value: number | null;
  status: "OK" | "NO_RESULT";
  reason: string | null;
}

interface MetricRow {
  metric_date: string;
  scope_type: "INSTRUMENT" | "PLAYER" | "COHORT";
  scope_id: string;
  metric_name: "RETURN_1D" | "INDEX" | "RELATIVE_STRENGTH" | "BREADTH" | "IQR" | "MAD";
  value: number | null;
  status: "OK" | "NO_RESULT";
  valid_count: number;
  total_count: number;
  coverage_ratio: number;
  details: Record<string, unknown>;
}

export interface RunMarketMetricsResult {
  analysis_run_id: string;
  dataset_snapshot_id: string;
  metric_rows: number;
  ok_rows: number;
  no_result_rows: number;
  metric_dates: number;
  result_hash: string;
  created: number;
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
    ) return input;
    throw new TypeError("metric details must contain finite JSON values");
  }
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function numberField(record: Record<string, unknown>, key: string, context: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${context}.${key} must be a finite number`);
  }
  return value;
}

function threshold(value: unknown, context: string): MetricThreshold {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const min_valid_count = numberField(record, "min_valid_count", context);
  const min_coverage_ratio = numberField(record, "min_coverage_ratio", context);
  if (!Number.isInteger(min_valid_count) || min_valid_count < 1) {
    throw new TypeError(`${context}.min_valid_count must be a positive integer`);
  }
  if (min_coverage_ratio <= 0 || min_coverage_ratio > 1) {
    throw new TypeError(`${context}.min_coverage_ratio must be > 0 and <= 1`);
  }
  return { min_valid_count, min_coverage_ratio };
}

function nullableGrade(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 13) {
    throw new TypeError(`${field} must be null or an integer between 1 and 13`);
  }
  return Number(value);
}

function parseRegimes(value: unknown): RegimeParameter[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("analysis parameters.regimes must be an array");
  }
  return value.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new TypeError(`analysis parameters.regimes[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const readString = (key: string): string => {
      const field = record[key];
      if (typeof field !== "string" || field.trim() === "") {
        throw new TypeError(`analysis parameters.regimes[${index}].${key} must be a non-empty string`);
      }
      return field.trim();
    };
    if (!Array.isArray(record.class_filter)) {
      throw new TypeError(`analysis parameters.regimes[${index}].class_filter must be an array`);
    }
    const classFilter = record.class_filter.map((itemValue, itemIndex) => {
      if (typeof itemValue !== "string" || itemValue.trim() === "") {
        throw new TypeError(
          `analysis parameters.regimes[${index}].class_filter[${itemIndex}] must be a non-empty string`,
        );
      }
      return itemValue.trim();
    });
    const gradeMin = nullableGrade(
      record.grade_min,
      `analysis parameters.regimes[${index}].grade_min`,
    );
    const gradeMax = nullableGrade(
      record.grade_max,
      `analysis parameters.regimes[${index}].grade_max`,
    );
    if (gradeMin !== null && gradeMax !== null && gradeMin > gradeMax) {
      throw new TypeError(`analysis parameters.regimes[${index}].grade_min must not exceed grade_max`);
    }
    return {
      regime_id: readString("regime_id"),
      event_id: readString("event_id"),
      class_filter: classFilter,
      grade_min: gradeMin,
      grade_max: gradeMax,
    };
  });
}

export function parseMarketMetricParameters(value: unknown): MarketMetricParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("analysis parameters must be an object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.timezone !== "string" || record.timezone.trim() === "") {
    throw new TypeError("analysis parameters.timezone must be a non-empty string");
  }
  if (typeof record.price_semantics !== "string" || record.price_semantics.trim() === "") {
    throw new TypeError("analysis parameters.price_semantics must be a non-empty string");
  }
  if (record.allow_regime_crossing !== undefined && typeof record.allow_regime_crossing !== "boolean") {
    throw new TypeError("analysis parameters.allow_regime_crossing must be a boolean");
  }
  return {
    timezone: record.timezone,
    price_semantics: record.price_semantics,
    allow_regime_crossing: record.allow_regime_crossing === true,
    regimes: parseRegimes(record.regimes),
    sample_market: threshold(record.sample_market, "analysis parameters.sample_market"),
    cross_player_cohort: threshold(
      record.cross_player_cohort,
      "analysis parameters.cross_player_cohort",
    ),
  };
}

export function median(values: number[]): number {
  if (values.length === 0) throw new TypeError("median requires at least one value");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function quantile(values: number[], p: number): number {
  if (values.length === 0) throw new TypeError("quantile requires at least one value");
  if (p < 0 || p > 1) throw new TypeError("quantile p must be between 0 and 1");
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function dispersion(values: number[]): { iqr: number; mad: number } {
  const center = median(values);
  return {
    iqr: round(quantile(values, 0.75) - quantile(values, 0.25)),
    mad: round(median(values.map((value) => Math.abs(value - center)))),
  };
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
  const read = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!year || !month || !day) throw new TypeError(`cannot format date in ${timezone}`);
  return `${year}-${month}-${day}`;
}

function previousDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

interface RegimeBoundary {
  regime_id: string;
  boundary_at: string;
  boundary_type: "ENTER" | "EXIT";
}

function buildReturns(
  series: DailyPrice[],
  regimeBoundaries: RegimeBoundary[] = [],
): ReturnPoint[] {
  const byDate = new Map(series.map((point) => [point.date, point]));
  return series.map((point) => {
    const previous = byDate.get(previousDate(point.date));
    if (!previous) {
      return { date: point.date, value: null, status: "NO_RESULT", reason: "MISSING_PREVIOUS_DAY" };
    }
    if (!previous.valid) {
      return { date: point.date, value: null, status: "NO_RESULT", reason: previous.reason ?? "INVALID_PREVIOUS_DAY" };
    }
    if (!point.valid) {
      return { date: point.date, value: null, status: "NO_RESULT", reason: point.reason ?? "INVALID_CURRENT_DAY" };
    }
    const crossedBoundary = regimeBoundaries.find(
      (boundary) =>
        previous.source_timestamp < boundary.boundary_at &&
        boundary.boundary_at <= point.source_timestamp,
    );
    if (crossedBoundary) {
      return {
        date: point.date,
        value: null,
        status: "NO_RESULT",
        reason: `REGIME_BOUNDARY:${crossedBoundary.regime_id}:${crossedBoundary.boundary_type}`,
      };
    }
    return {
      date: point.date,
      value: round(point.value! / previous.value! - 1),
      status: "OK",
      reason: null,
    };
  });
}

function loadDailyPrices(
  db: DatabaseSync,
  datasetSnapshotId: string,
  parameters: MarketMetricParameters,
): Map<string, DailyPrice[]> {
  const rows = db.prepare(
    `SELECT dspp.instrument_id, dspp.source_timestamp, pp.observed_at,
            pp.value, pp.price_semantics, pp.quality_status
     FROM dataset_snapshot_price_point dspp
     JOIN price_point pp
       ON pp.source_snapshot_id = dspp.source_snapshot_id
      AND pp.instrument_id = dspp.instrument_id
      AND pp.source_timestamp = dspp.source_timestamp
     WHERE dspp.dataset_snapshot_id = ?
     ORDER BY dspp.instrument_id, dspp.source_timestamp, pp.observed_at`,
  ).all(datasetSnapshotId) as Array<{
    instrument_id: string;
    source_timestamp: string;
    observed_at: string;
    value: number | bigint | null;
    price_semantics: string;
    quality_status: string;
  }>;

  const chosen = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const date = dateInTimezone(row.source_timestamp, parameters.timezone);
    const key = `${row.instrument_id}\0${date}`;
    const previous = chosen.get(key);
    if (
      !previous ||
      row.source_timestamp > previous.source_timestamp ||
      (row.source_timestamp === previous.source_timestamp && row.observed_at > previous.observed_at)
    ) chosen.set(key, row);
  }

  const result = new Map<string, DailyPrice[]>();
  for (const row of chosen.values()) {
    const date = dateInTimezone(row.source_timestamp, parameters.timezone);
    const semanticMatches = row.price_semantics === parameters.price_semantics;
    const qualityMatches = row.quality_status === "VALID" || row.quality_status === "UNCHANGED_RUN";
    const numeric = row.value === null ? null : Number(row.value);
    const valid = semanticMatches && qualityMatches && numeric !== null && numeric > 0;
    const reason = !semanticMatches
      ? "PRICE_SEMANTICS_MISMATCH"
      : !qualityMatches
        ? `QUALITY_${row.quality_status}`
        : numeric === null || numeric <= 0
          ? "INVALID_PRICE"
          : null;
    const points = result.get(row.instrument_id) ?? [];
    points.push({
      date,
      source_timestamp: row.source_timestamp,
      value: numeric,
      valid,
      reason,
    });
    result.set(row.instrument_id, points);
  }
  for (const points of result.values()) points.sort((left, right) => left.date.localeCompare(right.date));
  return result;
}

function loadRegimeBoundaries(
  db: DatabaseSync,
  datasetSnapshotId: string,
  parameters: MarketMetricParameters,
): Map<string, RegimeBoundary[]> {
  const result = new Map<string, RegimeBoundary[]>();
  if (parameters.allow_regime_crossing || parameters.regimes.length === 0) return result;

  const eventRows = db.prepare(
    `SELECT e.event_id, e.event_type, e.effective_at, e.ended_at
     FROM dataset_snapshot_event dse
     JOIN event e ON e.event_id = dse.event_id
     WHERE dse.dataset_snapshot_id = ?`,
  ).all(datasetSnapshotId) as Array<{
    event_id: string;
    event_type: string;
    effective_at: string | null;
    ended_at: string | null;
  }>;
  const eventById = new Map(eventRows.map((row) => [row.event_id, row]));

  const instruments = db.prepare(
    `SELECT DISTINCT dspp.instrument_id, i.grade, pc.season
     FROM dataset_snapshot_price_point dspp
     JOIN instrument i ON i.instrument_id = dspp.instrument_id
     JOIN player_card pc ON pc.spid = i.spid
     WHERE dspp.dataset_snapshot_id = ?`,
  ).all(datasetSnapshotId) as Array<{
    instrument_id: string;
    grade: number | bigint;
    season: string;
  }>;

  for (const regime of parameters.regimes) {
    const event = eventById.get(regime.event_id);
    if (!event) {
      throw new TypeError(`regime ${regime.regime_id} references event outside the dataset snapshot`);
    }
    if (event.event_type !== "MARKET_RULE_CHANGE" || !event.effective_at) {
      throw new TypeError(`regime ${regime.regime_id} must reference an effective MARKET_RULE_CHANGE event`);
    }
    for (const instrument of instruments) {
      const grade = Number(instrument.grade);
      const classMatches =
        regime.class_filter.length === 0 || regime.class_filter.includes(instrument.season);
      const gradeMatches =
        (regime.grade_min === null || grade >= regime.grade_min) &&
        (regime.grade_max === null || grade <= regime.grade_max);
      if (!classMatches || !gradeMatches) continue;
      const boundaries = result.get(instrument.instrument_id) ?? [];
      boundaries.push({
        regime_id: regime.regime_id,
        boundary_at: event.effective_at,
        boundary_type: "ENTER",
      });
      if (event.ended_at) {
        boundaries.push({
          regime_id: regime.regime_id,
          boundary_at: event.ended_at,
          boundary_type: "EXIT",
        });
      }
      result.set(instrument.instrument_id, boundaries);
    }
  }

  for (const boundaries of result.values()) {
    boundaries.sort((left, right) => left.boundary_at.localeCompare(right.boundary_at));
  }
  return result;
}

function loadInstrumentPlayers(db: DatabaseSync, instrumentIds: string[]): Map<string, string> {
  if (instrumentIds.length === 0) return new Map();
  const placeholders = instrumentIds.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT i.instrument_id, pc.player_id
     FROM instrument i
     JOIN player_card pc ON pc.spid = i.spid
     WHERE i.instrument_id IN (${placeholders})`,
  ).all(...instrumentIds) as Array<{ instrument_id: string; player_id: string }>;
  return new Map(rows.map((row) => [row.instrument_id, row.player_id]));
}

interface CohortDefinition {
  cohort_id: string;
  name: string;
  aggregation_level: "PLAYER" | "INSTRUMENT";
}

interface CohortMembership {
  cohort_id: string;
  instrument_id: string;
  valid_from: string;
  valid_to: string | null;
  membership_source: string;
}

function loadCohorts(db: DatabaseSync, datasetSnapshotId: string): {
  definitions: CohortDefinition[];
  memberships: CohortMembership[];
} {
  const definitions = db.prepare(
    `SELECT cohort_id, name, aggregation_level
     FROM dataset_snapshot_cohort_definition
     WHERE dataset_snapshot_id = ?
     ORDER BY cohort_id`,
  ).all(datasetSnapshotId) as CohortDefinition[];
  const memberships = db.prepare(
    `SELECT cohort_id, instrument_id, valid_from, valid_to, membership_source
     FROM dataset_snapshot_cohort_membership
     WHERE dataset_snapshot_id = ?
     ORDER BY cohort_id, instrument_id, valid_from`,
  ).all(datasetSnapshotId) as CohortMembership[];
  return { definitions, memberships };
}

function staticMembership(definition: CohortDefinition): boolean {
  return definition.name === "SAMPLE_MARKET" || definition.name === "CORE";
}

function activeOnDate(
  membership: CohortMembership,
  definition: CohortDefinition,
  date: string,
  timezone: string,
): boolean {
  if (staticMembership(definition)) return true;
  const from = dateInTimezone(membership.valid_from, timezone);
  if (date < from) return false;
  if (membership.valid_to === null) return true;
  return date < dateInTimezone(membership.valid_to, timezone);
}

function metricRow(
  input: Omit<MetricRow, "coverage_ratio"> & { coverage_ratio?: number },
): MetricRow {
  const coverage = input.coverage_ratio ?? (input.total_count === 0 ? 0 : input.valid_count / input.total_count);
  return { ...input, coverage_ratio: round(coverage) };
}

function aggregateRow(
  date: string,
  scopeId: string,
  metricName: "RETURN_1D" | "BREADTH" | "IQR" | "MAD",
  values: number[],
  totalCount: number,
  thresholdValue: MetricThreshold,
  value: number | null,
  details: Record<string, unknown>,
): MetricRow {
  const coverage = totalCount === 0 ? 0 : values.length / totalCount;
  const ok = values.length >= thresholdValue.min_valid_count && coverage >= thresholdValue.min_coverage_ratio;
  return metricRow({
    metric_date: date,
    scope_type: "COHORT",
    scope_id: scopeId,
    metric_name: metricName,
    value: ok ? value : null,
    status: ok ? "OK" : "NO_RESULT",
    valid_count: values.length,
    total_count: totalCount,
    coverage_ratio: coverage,
    details: {
      ...details,
      min_valid_count: thresholdValue.min_valid_count,
      min_coverage_ratio: thresholdValue.min_coverage_ratio,
    },
  });
}

export function runMarketMetrics(
  db: DatabaseSync,
  analysisRunId: string,
): RunMarketMetricsResult {
  const run = db.prepare(
    `SELECT ar.dataset_snapshot_id, ar.parameters_json, ar.status,
            ds.analysis_cutoff, ds.schema_version
     FROM analysis_run ar
     JOIN dataset_snapshot ds ON ds.dataset_snapshot_id = ar.dataset_snapshot_id
     WHERE ar.analysis_run_id = ?`,
  ).get(analysisRunId) as {
    dataset_snapshot_id: string;
    parameters_json: string;
    status: string;
    analysis_cutoff: string;
    schema_version: number;
  } | undefined;
  if (!run) throw new TypeError(`analysis run ${analysisRunId} does not exist`);
  if (run.schema_version < 8) {
    throw new TypeError(
      "analysis run uses a pre-shock/regime dataset snapshot; run prepare:analysis again",
    );
  }
  const parameters = parseMarketMetricParameters(JSON.parse(run.parameters_json) as unknown);
  const dailyPrices = loadDailyPrices(db, run.dataset_snapshot_id, parameters);
  const regimeBoundaries = loadRegimeBoundaries(db, run.dataset_snapshot_id, parameters);
  const instrumentIds = [...dailyPrices.keys()].sort();
  const playerByInstrument = loadInstrumentPlayers(db, instrumentIds);
  const instrumentReturns = new Map<string, ReturnPoint[]>();
  const rows: MetricRow[] = [];

  for (const instrumentId of instrumentIds) {
    const returns = buildReturns(
      dailyPrices.get(instrumentId)!,
      regimeBoundaries.get(instrumentId) ?? [],
    );
    instrumentReturns.set(instrumentId, returns);
    for (const point of returns) {
      rows.push(metricRow({
        metric_date: point.date,
        scope_type: "INSTRUMENT",
        scope_id: instrumentId,
        metric_name: "RETURN_1D",
        value: point.value,
        status: point.status,
        valid_count: point.status === "OK" ? 1 : 0,
        total_count: 1,
        details: { reason: point.reason },
      }));
    }
  }

  const playerDateValues = new Map<string, number[]>();
  const playerDates = new Map<string, Set<string>>();
  for (const [instrumentId, points] of instrumentReturns) {
    const playerId = playerByInstrument.get(instrumentId);
    if (!playerId) continue;
    for (const point of points) {
      const key = `${playerId}\0${point.date}`;
      const dates = playerDates.get(playerId) ?? new Set<string>();
      dates.add(point.date);
      playerDates.set(playerId, dates);
      if (point.status === "OK") {
        const values = playerDateValues.get(key) ?? [];
        values.push(point.value!);
        playerDateValues.set(key, values);
      }
    }
  }

  const playerReturnLookup = new Map<string, ReturnPoint>();
  for (const [playerId, dates] of playerDates) {
    for (const date of [...dates].sort()) {
      const values = playerDateValues.get(`${playerId}\0${date}`) ?? [];
      const point: ReturnPoint = values.length === 0
        ? { date, value: null, status: "NO_RESULT", reason: "NO_VALID_INSTRUMENT_RETURN" }
        : { date, value: round(median(values)), status: "OK", reason: null };
      playerReturnLookup.set(`${playerId}\0${date}`, point);
      rows.push(metricRow({
        metric_date: date,
        scope_type: "PLAYER",
        scope_id: playerId,
        metric_name: "RETURN_1D",
        value: point.value,
        status: point.status,
        valid_count: values.length,
        total_count: Math.max(1, instrumentIds.filter((id) => playerByInstrument.get(id) === playerId).length),
        details: { aggregation: "MEDIAN_INSTRUMENT_RETURN", reason: point.reason },
      }));
    }
  }

  const cohorts = loadCohorts(db, run.dataset_snapshot_id);
  const membershipsByCohort = new Map<string, CohortMembership[]>();
  for (const membership of cohorts.memberships) {
    const values = membershipsByCohort.get(membership.cohort_id) ?? [];
    values.push(membership);
    membershipsByCohort.set(membership.cohort_id, values);
  }
  const allDates = [...new Set([...instrumentReturns.values()].flatMap((points) => points.map((point) => point.date)))].sort();
  const cohortReturns = new Map<string, MetricRow>();
  let sampleCohortId: string | null = null;

  for (const definition of cohorts.definitions) {
    if (definition.name === "SAMPLE_MARKET") sampleCohortId = definition.cohort_id;
    const thresholdValue = definition.name === "SAMPLE_MARKET"
      ? parameters.sample_market
      : parameters.cross_player_cohort;
    const cohortMemberships = membershipsByCohort.get(definition.cohort_id) ?? [];
    for (const date of allDates) {
      const active = cohortMemberships.filter((membership) =>
        activeOnDate(membership, definition, date, parameters.timezone));
      const unitReturns = new Map<string, number[]>();
      for (const membership of active) {
        const instrumentReturn = instrumentReturns
          .get(membership.instrument_id)
          ?.find((point) => point.date === date && point.status === "OK");
        if (!instrumentReturn) continue;
        const unitId = definition.aggregation_level === "INSTRUMENT"
          ? membership.instrument_id
          : playerByInstrument.get(membership.instrument_id);
        if (!unitId) continue;
        const values = unitReturns.get(unitId) ?? [];
        values.push(instrumentReturn.value!);
        unitReturns.set(unitId, values);
      }
      const totalUnits = new Set(active.map((membership) =>
        definition.aggregation_level === "INSTRUMENT"
          ? membership.instrument_id
          : playerByInstrument.get(membership.instrument_id),
      ).filter((value): value is string => Boolean(value))).size;
      const values = [...unitReturns.values()].map((unitValues) => median(unitValues));
      const aggregate = values.length === 0 ? null : round(median(values));
      const returnRow = aggregateRow(
        date,
        definition.cohort_id,
        "RETURN_1D",
        values,
        totalUnits,
        thresholdValue,
        aggregate,
        { aggregation_level: definition.aggregation_level, aggregation: "MEDIAN" },
      );
      rows.push(returnRow);
      cohortReturns.set(`${definition.cohort_id}\0${date}`, returnRow);

      const breadth = values.length === 0 ? null : round(values.filter((value) => value > 0).length / values.length);
      rows.push(aggregateRow(
        date,
        definition.cohort_id,
        "BREADTH",
        values,
        totalUnits,
        thresholdValue,
        breadth,
        { positive_count: values.filter((value) => value > 0).length },
      ));
      const spread = values.length === 0 ? null : dispersion(values);
      rows.push(aggregateRow(
        date,
        definition.cohort_id,
        "IQR",
        values,
        totalUnits,
        thresholdValue,
        spread === null ? null : round(spread.iqr),
        {},
      ));
      rows.push(aggregateRow(
        date,
        definition.cohort_id,
        "MAD",
        values,
        totalUnits,
        thresholdValue,
        spread === null ? null : round(spread.mad),
        {},
      ));
    }
  }

  if (!sampleCohortId) throw new TypeError("dataset snapshot does not contain SAMPLE_MARKET cohort definition");

  for (const definition of cohorts.definitions) {
    if (definition.cohort_id === sampleCohortId) continue;
    for (const date of allDates) {
      const cohort = cohortReturns.get(`${definition.cohort_id}\0${date}`);
      const sample = cohortReturns.get(`${sampleCohortId}\0${date}`);
      const ok = cohort?.status === "OK" && sample?.status === "OK";
      rows.push(metricRow({
        metric_date: date,
        scope_type: "COHORT",
        scope_id: definition.cohort_id,
        metric_name: "RELATIVE_STRENGTH",
        value: ok ? round(cohort!.value! - sample!.value!) : null,
        status: ok ? "OK" : "NO_RESULT",
        valid_count: cohort?.valid_count ?? 0,
        total_count: cohort?.total_count ?? 0,
        coverage_ratio: cohort?.coverage_ratio ?? 0,
        details: { benchmark_cohort_id: sampleCohortId },
      }));
    }
  }

  for (const definition of cohorts.definitions) {
    let previousIndex: number | null = null;
    let previousIndexDate: string | null = null;
    for (const date of allDates) {
      const cohort = cohortReturns.get(`${definition.cohort_id}\0${date}`);
      if (!cohort || cohort.status !== "OK") {
        rows.push(metricRow({
          metric_date: date,
          scope_type: "COHORT",
          scope_id: definition.cohort_id,
          metric_name: "INDEX",
          value: null,
          status: "NO_RESULT",
          valid_count: cohort?.valid_count ?? 0,
          total_count: cohort?.total_count ?? 0,
          coverage_ratio: cohort?.coverage_ratio ?? 0,
          details: { reason: "RETURN_NO_RESULT" },
        }));
        previousIndex = null;
        previousIndexDate = null;
        continue;
      }
      const continuous = previousIndex !== null && previousIndexDate === previousDate(date);
      const base = continuous ? previousIndex! : 100;
      const value = round(base * (1 + cohort.value!));
      rows.push(metricRow({
        metric_date: date,
        scope_type: "COHORT",
        scope_id: definition.cohort_id,
        metric_name: "INDEX",
        value,
        status: "OK",
        valid_count: cohort.valid_count,
        total_count: cohort.total_count,
        coverage_ratio: cohort.coverage_ratio,
        details: { segment_start: !continuous, base_index: base },
      }));
      previousIndex = value;
      previousIndexDate = date;
    }
  }

  rows.sort((left, right) =>
    `${left.metric_date}\0${left.scope_type}\0${left.scope_id}\0${left.metric_name}`.localeCompare(
      `${right.metric_date}\0${right.scope_type}\0${right.scope_id}\0${right.metric_name}`,
    ));
  const resultHash = sha256(canonicalJson(rows));

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM analysis_metric WHERE analysis_run_id = ?").run(analysisRunId);
    const insert = db.prepare(
      `INSERT INTO analysis_metric(
        analysis_run_id, metric_date, scope_type, scope_id, metric_name,
        value, status, valid_count, total_count, coverage_ratio, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let created = 0;
    for (const row of rows) {
      created += Number(insert.run(
        analysisRunId,
        row.metric_date,
        row.scope_type,
        row.scope_id,
        row.metric_name,
        row.value,
        row.status,
        row.valid_count,
        row.total_count,
        row.coverage_ratio,
        canonicalJson(row.details),
      ).changes);
    }
    db.prepare(
      `UPDATE analysis_run
       SET status = 'SUCCEEDED', result_hash = ?
       WHERE analysis_run_id = ?`,
    ).run(resultHash, analysisRunId);
    db.exec("COMMIT");
    return {
      analysis_run_id: analysisRunId,
      dataset_snapshot_id: run.dataset_snapshot_id,
      metric_rows: rows.length,
      ok_rows: rows.filter((row) => row.status === "OK").length,
      no_result_rows: rows.filter((row) => row.status === "NO_RESULT").length,
      metric_dates: allDates.length,
      result_hash: resultHash,
      created,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    db.prepare(
      "UPDATE analysis_run SET status = 'FAILED' WHERE analysis_run_id = ?",
    ).run(analysisRunId);
    throw error;
  }
}
