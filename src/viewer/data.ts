import type { DatabaseSync } from "node:sqlite";

const VIEWER_TIMEZONE = "Asia/Seoul";

export interface ViewerRun {
  analysis_run_id: string;
  dataset_snapshot_id: string;
  analysis_version: string;
  code_commit: string;
  created_at: string;
  analysis_cutoff: string;
  status: string;
}

export interface ViewerCohort {
  cohort_id: string;
  name: string;
  aggregation_level: string;
}

export interface ViewerMetric {
  metric_date: string;
  scope_id: string;
  metric_name: string;
  value: number | null;
  status: string;
  coverage_ratio: number;
}

export interface ViewerEvent {
  event_id: string;
  title: string;
  event_type: string;
  anchor_type: string;
  anchor_at: string;
  anchor_date: string;
}

export interface ViewerReplayMetric {
  event_id: string;
  anchor_type: string;
  offset_days: number;
  metric_date: string;
  scope_id: string;
  metric_name: string;
  value: number | null;
  status: string;
  reason: string | null;
}

export interface ViewerShock {
  metric_date: string;
  scope_id: string;
  value: number;
  robust_z: number;
  severity: number;
  detector_version: string;
}

export interface ViewerPriceSample {
  instrument_id: string;
  player_name: string;
  season: string;
  grade: number;
  price: number;
}

export interface ViewerPriceStat {
  metric_date: string;
  scope_id: string;
  median_price: number;
  p25_price: number;
  p75_price: number;
  valid_count: number;
  total_count: number;
  coverage_ratio: number;
  samples: ViewerPriceSample[];
}

export interface ViewerPriceBasis {
  currency: "BP";
  price_semantics: "MARKET_REFERENCE_PRICE";
  unit_adjustment_date: "2026-08-20";
  unit_adjustment_at: "2026-08-20T16:00:00+09:00";
  unit_adjustment_ratio: 100000000;
  historical_prices_adjusted: true;
  source_url: string;
}

export interface ViewerPayload {
  run: ViewerRun;
  cohorts: ViewerCohort[];
  metrics: ViewerMetric[];
  price_stats: ViewerPriceStat[];
  price_basis: ViewerPriceBasis;
  events: ViewerEvent[];
  replay: ViewerReplayMetric[];
  shocks: ViewerShock[];
}

function dateInViewerTimezone(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`invalid timestamp: ${timestamp}`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VIEWER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const read = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!year || !month || !day) throw new TypeError(`cannot format date in ${VIEWER_TIMEZONE}`);
  return `${year}-${month}-${day}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

function representativeSamples(
  rows: ViewerPriceSample[],
  targets: number[],
): ViewerPriceSample[] {
  const result: ViewerPriceSample[] = [];
  const used = new Set<string>();
  for (const target of targets) {
    const match = rows
      .filter((row) => !used.has(row.instrument_id))
      .sort((left, right) =>
        Math.abs(left.price - target) - Math.abs(right.price - target) ||
        left.instrument_id.localeCompare(right.instrument_id),
      )[0];
    if (!match) continue;
    used.add(match.instrument_id);
    result.push(match);
  }
  return result;
}

function loadViewerPriceStats(
  db: DatabaseSync,
  run: ViewerRun,
  cohorts: ViewerCohort[],
): ViewerPriceStat[] {
  const memberships = db.prepare(
    `SELECT cohort_id, instrument_id, valid_from, valid_to
     FROM dataset_snapshot_cohort_membership
     WHERE dataset_snapshot_id = ?
     ORDER BY cohort_id, instrument_id, valid_from`,
  ).all(run.dataset_snapshot_id) as Array<{
    cohort_id: string;
    instrument_id: string;
    valid_from: string;
    valid_to: string | null;
  }>;

  const instruments = db.prepare(
    `SELECT i.instrument_id, pc.player_id, p.name AS player_name, pc.season, i.grade
     FROM instrument i
     JOIN player_card pc ON pc.spid = i.spid
     JOIN player p ON p.player_id = pc.player_id
     WHERE i.instrument_id IN (
       SELECT DISTINCT instrument_id
       FROM dataset_snapshot_cohort_membership
       WHERE dataset_snapshot_id = ?
     )
     ORDER BY i.instrument_id`,
  ).all(run.dataset_snapshot_id) as Array<{
    instrument_id: string;
    player_id: string;
    player_name: string;
    season: string;
    grade: number | bigint;
  }>;
  const instrumentById = new Map(instruments.map((row) => [row.instrument_id, row]));

  const priceRows = db.prepare(
    `SELECT dspp.instrument_id, dspp.source_timestamp, pp.observed_at, pp.value
     FROM dataset_snapshot_price_point dspp
     JOIN price_point pp
       ON pp.source_snapshot_id = dspp.source_snapshot_id
      AND pp.instrument_id = dspp.instrument_id
      AND pp.source_timestamp = dspp.source_timestamp
     WHERE dspp.dataset_snapshot_id = ?
       AND pp.price_semantics = 'MARKET_REFERENCE_PRICE'
       AND pp.quality_status IN ('VALID', 'UNCHANGED_RUN')
       AND pp.value IS NOT NULL
       AND pp.value > 0
     ORDER BY dspp.instrument_id, dspp.source_timestamp, pp.observed_at`,
  ).all(run.dataset_snapshot_id) as Array<{
    instrument_id: string;
    source_timestamp: string;
    observed_at: string;
    value: number | bigint;
  }>;

  const chosen = new Map<string, typeof priceRows[number] & { metric_date: string }>();
  for (const row of priceRows) {
    const metricDate = dateInViewerTimezone(row.source_timestamp);
    const key = `${row.instrument_id}\0${metricDate}`;
    const previous = chosen.get(key);
    if (
      !previous ||
      row.source_timestamp > previous.source_timestamp ||
      (row.source_timestamp === previous.source_timestamp && row.observed_at > previous.observed_at)
    ) {
      chosen.set(key, { ...row, metric_date: metricDate });
    }
  }

  const dates = [...new Set([...chosen.values()].map((row) => row.metric_date))].sort();
  const membershipsByCohort = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    const rows = membershipsByCohort.get(membership.cohort_id) ?? [];
    rows.push(membership);
    membershipsByCohort.set(membership.cohort_id, rows);
  }

  const result: ViewerPriceStat[] = [];
  for (const cohort of cohorts) {
    const cohortMemberships = membershipsByCohort.get(cohort.cohort_id) ?? [];
    const staticMembership = cohort.name === "SAMPLE_MARKET" || cohort.name === "CORE";
    for (const date of dates) {
      const activeInstrumentIds = new Set<string>();
      for (const membership of cohortMemberships) {
        const active = staticMembership || (
          date >= dateInViewerTimezone(membership.valid_from) &&
          (membership.valid_to === null || date < dateInViewerTimezone(membership.valid_to))
        );
        if (active) activeInstrumentIds.add(membership.instrument_id);
      }
      if (activeInstrumentIds.size === 0) continue;

      const totalUnits = new Set<string>();
      const unitPrices = new Map<string, number[]>();
      const rawSamples: ViewerPriceSample[] = [];
      for (const instrumentId of activeInstrumentIds) {
        const instrument = instrumentById.get(instrumentId);
        if (!instrument) continue;
        const unitId = cohort.aggregation_level === "INSTRUMENT"
          ? instrumentId
          : instrument.player_id;
        totalUnits.add(unitId);
        const pricePoint = chosen.get(`${instrumentId}\0${date}`);
        if (!pricePoint) continue;
        const price = Number(pricePoint.value);
        const values = unitPrices.get(unitId) ?? [];
        values.push(price);
        unitPrices.set(unitId, values);
        rawSamples.push({
          instrument_id: instrumentId,
          player_name: instrument.player_name,
          season: instrument.season,
          grade: Number(instrument.grade),
          price,
        });
      }

      const values = [...unitPrices.values()].map((unitValues) => median(unitValues));
      if (values.length === 0 || totalUnits.size === 0) continue;
      const p25 = quantile(values, 0.25);
      const center = median(values);
      const p75 = quantile(values, 0.75);
      result.push({
        metric_date: date,
        scope_id: cohort.cohort_id,
        median_price: Math.round(center),
        p25_price: Math.round(p25),
        p75_price: Math.round(p75),
        valid_count: values.length,
        total_count: totalUnits.size,
        coverage_ratio: values.length / totalUnits.size,
        samples: representativeSamples(rawSamples, [p25, center, p75]),
      });
    }
  }
  return result.sort((left, right) =>
    `${left.metric_date}\0${left.scope_id}`.localeCompare(`${right.metric_date}\0${right.scope_id}`),
  );
}

export function listViewerRuns(db: DatabaseSync): ViewerRun[] {
  return db.prepare(
    `SELECT ar.analysis_run_id, ar.dataset_snapshot_id, ar.analysis_version,
            ar.code_commit, ar.created_at, ds.analysis_cutoff, ar.status
     FROM analysis_run ar
     JOIN dataset_snapshot ds ON ds.dataset_snapshot_id = ar.dataset_snapshot_id
     WHERE ar.status = 'SUCCEEDED'
       AND EXISTS (
         SELECT 1 FROM analysis_metric am
         WHERE am.analysis_run_id = ar.analysis_run_id
       )
     ORDER BY ar.created_at DESC, ar.analysis_run_id DESC`,
  ).all() as unknown as ViewerRun[];
}

export function resolveViewerRun(db: DatabaseSync, requestedRun?: string): ViewerRun {
  const runs = listViewerRuns(db);
  const run = requestedRun
    ? runs.find((candidate) => candidate.analysis_run_id === requestedRun)
    : runs[0];
  if (!run) {
    throw new TypeError(
      requestedRun
        ? `analysis run ${requestedRun} is not available for viewing`
        : "no successful analysis run with metrics is available; run the analysis pipeline first",
    );
  }
  return run;
}

export function loadViewerPayload(
  db: DatabaseSync,
  requestedRun?: string,
): ViewerPayload {
  const run = resolveViewerRun(db, requestedRun);
  const cohorts = db.prepare(
    `SELECT cohort_id, name, aggregation_level
     FROM dataset_snapshot_cohort_definition
     WHERE dataset_snapshot_id = ?
     ORDER BY name, cohort_id`,
  ).all(run.dataset_snapshot_id) as unknown as ViewerCohort[];

  const metrics = db.prepare(
    `SELECT metric_date, scope_id, metric_name, value, status, coverage_ratio
     FROM analysis_metric
     WHERE analysis_run_id = ?
       AND scope_type = 'COHORT'
     ORDER BY metric_date, scope_id, metric_name`,
  ).all(run.analysis_run_id) as unknown as ViewerMetric[];
  const priceStats = loadViewerPriceStats(db, run, cohorts);

  const events = db.prepare(
    `SELECT era.event_id, e.title, e.event_type, era.anchor_type,
            era.anchor_at, era.anchor_date
     FROM event_replay_anchor era
     JOIN event e ON e.event_id = era.event_id
     WHERE era.analysis_run_id = ?
     ORDER BY era.anchor_at, era.event_id, era.anchor_type`,
  ).all(run.analysis_run_id) as unknown as ViewerEvent[];

  const replay = db.prepare(
    `SELECT event_id, anchor_type, offset_days, metric_date, scope_id,
            metric_name, value, status, reason
     FROM event_replay_metric
     WHERE analysis_run_id = ?
     ORDER BY event_id, anchor_type, offset_days, scope_id, metric_name`,
  ).all(run.analysis_run_id) as unknown as ViewerReplayMetric[];

  const shocks = db.prepare(
    `SELECT metric_date, scope_id, value, robust_z, severity, detector_version
     FROM shock_candidate
     WHERE analysis_run_id = ?
     ORDER BY severity DESC, metric_date, scope_id`,
  ).all(run.analysis_run_id) as unknown as ViewerShock[];

  return {
    run,
    cohorts,
    metrics,
    price_stats: priceStats,
    price_basis: {
      currency: "BP",
      price_semantics: "MARKET_REFERENCE_PRICE",
      unit_adjustment_date: "2026-08-20",
      unit_adjustment_at: "2026-08-20T16:00:00+09:00",
      unit_adjustment_ratio: 100000000,
      historical_prices_adjusted: true,
      source_url: "https://m.fconline.nexon.com/news/notice/view?n1type=1&n4ArticleSN=6171",
    },
    events,
    replay,
    shocks,
  };
}
