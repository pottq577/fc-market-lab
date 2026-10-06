import type { DatabaseSync } from "node:sqlite";

import { benchmarkReturnAggregation } from "../benchmark/metrics.ts";

export type ViewerBenchmarkMetricName = "RETURN_1D" | "INDEX" | "BREADTH" | "IQR" | "MAD";

export interface ViewerBenchmarkMetric {
  metric_name: ViewerBenchmarkMetricName;
  metric_date: string;
  period_type: "FIXED_PANEL_BACKCAST" | "CONTEMPORANEOUS";
  point_value: number | null;
  metric_status: string;
  valid_count: number;
  total_count: number;
  weighted_coverage: number;
  lower_value: number | null;
  upper_value: number | null;
  uncertainty_status: string | null;
  valid_replicates: number | null;
  total_replicates: number | null;
}

export interface ViewerConvergencePair {
  smaller_panel_label: string;
  smaller_panel_size: number;
  larger_panel_label: string;
  larger_panel_size: number;
  common_valid_return_days: number;
  common_valid_breadth_days: number;
  direction_compared_days: number;
  return_median_abs_diff: number | null;
  return_p95_abs_diff: number | null;
  return_direction_match_ratio: number | null;
  breadth_median_abs_diff: number | null;
  status: string;
  reasons: string[];
}

export interface ViewerBenchmarkPayload {
  published: boolean;
  analysis_run_id: string | null;
  analysis_version: string | null;
  dataset_snapshot_id: string | null;
  benchmark_convergence_run_id: string;
  benchmark_uncertainty_run_id: string;
  benchmark_metric_run_id: string;
  panel_family_id: string;
  benchmark_status: "STABLE" | "UNSTABLE";
  convergence_version: string;
  display_panel_id: string;
  display_panel_label: string;
  display_panel_size: number;
  display_role: "SELECTED_PRODUCTION" | "DIAGNOSTIC_LARGEST";
  panel_version: string;
  effective_from: string;
  universe_snapshot_id: string;
  universe_as_of: string;
  price_eligible_player_count: number;
  analysis_cutoff: string;
  metric_version: string;
  return_aggregation: string;
  latest_metric_date: string | null;
  latest_metrics: ViewerBenchmarkMetric[];
  history_metrics: ViewerBenchmarkMetric[];
  convergence_pairs: ViewerConvergencePair[];
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name));
}

function parseReasons(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as { reasons?: unknown };
    return Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function loadBenchmarkViewerPayload(
  db: DatabaseSync,
  requestedAnalysisRunId?: string,
): ViewerBenchmarkPayload | null {
  if (!tableExists(db, "benchmark_convergence_run")) return null;

  let publication: {
    dataset_snapshot_id: string;
    analysis_run_id: string;
    analysis_version: string;
    benchmark_convergence_run_id: string;
    display_panel_id: string;
    display_role: "SELECTED_PRODUCTION" | "DIAGNOSTIC_LARGEST";
  } | undefined;
  if (tableExists(db, "dataset_snapshot_benchmark")) {
    if (requestedAnalysisRunId !== undefined) {
      publication = db.prepare(
        `SELECT dsb.dataset_snapshot_id, ar.analysis_run_id, ar.analysis_version,
                dsb.benchmark_convergence_run_id, dsb.display_panel_id, dsb.display_role
         FROM dataset_snapshot_benchmark dsb
         JOIN analysis_run ar ON ar.dataset_snapshot_id = dsb.dataset_snapshot_id
         WHERE ar.analysis_run_id = ? AND ar.analysis_version IN ('market-benchmark-v1', 'market-benchmark-v2')`,
      ).get(requestedAnalysisRunId) as typeof publication;
      if (!publication) {
        throw new TypeError(`benchmark analysis run ${requestedAnalysisRunId} is not published`);
      }
    } else {
      publication = db.prepare(
        `SELECT dsb.dataset_snapshot_id, ar.analysis_run_id, ar.analysis_version,
                dsb.benchmark_convergence_run_id, dsb.display_panel_id, dsb.display_role
         FROM dataset_snapshot_benchmark dsb
         JOIN analysis_run ar ON ar.dataset_snapshot_id = dsb.dataset_snapshot_id
         WHERE ar.analysis_version IN ('market-benchmark-v1', 'market-benchmark-v2') AND ar.status = 'SUCCEEDED'
         ORDER BY CASE ar.analysis_version
           WHEN 'market-benchmark-v2' THEN 0
           ELSE 1 END,
           ar.created_at DESC, ar.analysis_run_id DESC
         LIMIT 1`,
      ).get() as typeof publication;
    }
  } else if (requestedAnalysisRunId !== undefined) {
    throw new TypeError("benchmark publication schema is unavailable");
  }

  const convergence = publication
    ? db.prepare(
        `SELECT benchmark_convergence_run_id, benchmark_uncertainty_run_id,
                benchmark_metric_run_id, panel_family_id, convergence_version,
                benchmark_status, selected_panel_id
         FROM benchmark_convergence_run
         WHERE benchmark_convergence_run_id = ? AND status = 'SUCCEEDED'`,
      ).get(publication.benchmark_convergence_run_id)
    : db.prepare(
        `SELECT benchmark_convergence_run_id, benchmark_uncertainty_run_id,
                benchmark_metric_run_id, panel_family_id, convergence_version,
                benchmark_status, selected_panel_id
         FROM benchmark_convergence_run
         WHERE status = 'SUCCEEDED'
         ORDER BY created_at DESC, benchmark_convergence_run_id DESC
         LIMIT 1`,
      ).get();
  if (!convergence) return null;
  const run = convergence as {
    benchmark_convergence_run_id: string;
    benchmark_uncertainty_run_id: string;
    benchmark_metric_run_id: string;
    panel_family_id: string;
    convergence_version: string;
    benchmark_status: "STABLE" | "UNSTABLE";
    selected_panel_id: string | null;
  };

  const metricRun = db.prepare(
    `SELECT analysis_cutoff, metric_version
     FROM benchmark_metric_run
     WHERE benchmark_metric_run_id = ?`,
  ).get(run.benchmark_metric_run_id) as {
    analysis_cutoff: string;
    metric_version: string;
  } | undefined;
  const family = db.prepare(
    `SELECT universe_snapshot_id, panel_version, effective_from
     FROM benchmark_panel_family
     WHERE panel_family_id = ?`,
  ).get(run.panel_family_id) as {
    universe_snapshot_id: string;
    panel_version: string;
    effective_from: string;
  } | undefined;
  if (!metricRun || !family) {
    throw new TypeError(`benchmark run ${run.benchmark_convergence_run_id} has incomplete provenance`);
  }
  const universe = db.prepare(
    `SELECT as_of, price_eligible_player_count
     FROM market_universe_snapshot
     WHERE universe_snapshot_id = ?`,
  ).get(family.universe_snapshot_id) as {
    as_of: string;
    price_eligible_player_count: number | bigint;
  } | undefined;
  if (!universe) {
    throw new TypeError(`benchmark universe ${family.universe_snapshot_id} is unavailable`);
  }

  let displayPanelId = publication?.display_panel_id ?? run.selected_panel_id;
  let displayRole: "SELECTED_PRODUCTION" | "DIAGNOSTIC_LARGEST" =
    publication?.display_role ?? "SELECTED_PRODUCTION";
  if (displayPanelId === null) {
    const largest = db.prepare(
      `SELECT panel_id
       FROM benchmark_panel
       WHERE panel_family_id = ?
       ORDER BY panel_size DESC, panel_id DESC
       LIMIT 1`,
    ).get(run.panel_family_id) as { panel_id: string } | undefined;
    if (!largest) throw new TypeError(`panel family ${run.panel_family_id} has no panels`);
    displayPanelId = largest.panel_id;
    displayRole = "DIAGNOSTIC_LARGEST";
  }
  const displayPanel = db.prepare(
    `SELECT panel_label, panel_size
     FROM benchmark_panel
     WHERE panel_family_id = ? AND panel_id = ?`,
  ).get(run.panel_family_id, displayPanelId) as {
    panel_label: string;
    panel_size: number | bigint;
  } | undefined;
  if (!displayPanel) throw new TypeError(`display panel ${displayPanelId} is unavailable`);

  const latest = db.prepare(
    `SELECT metric_date
     FROM benchmark_metric
     WHERE benchmark_metric_run_id = ?
       AND panel_id = ?
       AND metric_name = 'RETURN_1D'
       AND status = 'OK'
     ORDER BY metric_date DESC
     LIMIT 1`,
  ).get(run.benchmark_metric_run_id, displayPanelId) as { metric_date: string } | undefined;

  const metrics = latest
    ? db.prepare(
        `SELECT bm.metric_name, bm.metric_date, bm.period_type,
                bm.value AS point_value, bm.status AS metric_status,
                bm.valid_count, bm.total_count, bm.weighted_coverage,
                bmu.lower_value, bmu.upper_value,
                bmu.status AS uncertainty_status,
                bmu.valid_replicates, bmu.total_replicates
         FROM benchmark_metric bm
         LEFT JOIN benchmark_metric_uncertainty bmu
           ON bmu.benchmark_uncertainty_run_id = ?
          AND bmu.panel_id = bm.panel_id
          AND bmu.metric_date = bm.metric_date
          AND bmu.metric_name = bm.metric_name
         WHERE bm.benchmark_metric_run_id = ?
           AND bm.panel_id = ?
           AND bm.metric_date = ?
         ORDER BY CASE bm.metric_name
           WHEN 'RETURN_1D' THEN 1
           WHEN 'INDEX' THEN 2
           WHEN 'BREADTH' THEN 3
           WHEN 'IQR' THEN 4
           WHEN 'MAD' THEN 5
           ELSE 99 END`,
      ).all(
        run.benchmark_uncertainty_run_id,
        run.benchmark_metric_run_id,
        displayPanelId,
        latest.metric_date,
      ).map((row) => ({ ...row })) as unknown as ViewerBenchmarkMetric[]
    : [];

  const historyMetrics = db.prepare(
    `SELECT bm.metric_name, bm.metric_date, bm.period_type,
            bm.value AS point_value, bm.status AS metric_status,
            bm.valid_count, bm.total_count, bm.weighted_coverage,
            bmu.lower_value, bmu.upper_value,
            bmu.status AS uncertainty_status,
            bmu.valid_replicates, bmu.total_replicates
     FROM benchmark_metric bm
     LEFT JOIN benchmark_metric_uncertainty bmu
       ON bmu.benchmark_uncertainty_run_id = ?
      AND bmu.panel_id = bm.panel_id
      AND bmu.metric_date = bm.metric_date
      AND bmu.metric_name = bm.metric_name
     WHERE bm.benchmark_metric_run_id = ?
       AND bm.panel_id = ?
       AND bm.metric_name IN ('RETURN_1D', 'INDEX', 'BREADTH')
     ORDER BY bm.metric_date,
       CASE bm.metric_name
         WHEN 'RETURN_1D' THEN 1
         WHEN 'INDEX' THEN 2
         WHEN 'BREADTH' THEN 3
         ELSE 99 END`,
  ).all(
    run.benchmark_uncertainty_run_id,
    run.benchmark_metric_run_id,
    displayPanelId,
  ).map((row) => ({ ...row })) as unknown as ViewerBenchmarkMetric[];

  const pairs = db.prepare(
    `SELECT sp.panel_label AS smaller_panel_label,
            pc.smaller_panel_size,
            lp.panel_label AS larger_panel_label,
            pc.larger_panel_size,
            pc.common_valid_return_days, pc.common_valid_breadth_days,
            pc.direction_compared_days, pc.return_median_abs_diff,
            pc.return_p95_abs_diff, pc.return_direction_match_ratio,
            pc.breadth_median_abs_diff, pc.status, pc.details_json
     FROM panel_convergence pc
     JOIN benchmark_panel sp ON sp.panel_id = pc.smaller_panel_id
     JOIN benchmark_panel lp ON lp.panel_id = pc.larger_panel_id
     WHERE pc.benchmark_convergence_run_id = ?
     ORDER BY pc.smaller_panel_size, pc.larger_panel_size`,
  ).all(run.benchmark_convergence_run_id) as Array<{
    smaller_panel_label: string;
    smaller_panel_size: number | bigint;
    larger_panel_label: string;
    larger_panel_size: number | bigint;
    common_valid_return_days: number | bigint;
    common_valid_breadth_days: number | bigint;
    direction_compared_days: number | bigint;
    return_median_abs_diff: number | null;
    return_p95_abs_diff: number | null;
    return_direction_match_ratio: number | null;
    breadth_median_abs_diff: number | null;
    status: string;
    details_json: string;
  }>;

  return {
    published: publication !== undefined,
    analysis_run_id: publication?.analysis_run_id ?? null,
    analysis_version: publication?.analysis_version ?? null,
    dataset_snapshot_id: publication?.dataset_snapshot_id ?? null,
    benchmark_convergence_run_id: run.benchmark_convergence_run_id,
    benchmark_uncertainty_run_id: run.benchmark_uncertainty_run_id,
    benchmark_metric_run_id: run.benchmark_metric_run_id,
    panel_family_id: run.panel_family_id,
    benchmark_status: run.benchmark_status,
    convergence_version: run.convergence_version,
    display_panel_id: displayPanelId,
    display_panel_label: displayPanel.panel_label,
    display_panel_size: Number(displayPanel.panel_size),
    display_role: displayRole,
    panel_version: family.panel_version,
    effective_from: family.effective_from,
    universe_snapshot_id: family.universe_snapshot_id,
    universe_as_of: universe.as_of,
    price_eligible_player_count: Number(universe.price_eligible_player_count),
    analysis_cutoff: metricRun.analysis_cutoff,
    metric_version: metricRun.metric_version,
    return_aggregation: benchmarkReturnAggregation(metricRun.metric_version),
    latest_metric_date: latest?.metric_date ?? null,
    latest_metrics: metrics,
    history_metrics: historyMetrics,
    convergence_pairs: pairs.map((row) => ({
      smaller_panel_label: row.smaller_panel_label,
      smaller_panel_size: Number(row.smaller_panel_size),
      larger_panel_label: row.larger_panel_label,
      larger_panel_size: Number(row.larger_panel_size),
      common_valid_return_days: Number(row.common_valid_return_days),
      common_valid_breadth_days: Number(row.common_valid_breadth_days),
      direction_compared_days: Number(row.direction_compared_days),
      return_median_abs_diff: row.return_median_abs_diff,
      return_p95_abs_diff: row.return_p95_abs_diff,
      return_direction_match_ratio: row.return_direction_match_ratio,
      breadth_median_abs_diff: row.breadth_median_abs_diff,
      status: row.status,
      reasons: parseReasons(row.details_json),
    })),
  };
}
