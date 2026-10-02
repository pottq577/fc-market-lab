import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  weightedDispersion,
  weightedMedian,
  weightedQuantile,
} from "../benchmark/metrics.ts";
import { loadBenchmarkViewerPayload } from "../viewer/benchmark-data.ts";

const CANONICAL_POC_ANALYSIS_RUN_ID =
  "run_97896c0081872d383f941bdab180c3aecc334e377b6752284e65ca840404925e";
const CANONICAL_POC_DATASET_SNAPSHOT_ID =
  "dataset_a362707a3093caccd65c3dfde2409f8de0109a4bf63dcb00d0fa6f409bee5af5";
const CANONICAL_POC_METRIC_HASH =
  "sha256:87700ebe16810827306361be9ee98538d276e6c1462860e2b971819f0b73a810";
const CANONICAL_POC_REPLAY_HASH =
  "sha256:87cacc67a9e520b2e330b26e6a8786cdae5a7387a547e1b9ea101006ec41e72e";
const CANONICAL_POC_CATALOG_ID = "sample-market-2026-09-29";

export type BenchmarkAcceptanceStatus = "PASS" | "FAIL";

export interface BenchmarkAcceptanceCriterionResult {
  id: `MB-${string}`;
  title: string;
  status: BenchmarkAcceptanceStatus;
  evidence: Record<string, unknown>;
  blockers: string[];
}

export interface BenchmarkAcceptanceResult {
  status: "COMPLETE" | "INCOMPLETE";
  analysis_run_id: string;
  dataset_snapshot_id: string;
  benchmark_convergence_run_id: string;
  checked_at: string;
  passed: number;
  failed: number;
  criteria: BenchmarkAcceptanceCriterionResult[];
}

function criterion(
  id: BenchmarkAcceptanceCriterionResult["id"],
  title: string,
  pass: boolean,
  evidence: Record<string, unknown>,
  blockers: string[] = [],
): BenchmarkAcceptanceCriterionResult {
  return {
    id,
    title,
    status: pass ? "PASS" : "FAIL",
    evidence,
    blockers: pass ? [] : blockers,
  };
}

function count(
  db: DatabaseSync,
  sql: string,
  ...params: Array<string | number | null>
): number {
  const row = db.prepare(sql).get(...params) as { count: number | bigint } | undefined;
  return Number(row?.count ?? 0);
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
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

export function summarizeBenchmarkAcceptance(
  analysisRunId: string,
  datasetSnapshotId: string,
  convergenceRunId: string,
  criteria: BenchmarkAcceptanceCriterionResult[],
  checkedAt: string,
): BenchmarkAcceptanceResult {
  const passed = criteria.filter((item) => item.status === "PASS").length;
  const failed = criteria.length - passed;
  return {
    status: failed === 0 ? "COMPLETE" : "INCOMPLETE",
    analysis_run_id: analysisRunId,
    dataset_snapshot_id: datasetSnapshotId,
    benchmark_convergence_run_id: convergenceRunId,
    checked_at: checkedAt,
    passed,
    failed,
    criteria,
  };
}

export function resolveBenchmarkAcceptanceAnalysisRunId(
  db: DatabaseSync,
  requested?: string,
): string {
  if (requested !== undefined) {
    const value = requested.trim();
    if (value === "") throw new TypeError("analysisRunId must not be empty");
    const row = db.prepare(
      `SELECT ar.analysis_run_id
       FROM analysis_run ar
       JOIN dataset_snapshot_benchmark dsb ON dsb.dataset_snapshot_id = ar.dataset_snapshot_id
       WHERE ar.analysis_run_id = ? AND ar.analysis_version = 'market-benchmark-v1'`,
    ).get(value) as { analysis_run_id: string } | undefined;
    if (!row) throw new TypeError(`benchmark analysis run ${value} is not published`);
    return row.analysis_run_id;
  }
  const latest = db.prepare(
    `SELECT ar.analysis_run_id
     FROM analysis_run ar
     JOIN dataset_snapshot_benchmark dsb ON dsb.dataset_snapshot_id = ar.dataset_snapshot_id
     WHERE ar.analysis_version = 'market-benchmark-v1' AND ar.status = 'SUCCEEDED'
     ORDER BY ar.created_at DESC, ar.analysis_run_id DESC
     LIMIT 1`,
  ).get() as { analysis_run_id: string } | undefined;
  if (!latest) throw new TypeError("no published benchmark analysis run exists; run benchmark:publish first");
  return latest.analysis_run_id;
}

export function runBenchmarkAcceptance(
  db: DatabaseSync,
  input: { analysisRunId: string; checkedAt?: string },
): BenchmarkAcceptanceResult {
  const published = db.prepare(
    `SELECT dsb.dataset_snapshot_id, ar.analysis_run_id,
            dsb.benchmark_convergence_run_id,
            dsb.benchmark_uncertainty_run_id,
            dsb.benchmark_metric_run_id, dsb.panel_family_id,
            dsb.universe_snapshot_id, dsb.display_panel_id,
            dsb.display_role, dsb.benchmark_status,
            ar.analysis_version, ar.result_hash,
            ds.analysis_cutoff, ds.catalog_id, ds.schema_version
     FROM dataset_snapshot_benchmark dsb
     JOIN analysis_run ar ON ar.dataset_snapshot_id = dsb.dataset_snapshot_id
     JOIN dataset_snapshot ds ON ds.dataset_snapshot_id = dsb.dataset_snapshot_id
     WHERE ar.analysis_run_id = ? AND ar.analysis_version = 'market-benchmark-v1'`,
  ).get(input.analysisRunId) as {
    dataset_snapshot_id: string;
    analysis_run_id: string;
    benchmark_convergence_run_id: string;
    benchmark_uncertainty_run_id: string;
    benchmark_metric_run_id: string;
    panel_family_id: string;
    universe_snapshot_id: string;
    display_panel_id: string;
    display_role: string;
    benchmark_status: "STABLE" | "UNSTABLE";
    analysis_version: string;
    result_hash: string | null;
    analysis_cutoff: string;
    catalog_id: string;
    schema_version: number | bigint;
  } | undefined;
  if (!published) throw new TypeError(`benchmark analysis run ${input.analysisRunId} is not published`);

  const universe = db.prepare(
    `SELECT as_of, rule_version, source_hash, price_semantics,
            price_max_age_days, catalog_player_count,
            price_eligible_player_count
     FROM market_universe_snapshot
     WHERE universe_snapshot_id = ?`,
  ).get(published.universe_snapshot_id) as {
    as_of: string;
    rule_version: string;
    source_hash: string;
    price_semantics: string;
    price_max_age_days: number | bigint;
    catalog_player_count: number | bigint;
    price_eligible_player_count: number | bigint;
  } | undefined;
  if (!universe) throw new TypeError(`universe ${published.universe_snapshot_id} is unavailable`);

  const metricRun = db.prepare(
    `SELECT metric_version, analysis_cutoff, timezone, input_hash, result_hash
     FROM benchmark_metric_run
     WHERE benchmark_metric_run_id = ?`,
  ).get(published.benchmark_metric_run_id) as {
    metric_version: string;
    analysis_cutoff: string;
    timezone: string;
    input_hash: string;
    result_hash: string;
  } | undefined;
  const uncertaintyRun = db.prepare(
    `SELECT uncertainty_version, method, replicates, confidence_level,
            sample_seed, input_hash, result_hash
     FROM benchmark_uncertainty_run
     WHERE benchmark_uncertainty_run_id = ?`,
  ).get(published.benchmark_uncertainty_run_id) as {
    uncertainty_version: string;
    method: string;
    replicates: number | bigint;
    confidence_level: number;
    sample_seed: string;
    input_hash: string;
    result_hash: string;
  } | undefined;
  const convergenceRun = db.prepare(
    `SELECT convergence_version, minimum_common_valid_days,
            return_median_abs_diff_max, return_p95_abs_diff_max,
            direction_match_ratio_min, breadth_median_abs_diff_max,
            input_hash, result_hash, benchmark_status, selected_panel_id
     FROM benchmark_convergence_run
     WHERE benchmark_convergence_run_id = ?`,
  ).get(published.benchmark_convergence_run_id) as {
    convergence_version: string;
    minimum_common_valid_days: number | bigint;
    return_median_abs_diff_max: number;
    return_p95_abs_diff_max: number;
    direction_match_ratio_min: number;
    breadth_median_abs_diff_max: number;
    input_hash: string;
    result_hash: string;
    benchmark_status: "STABLE" | "UNSTABLE";
    selected_panel_id: string | null;
  } | undefined;
  if (!metricRun || !uncertaintyRun || !convergenceRun) {
    throw new TypeError("published benchmark run has incomplete metric/uncertainty/convergence provenance");
  }

  const panelFamily = db.prepare(
    `SELECT panel_version, sample_seed, effective_from, universe_snapshot_id
     FROM benchmark_panel_family
     WHERE panel_family_id = ?`,
  ).get(published.panel_family_id) as {
    panel_version: string;
    sample_seed: string;
    effective_from: string;
    universe_snapshot_id: string;
  } | undefined;
  if (!panelFamily) throw new TypeError(`panel family ${published.panel_family_id} is unavailable`);

  const criteria: BenchmarkAcceptanceCriterionResult[] = [];

  const universeMemberCount = count(
    db,
    `SELECT COUNT(*) AS count FROM market_universe_member WHERE universe_snapshot_id = ?`,
    published.universe_snapshot_id,
  );
  const universeSourceCount = count(
    db,
    `SELECT COUNT(*) AS count FROM market_universe_source WHERE universe_snapshot_id = ?`,
    published.universe_snapshot_id,
  );
  const universeIdentityCount = count(
    db,
    `SELECT COUNT(*) AS count
     FROM market_universe_snapshot
     WHERE as_of = ? AND rule_version = ? AND source_hash = ?
       AND price_semantics = ? AND price_max_age_days = ?`,
    universe.as_of,
    universe.rule_version,
    universe.source_hash,
    universe.price_semantics,
    Number(universe.price_max_age_days),
  );
  const mb001 =
    universeMemberCount === Number(universe.catalog_player_count) &&
    universeSourceCount >= 2 &&
    universeIdentityCount === 1;
  criteria.push(criterion(
    "MB-001",
    "Universe snapshot identity and member set are frozen reproducibly",
    mb001,
    {
      universe_snapshot_id: published.universe_snapshot_id,
      catalog_player_count: Number(universe.catalog_player_count),
      persisted_member_count: universeMemberCount,
      source_count: universeSourceCount,
      identical_snapshot_rows: universeIdentityCount,
    },
    ["universe identity, member count, or metadata source provenance is inconsistent"],
  ));

  const evidenceFreeInstruments = count(
    db,
    `SELECT COUNT(*) AS count
     FROM market_universe_instrument mui
     WHERE mui.universe_snapshot_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM price_point pp
         WHERE pp.instrument_id = mui.instrument_id
           AND pp.source_timestamp <= ?
           AND pp.observed_at <= ?
       )`,
    published.universe_snapshot_id,
    universe.as_of,
    universe.as_of,
  );
  criteria.push(criterion(
    "MB-002",
    "Universe instruments require persisted price evidence instead of generated grades",
    evidenceFreeInstruments === 0,
    { evidence_free_instruments: evidenceFreeInstruments },
    ["one or more universe instruments have no persisted price evidence at the universe cutoff"],
  ));

  const panels = db.prepare(
    `SELECT panel_id, panel_label, panel_size
     FROM benchmark_panel
     WHERE panel_family_id = ?
     ORDER BY panel_size`,
  ).all(published.panel_family_id) as Array<{
    panel_id: string;
    panel_label: string;
    panel_size: number | bigint;
  }>;
  const panelSizes = panels.map((row) => Number(row.panel_size));
  let panelMemberMismatch = 0;
  let nestedViolations = 0;
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index]!;
    const memberCount = count(
      db,
      `SELECT COUNT(*) AS count FROM benchmark_panel_member WHERE panel_id = ?`,
      panel.panel_id,
    );
    if (memberCount !== Number(panel.panel_size)) panelMemberMismatch += 1;
    if (index > 0) {
      nestedViolations += count(
        db,
        `SELECT COUNT(*) AS count
         FROM benchmark_panel_member smaller
         WHERE smaller.panel_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM benchmark_panel_member larger
             WHERE larger.panel_id = ? AND larger.player_id = smaller.player_id
           )`,
        panels[index - 1]!.panel_id,
        panel.panel_id,
      );
    }
  }
  const mb003 =
    JSON.stringify(panelSizes) === JSON.stringify([100, 200, 400, 800]) &&
    panelMemberMismatch === 0 &&
    nestedViolations === 0;
  criteria.push(criterion(
    "MB-003",
    "Nested P100/P200/P400/P800 panel membership is deterministic and complete",
    mb003,
    { panel_sizes: panelSizes, panel_member_mismatch: panelMemberMismatch, nested_violations: nestedViolations },
    ["panel sizes, persisted membership counts, or nested membership invariant does not match the benchmark contract"],
  ));

  const canonical = db.prepare(
    `SELECT ar.dataset_snapshot_id, ar.result_hash, ds.catalog_id
     FROM analysis_run ar
     JOIN dataset_snapshot ds ON ds.dataset_snapshot_id = ar.dataset_snapshot_id
     WHERE ar.analysis_run_id = ?`,
  ).get(CANONICAL_POC_ANALYSIS_RUN_ID) as {
    dataset_snapshot_id: string;
    result_hash: string | null;
    catalog_id: string;
  } | undefined;
  const canonicalReplay = db.prepare(
    `SELECT result_hash FROM event_replay_run WHERE analysis_run_id = ?`,
  ).get(CANONICAL_POC_ANALYSIS_RUN_ID) as { result_hash: string } | undefined;
  const canonicalSampleMembers = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_cohort_membership dscm
     JOIN dataset_snapshot_cohort_definition dscd
       ON dscd.dataset_snapshot_id = dscm.dataset_snapshot_id
      AND dscd.cohort_id = dscm.cohort_id
     WHERE dscm.dataset_snapshot_id = ? AND dscd.name = 'SAMPLE_MARKET'`,
    CANONICAL_POC_DATASET_SNAPSHOT_ID,
  );
  const mb004 = Boolean(
    canonical &&
      canonicalReplay &&
      canonical.dataset_snapshot_id === CANONICAL_POC_DATASET_SNAPSHOT_ID &&
      canonical.catalog_id === CANONICAL_POC_CATALOG_ID &&
      canonical.result_hash === CANONICAL_POC_METRIC_HASH &&
      canonicalReplay.result_hash === CANONICAL_POC_REPLAY_HASH &&
      canonicalSampleMembers === 20,
  );
  criteria.push(criterion(
    "MB-004",
    "Canonical PoC SAMPLE_MARKET run remains unchanged",
    mb004,
    {
      analysis_run_id: CANONICAL_POC_ANALYSIS_RUN_ID,
      dataset_snapshot_id: canonical?.dataset_snapshot_id ?? null,
      catalog_id: canonical?.catalog_id ?? null,
      metric_hash: canonical?.result_hash ?? null,
      replay_hash: canonicalReplay?.result_hash ?? null,
      sample_members: canonicalSampleMembers,
    },
    ["canonical PoC dataset, SAMPLE_MARKET membership, metric hash, or replay hash changed"],
  ));

  const invalidPanelMembers = count(
    db,
    `SELECT COUNT(*) AS count
     FROM benchmark_panel_member bpm
     JOIN benchmark_panel bp ON bp.panel_id = bpm.panel_id
     WHERE bp.panel_family_id = ?
       AND (
         length(bpm.stratum_id) = 0
         OR bpm.population_weight < 1
         OR bpm.combined_inclusion_probability <= 0
         OR bpm.combined_inclusion_probability > 1
       )`,
    published.panel_family_id,
  );
  criteria.push(criterion(
    "MB-005",
    "Every benchmark member has a stratum and population weight",
    invalidPanelMembers === 0,
    { invalid_panel_members: invalidPanelMembers },
    ["one or more benchmark members lack a valid stratum, inclusion probability, or population weight"],
  ));

  const fixture = [
    { value: -0.1, weight: 1 },
    { value: 0, weight: 1 },
    { value: 0.1, weight: 1 },
    { value: 0.2, weight: 1 },
  ];
  const fixtureMedian = weightedMedian(fixture);
  const fixtureQ25 = weightedQuantile(fixture, 0.25);
  const fixtureQ75 = weightedQuantile(fixture, 0.75);
  const fixtureDispersion = weightedDispersion(fixture);
  const mb006 =
    fixtureMedian === 0 &&
    fixtureQ25 === -0.1 &&
    fixtureQ75 === 0.1 &&
    fixtureDispersion.iqr === 0.2 &&
    fixtureDispersion.mad === 0.1;
  criteria.push(criterion(
    "MB-006",
    "Weighted return, breadth support statistics, and dispersion fixture remain stable",
    mb006,
    {
      weighted_median: fixtureMedian,
      q25: fixtureQ25,
      q75: fixtureQ75,
      iqr: fixtureDispersion.iqr,
      mad: fixtureDispersion.mad,
    },
    ["weighted benchmark fixture no longer matches the expected values"],
  ));

  const expectedUncertaintyId = deterministicId(
    "benchmark_uncertainty_run",
    uncertaintyRun.input_hash,
  );
  const uncertaintyRows = count(
    db,
    `SELECT COUNT(*) AS count
     FROM benchmark_metric_uncertainty
     WHERE benchmark_uncertainty_run_id = ?`,
    published.benchmark_uncertainty_run_id,
  );
  const mb007 =
    expectedUncertaintyId === published.benchmark_uncertainty_run_id &&
    uncertaintyRun.method === "STRATIFIED_PLAYER_BOOTSTRAP" &&
    Number(uncertaintyRun.replicates) > 0 &&
    uncertaintyRows > 0;
  criteria.push(criterion(
    "MB-007",
    "Bootstrap run identity is deterministic for the same input and seed",
    mb007,
    {
      expected_run_id: expectedUncertaintyId,
      actual_run_id: published.benchmark_uncertainty_run_id,
      method: uncertaintyRun.method,
      replicates: Number(uncertaintyRun.replicates),
      sample_seed: uncertaintyRun.sample_seed,
      uncertainty_rows: uncertaintyRows,
    },
    ["uncertainty run identity or persisted bootstrap result does not match its deterministic input"],
  ));

  const explicitInsufficientRows = count(
    db,
    `SELECT COUNT(*) AS count
     FROM benchmark_metric_uncertainty
     WHERE benchmark_uncertainty_run_id = ?
       AND status = 'INSUFFICIENT_UNCERTAINTY_SAMPLE'`,
    published.benchmark_uncertainty_run_id,
  );
  const invalidInsufficientBounds = count(
    db,
    `SELECT COUNT(*) AS count
     FROM benchmark_metric_uncertainty
     WHERE benchmark_uncertainty_run_id = ?
       AND status = 'INSUFFICIENT_UNCERTAINTY_SAMPLE'
       AND (lower_value IS NOT NULL OR upper_value IS NOT NULL)`,
    published.benchmark_uncertainty_run_id,
  );
  criteria.push(criterion(
    "MB-008",
    "Insufficient uncertainty samples are explicit and never fabricated as intervals",
    explicitInsufficientRows > 0 && invalidInsufficientBounds === 0,
    { insufficient_rows: explicitInsufficientRows, invalid_interval_rows: invalidInsufficientBounds },
    ["the accepted uncertainty run does not exercise explicit insufficient status or contains fabricated bounds"],
  ));

  const expectedConvergenceId = deterministicId(
    "benchmark_convergence_run",
    convergenceRun.input_hash,
  );
  const convergencePairs = count(
    db,
    `SELECT COUNT(*) AS count
     FROM panel_convergence
     WHERE benchmark_convergence_run_id = ?`,
    published.benchmark_convergence_run_id,
  );
  const mb009 =
    expectedConvergenceId === published.benchmark_convergence_run_id &&
    convergencePairs === Math.max(0, panels.length - 1) &&
    convergenceRun.convergence_version.trim() !== "" &&
    Number(convergenceRun.minimum_common_valid_days) > 0;
  criteria.push(criterion(
    "MB-009",
    "Nested panel convergence uses a versioned deterministic threshold set",
    mb009,
    {
      expected_run_id: expectedConvergenceId,
      actual_run_id: published.benchmark_convergence_run_id,
      convergence_version: convergenceRun.convergence_version,
      pair_rows: convergencePairs,
      minimum_common_valid_days: Number(convergenceRun.minimum_common_valid_days),
      return_median_abs_diff_max: convergenceRun.return_median_abs_diff_max,
      return_p95_abs_diff_max: convergenceRun.return_p95_abs_diff_max,
      direction_match_ratio_min: convergenceRun.direction_match_ratio_min,
      breadth_median_abs_diff_max: convergenceRun.breadth_median_abs_diff_max,
    },
    ["convergence identity, pair coverage, or versioned thresholds are incomplete"],
  ));

  const terminalPair = db.prepare(
    `SELECT status, smaller_panel_size, larger_panel_size
     FROM panel_convergence
     WHERE benchmark_convergence_run_id = ?
     ORDER BY larger_panel_size DESC, smaller_panel_size DESC
     LIMIT 1`,
  ).get(published.benchmark_convergence_run_id) as {
    status: string;
    smaller_panel_size: number | bigint;
    larger_panel_size: number | bigint;
  } | undefined;
  const terminalNeedsUnstable = terminalPair?.status !== "PASS";
  const mb010 = Boolean(
    terminalPair &&
      (!terminalNeedsUnstable ||
        (convergenceRun.benchmark_status === "UNSTABLE" && convergenceRun.selected_panel_id === null)),
  );
  criteria.push(criterion(
    "MB-010",
    "A non-passing terminal P400/P800 pair keeps the benchmark UNSTABLE",
    mb010,
    {
      terminal_pair: terminalPair
        ? `${String(terminalPair.smaller_panel_size)}-${String(terminalPair.larger_panel_size)}`
        : null,
      terminal_status: terminalPair?.status ?? null,
      benchmark_status: convergenceRun.benchmark_status,
      selected_panel_id: convergenceRun.selected_panel_id,
    },
    ["terminal convergence status is not reflected in the benchmark stability state"],
  ));

  const viewer = loadBenchmarkViewerPayload(db, published.analysis_run_id);
  const viewerMetricNames = viewer?.latest_metrics.map((row) => row.metric_name).sort() ?? [];
  const requiredViewerMetrics = ["BREADTH", "INDEX", "IQR", "MAD", "RETURN_1D"];
  const viewerHasIntervals = viewer?.latest_metrics.every((row) =>
    row.uncertainty_status === "OK"
      ? row.lower_value !== null && row.upper_value !== null
      : row.lower_value === null && row.upper_value === null
  ) ?? false;
  const mb011 = Boolean(
    viewer &&
      JSON.stringify(viewerMetricNames) === JSON.stringify(requiredViewerMetrics) &&
      viewer.panel_version.trim() !== "" &&
      viewer.universe_as_of.trim() !== "" &&
      viewer.price_eligible_player_count > 0 &&
      viewer.convergence_pairs.length === convergencePairs &&
      viewerHasIntervals,
  );
  criteria.push(criterion(
    "MB-011",
    "Benchmark Viewer exposes point estimates, intervals, coverage, panel version, and convergence",
    mb011,
    {
      latest_metric_date: viewer?.latest_metric_date ?? null,
      metric_names: viewerMetricNames,
      display_panel: viewer?.display_panel_label ?? null,
      display_role: viewer?.display_role ?? null,
      panel_version: viewer?.panel_version ?? null,
      universe_as_of: viewer?.universe_as_of ?? null,
      price_eligible_player_count: viewer?.price_eligible_player_count ?? null,
      convergence_pairs: viewer?.convergence_pairs.length ?? 0,
      interval_contract_ok: viewerHasIntervals,
    },
    ["viewer payload does not expose the benchmark point estimate and reliability metadata together"],
  ));

  const snapshotPriceRows = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_price_point
     WHERE dataset_snapshot_id = ?`,
    published.dataset_snapshot_id,
  );
  const frozenMetricPriceRows = count(
    db,
    `SELECT COUNT(*) AS count
     FROM benchmark_metric_input_price
     WHERE benchmark_metric_run_id = ?`,
    published.benchmark_metric_run_id,
  );
  const snapshotSources = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_source
     WHERE dataset_snapshot_id = ?`,
    published.dataset_snapshot_id,
  );
  const traceableSnapshotSources = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_source dss
     JOIN source_snapshot ss ON ss.source_snapshot_id = dss.source_snapshot_id
     WHERE dss.dataset_snapshot_id = ?`,
    published.dataset_snapshot_id,
  );
  const universeSources = count(
    db,
    `SELECT COUNT(*) AS count
     FROM market_universe_source
     WHERE universe_snapshot_id = ?`,
    published.universe_snapshot_id,
  );
  const traceableUniverseSources = count(
    db,
    `SELECT COUNT(*) AS count
     FROM market_universe_source mus
     JOIN source_snapshot ss ON ss.source_snapshot_id = mus.source_snapshot_id
     WHERE mus.universe_snapshot_id = ?`,
    published.universe_snapshot_id,
  );
  const mb012 =
    published.catalog_id === "MARKET_BENCHMARK_V1" &&
    Number(published.schema_version) >= 17 &&
    panelFamily.universe_snapshot_id === published.universe_snapshot_id &&
    snapshotPriceRows === frozenMetricPriceRows &&
    snapshotSources > 0 &&
    traceableSnapshotSources === snapshotSources &&
    universeSources > 0 &&
    traceableUniverseSources === universeSources;
  criteria.push(criterion(
    "MB-012",
    "Published analysis_run traces through dataset_snapshot, panel, universe, and source snapshots",
    mb012,
    {
      dataset_snapshot_id: published.dataset_snapshot_id,
      schema_version: Number(published.schema_version),
      snapshot_price_rows: snapshotPriceRows,
      frozen_metric_price_rows: frozenMetricPriceRows,
      snapshot_sources: snapshotSources,
      traceable_snapshot_sources: traceableSnapshotSources,
      universe_sources: universeSources,
      traceable_universe_sources: traceableUniverseSources,
    },
    ["benchmark publication lineage or frozen price/source snapshot coverage is incomplete"],
  ));

  const effectiveDate = dateInTimezone(panelFamily.effective_from, metricRun.timezone);
  const preRows = count(
    db,
    `SELECT COUNT(*) AS count
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ? AND metric_date < ?`,
    published.benchmark_metric_run_id,
    effectiveDate,
  );
  const wrongPreRows = count(
    db,
    `SELECT COUNT(*) AS count
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ? AND metric_date < ?
       AND period_type <> 'FIXED_PANEL_BACKCAST'`,
    published.benchmark_metric_run_id,
    effectiveDate,
  );
  criteria.push(criterion(
    "MB-013",
    "Pre-effective history is retained only as FIXED_PANEL_BACKCAST",
    preRows > 0 && wrongPreRows === 0,
    { effective_date: effectiveDate, pre_effective_rows: preRows, wrong_period_rows: wrongPreRows },
    ["pre-effective benchmark rows are missing or are exposed as contemporaneous market data"],
  ));

  const postRows = count(
    db,
    `SELECT COUNT(*) AS count
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ? AND metric_date >= ?`,
    published.benchmark_metric_run_id,
    effectiveDate,
  );
  const wrongPostRows = count(
    db,
    `SELECT COUNT(*) AS count
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ? AND metric_date >= ?
       AND period_type <> 'CONTEMPORANEOUS'`,
    published.benchmark_metric_run_id,
    effectiveDate,
  );
  criteria.push(criterion(
    "MB-014",
    "Panel membership becomes contemporaneous only from effective_from onward",
    wrongPostRows === 0 && preRows > 0,
    { effective_date: effectiveDate, post_effective_rows: postRows, wrong_period_rows: wrongPostRows, retained_backcast_rows: preRows },
    ["effective_from boundary is not preserved between backcast and contemporaneous benchmark rows"],
  ));

  if (criteria.length !== 14) {
    throw new Error(`benchmark acceptance must emit 14 criteria, got ${criteria.length}`);
  }
  return summarizeBenchmarkAcceptance(
    published.analysis_run_id,
    published.dataset_snapshot_id,
    published.benchmark_convergence_run_id,
    criteria,
    input.checkedAt ?? new Date().toISOString(),
  );
}
