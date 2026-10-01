import type { DatabaseSync } from "node:sqlite";

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

export interface ViewerPayload {
  run: ViewerRun;
  cohorts: ViewerCohort[];
  metrics: ViewerMetric[];
  events: ViewerEvent[];
  replay: ViewerReplayMetric[];
  shocks: ViewerShock[];
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

  return { run, cohorts, metrics, events, replay, shocks };
}
