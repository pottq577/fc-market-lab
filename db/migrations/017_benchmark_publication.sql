CREATE TABLE dataset_snapshot_benchmark (
  dataset_snapshot_id TEXT PRIMARY KEY,
  benchmark_convergence_run_id TEXT NOT NULL UNIQUE,
  benchmark_uncertainty_run_id TEXT NOT NULL,
  benchmark_metric_run_id TEXT NOT NULL,
  panel_family_id TEXT NOT NULL,
  universe_snapshot_id TEXT NOT NULL,
  display_panel_id TEXT NOT NULL,
  display_role TEXT NOT NULL CHECK (
    display_role IN ('SELECTED_PRODUCTION', 'DIAGNOSTIC_LARGEST')
  ),
  benchmark_status TEXT NOT NULL CHECK (
    benchmark_status IN ('STABLE', 'UNSTABLE')
  ),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX dataset_snapshot_benchmark_family_idx
  ON dataset_snapshot_benchmark(panel_family_id, created_at);
