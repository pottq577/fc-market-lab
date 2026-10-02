import type { DatabaseSync } from "node:sqlite";

import { loadBenchmarkViewerPayload } from "../viewer/benchmark-data.ts";

const ANALYSIS_VERSION = "market-benchmark-v2";
const CATALOG_ID = "MARKET_BENCHMARK_V2";
const METRIC_VERSION = "market-benchmark-metrics-v2";
const UNCERTAINTY_VERSION = "market-benchmark-uncertainty-v2";
const CONVERGENCE_VERSION = "market-benchmark-convergence-v2-weighted-mean";
const EXPECTED_PANEL_SIZE = 300;
const RETURN_AGGREGATION = "WEIGHTED_MEAN_PLAYER_RETURN";
const PARITY_TOLERANCE = 1e-12;

export interface BenchmarkV2AcceptanceCriterionResult {
  id: `MB2-${string}`;
  title: string;
  status: "PASS" | "FAIL";
  evidence: Record<string, unknown>;
  blockers: string[];
}

export interface BenchmarkV2AcceptanceResult {
  status: "COMPLETE" | "INCOMPLETE";
  analysis_run_id: string;
  dataset_snapshot_id: string;
  benchmark_convergence_run_id: string;
  checked_at: string;
  passed: number;
  failed: number;
  criteria: BenchmarkV2AcceptanceCriterionResult[];
}

function criterion(
  id: BenchmarkV2AcceptanceCriterionResult["id"],
  title: string,
  pass: boolean,
  evidence: Record<string, unknown>,
  blockers: string[],
): BenchmarkV2AcceptanceCriterionResult {
  return { id, title, status: pass ? "PASS" : "FAIL", evidence, blockers: pass ? [] : blockers };
}

export function summarizeBenchmarkV2Acceptance(
  analysisRunId: string,
  datasetSnapshotId: string,
  convergenceRunId: string,
  criteria: BenchmarkV2AcceptanceCriterionResult[],
  checkedAt: string,
): BenchmarkV2AcceptanceResult {
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

export function resolveBenchmarkV2AcceptanceAnalysisRunId(
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
       WHERE ar.analysis_run_id = ? AND ar.analysis_version = ? AND ar.status = 'SUCCEEDED'`,
    ).get(value, ANALYSIS_VERSION) as { analysis_run_id: string } | undefined;
    if (!row) throw new TypeError(`benchmark v2 analysis run ${value} is not published`);
    return row.analysis_run_id;
  }
  const latest = db.prepare(
    `SELECT ar.analysis_run_id
     FROM analysis_run ar
     JOIN dataset_snapshot_benchmark dsb ON dsb.dataset_snapshot_id = ar.dataset_snapshot_id
     WHERE ar.analysis_version = ? AND ar.status = 'SUCCEEDED'
     ORDER BY ar.created_at DESC, ar.analysis_run_id DESC
     LIMIT 1`,
  ).get(ANALYSIS_VERSION) as { analysis_run_id: string } | undefined;
  if (!latest) throw new TypeError("no published benchmark v2 analysis run exists");
  return latest.analysis_run_id;
}

export function runBenchmarkV2Acceptance(
  db: DatabaseSync,
  input: { analysisRunId: string; checkedAt?: string },
): BenchmarkV2AcceptanceResult {
  const published = db.prepare(
    `SELECT dsb.dataset_snapshot_id, dsb.benchmark_convergence_run_id,
            dsb.benchmark_uncertainty_run_id, dsb.benchmark_metric_run_id,
            dsb.panel_family_id, dsb.display_panel_id, dsb.display_role,
            dsb.benchmark_status, ar.analysis_run_id, ar.analysis_version,
            ds.catalog_id
     FROM dataset_snapshot_benchmark dsb
     JOIN analysis_run ar ON ar.dataset_snapshot_id = dsb.dataset_snapshot_id
     JOIN dataset_snapshot ds ON ds.dataset_snapshot_id = dsb.dataset_snapshot_id
     WHERE ar.analysis_run_id = ? AND ar.analysis_version = ?`,
  ).get(input.analysisRunId, ANALYSIS_VERSION) as {
    dataset_snapshot_id: string;
    benchmark_convergence_run_id: string;
    benchmark_uncertainty_run_id: string;
    benchmark_metric_run_id: string;
    panel_family_id: string;
    display_panel_id: string;
    display_role: string;
    benchmark_status: string;
    analysis_run_id: string;
    analysis_version: string;
    catalog_id: string;
  } | undefined;
  if (!published) throw new TypeError(`benchmark v2 analysis run ${input.analysisRunId} is not published`);

  const metric = db.prepare(
    `SELECT metric_version FROM benchmark_metric_run WHERE benchmark_metric_run_id = ?`,
  ).get(published.benchmark_metric_run_id) as { metric_version: string } | undefined;
  const uncertainty = db.prepare(
    `SELECT uncertainty_version FROM benchmark_uncertainty_run WHERE benchmark_uncertainty_run_id = ?`,
  ).get(published.benchmark_uncertainty_run_id) as { uncertainty_version: string } | undefined;
  const convergence = db.prepare(
    `SELECT convergence_version, benchmark_status, selected_panel_id
     FROM benchmark_convergence_run WHERE benchmark_convergence_run_id = ?`,
  ).get(published.benchmark_convergence_run_id) as {
    convergence_version: string;
    benchmark_status: string;
    selected_panel_id: string | null;
  } | undefined;
  if (!metric || !uncertainty || !convergence) {
    throw new TypeError("benchmark v2 publication has incomplete run provenance");
  }
  const selected = convergence.selected_panel_id === null ? undefined : db.prepare(
    `SELECT panel_label, panel_size FROM benchmark_panel WHERE panel_id = ? AND panel_family_id = ?`,
  ).get(convergence.selected_panel_id, published.panel_family_id) as {
    panel_label: string;
    panel_size: number | bigint;
  } | undefined;

  const criteria: BenchmarkV2AcceptanceCriterionResult[] = [];
  criteria.push(criterion(
    "MB2-001",
    "Published benchmark uses the complete v2 analysis contract",
    published.analysis_version === ANALYSIS_VERSION &&
      published.catalog_id === CATALOG_ID &&
      metric.metric_version === METRIC_VERSION &&
      uncertainty.uncertainty_version === UNCERTAINTY_VERSION &&
      convergence.convergence_version === CONVERGENCE_VERSION,
    {
      analysis_version: published.analysis_version,
      catalog_id: published.catalog_id,
      metric_version: metric.metric_version,
      uncertainty_version: uncertainty.uncertainty_version,
      convergence_version: convergence.convergence_version,
    },
    ["analysis, catalog, metric, uncertainty, or convergence version is not the benchmark v2 contract"],
  ));

  const selectedSize = selected ? Number(selected.panel_size) : null;
  criteria.push(criterion(
    "MB2-002",
    "Stable v2 publication selects P300 as the production panel",
    published.benchmark_status === "STABLE" &&
      convergence.benchmark_status === "STABLE" &&
      published.display_role === "SELECTED_PRODUCTION" &&
      convergence.selected_panel_id === published.display_panel_id &&
      selectedSize === EXPECTED_PANEL_SIZE,
    {
      benchmark_status: convergence.benchmark_status,
      display_role: published.display_role,
      selected_panel_id: convergence.selected_panel_id,
      selected_panel_label: selected?.panel_label ?? null,
      selected_panel_size: selectedSize,
    },
    [`benchmark v2 must publish STABLE selected P${EXPECTED_PANEL_SIZE}`],
  ));

  const returnRows = db.prepare(
    `SELECT status, details_json
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ? AND metric_name = 'RETURN_1D'`,
  ).all(published.benchmark_metric_run_id) as Array<{ status: string; details_json: string }>;
  let aggregationMismatchRows = 0;
  let okReturnRows = 0;
  for (const row of returnRows) {
    if (row.status !== "OK") continue;
    okReturnRows += 1;
    let aggregation: unknown;
    try {
      aggregation = (JSON.parse(row.details_json) as { aggregation?: unknown }).aggregation;
    } catch {
      aggregation = undefined;
    }
    if (aggregation !== RETURN_AGGREGATION) aggregationMismatchRows += 1;
  }
  criteria.push(criterion(
    "MB2-003",
    "Every valid v2 market return uses the population-weighted mean",
    okReturnRows > 0 && aggregationMismatchRows === 0,
    { ok_return_rows: okReturnRows, aggregation_mismatch_rows: aggregationMismatchRows, aggregation: RETURN_AGGREGATION },
    ["one or more valid v2 RETURN_1D rows do not declare WEIGHTED_MEAN_PLAYER_RETURN"],
  ));

  const candidate = db.prepare(
    `SELECT benchmark_signal_candidate_run_id
     FROM benchmark_signal_candidate_run
     WHERE panel_family_id = ? AND status = 'SUCCEEDED'
     ORDER BY created_at DESC, benchmark_signal_candidate_run_id DESC
     LIMIT 1`,
  ).get(published.panel_family_id) as { benchmark_signal_candidate_run_id: string } | undefined;
  let parityRows = 0;
  let parityMismatchRows = 0;
  let maxAbsDiff = 0;
  if (candidate) {
    const parity = db.prepare(
      `SELECT bm.status AS metric_status, bm.value AS metric_value,
              bscm.status AS candidate_status, bscm.weighted_mean AS candidate_value
       FROM benchmark_metric bm
       LEFT JOIN benchmark_signal_candidate_metric bscm
         ON bscm.benchmark_signal_candidate_run_id = ?
        AND bscm.panel_id = bm.panel_id
        AND bscm.metric_date = bm.metric_date
       WHERE bm.benchmark_metric_run_id = ? AND bm.metric_name = 'RETURN_1D'`,
    ).all(candidate.benchmark_signal_candidate_run_id, published.benchmark_metric_run_id) as Array<{
      metric_status: string;
      metric_value: number | null;
      candidate_status: string | null;
      candidate_value: number | null;
    }>;
    parityRows = parity.length;
    for (const row of parity) {
      if (row.metric_status === "NO_RESULT") {
        if (row.candidate_status !== "BASE_NO_RESULT") parityMismatchRows += 1;
        continue;
      }
      if (row.metric_value === null || row.candidate_value === null || row.candidate_status === null) {
        parityMismatchRows += 1;
        continue;
      }
      const diff = Math.abs(row.metric_value - row.candidate_value);
      maxAbsDiff = Math.max(maxAbsDiff, diff);
      if (diff > PARITY_TOLERANCE) parityMismatchRows += 1;
    }
  }
  criteria.push(criterion(
    "MB2-004",
    "Published v2 weighted mean exactly reproduces the evaluated candidate signal",
    candidate !== undefined && parityRows > 0 && parityMismatchRows === 0,
    {
      source_candidate_run_id: candidate?.benchmark_signal_candidate_run_id ?? null,
      compared_rows: parityRows,
      mismatch_rows: parityMismatchRows,
      max_abs_diff: Number(maxAbsDiff.toFixed(12)),
    },
    ["v2 return rows differ from the dense-refinement WEIGHTED_MEAN candidate evaluation"],
  ));

  const pairs = db.prepare(
    `SELECT smaller_panel_size, larger_panel_size, status, details_json
     FROM panel_convergence
     WHERE benchmark_convergence_run_id = ?
     ORDER BY smaller_panel_size, larger_panel_size`,
  ).all(published.benchmark_convergence_run_id) as Array<{
    smaller_panel_size: number | bigint;
    larger_panel_size: number | bigint;
    status: string;
    details_json: string;
  }>;
  const p200p250 = pairs.find(
    (row) => Number(row.smaller_panel_size) === 200 && Number(row.larger_panel_size) === 250,
  );
  const tail = pairs.filter((row) => Number(row.smaller_panel_size) >= 250);
  const tailFailures = tail.filter((row) => row.status !== "PASS");
  criteria.push(criterion(
    "MB2-005",
    "The dense panel grid fails below P250 and converges continuously from P250 upward",
    p200p250?.status === "FAIL" && tail.length > 0 && tailFailures.length === 0,
    {
      p200_p250_status: p200p250?.status ?? null,
      tail_pairs: tail.length,
      tail_failures: tailFailures.length,
      tail_end_panel_size: tail.length > 0 ? Number(tail.at(-1)!.larger_panel_size) : null,
    },
    ["dense refinement convergence tail is not continuously PASS from P250 to P800"],
  ));

  const viewer = loadBenchmarkViewerPayload(db, published.analysis_run_id);
  criteria.push(criterion(
    "MB2-006",
    "Benchmark Viewer resolves the published v2 contract and P300 production panel",
    viewer !== null &&
      viewer.published &&
      viewer.analysis_version === ANALYSIS_VERSION &&
      viewer.metric_version === METRIC_VERSION &&
      viewer.return_aggregation === RETURN_AGGREGATION &&
      viewer.benchmark_status === "STABLE" &&
      viewer.display_role === "SELECTED_PRODUCTION" &&
      viewer.display_panel_size === EXPECTED_PANEL_SIZE,
    {
      analysis_version: viewer?.analysis_version ?? null,
      metric_version: viewer?.metric_version ?? null,
      return_aggregation: viewer?.return_aggregation ?? null,
      benchmark_status: viewer?.benchmark_status ?? null,
      display_panel_label: viewer?.display_panel_label ?? null,
      display_panel_size: viewer?.display_panel_size ?? null,
    },
    ["Viewer does not expose the published stable v2 P300 weighted-mean benchmark"],
  ));

  const snapshotPriceRows = Number((db.prepare(
    `SELECT COUNT(*) AS count FROM dataset_snapshot_price_point WHERE dataset_snapshot_id = ?`,
  ).get(published.dataset_snapshot_id) as { count: number | bigint }).count);
  const metricPriceRows = Number((db.prepare(
    `SELECT COUNT(*) AS count FROM benchmark_metric_input_price WHERE benchmark_metric_run_id = ?`,
  ).get(published.benchmark_metric_run_id) as { count: number | bigint }).count);
  const snapshotSources = Number((db.prepare(
    `SELECT COUNT(*) AS count FROM dataset_snapshot_source WHERE dataset_snapshot_id = ?`,
  ).get(published.dataset_snapshot_id) as { count: number | bigint }).count);
  criteria.push(criterion(
    "MB2-007",
    "Published v2 dataset freezes the exact metric input prices and source provenance",
    snapshotPriceRows > 0 && snapshotPriceRows === metricPriceRows && snapshotSources > 0,
    { snapshot_price_rows: snapshotPriceRows, metric_price_rows: metricPriceRows, snapshot_sources: snapshotSources },
    ["published v2 dataset does not freeze the complete benchmark metric input/source provenance"],
  ));

  return summarizeBenchmarkV2Acceptance(
    published.analysis_run_id,
    published.dataset_snapshot_id,
    published.benchmark_convergence_run_id,
    criteria,
    input.checkedAt ?? new Date().toISOString(),
  );
}
