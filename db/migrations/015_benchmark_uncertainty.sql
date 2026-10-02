CREATE TABLE benchmark_uncertainty_run (
  benchmark_uncertainty_run_id TEXT PRIMARY KEY,
  benchmark_metric_run_id TEXT NOT NULL,
  uncertainty_version TEXT NOT NULL CHECK (length(uncertainty_version) > 0),
  method TEXT NOT NULL CHECK (method = 'STRATIFIED_PLAYER_BOOTSTRAP'),
  replicates INTEGER NOT NULL CHECK (replicates > 0),
  confidence_level REAL NOT NULL CHECK (
    confidence_level > 0 AND confidence_level < 1
  ),
  sample_seed TEXT NOT NULL CHECK (length(sample_seed) > 0),
  minimum_valid_replicate_ratio REAL NOT NULL CHECK (
    minimum_valid_replicate_ratio > 0 AND minimum_valid_replicate_ratio <= 1
  ),
  input_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'SUCCEEDED'),
  result_hash TEXT NOT NULL,
  UNIQUE (
    benchmark_metric_run_id,
    uncertainty_version,
    method,
    replicates,
    confidence_level,
    sample_seed,
    minimum_valid_replicate_ratio,
    input_hash
  )
) STRICT;

CREATE INDEX benchmark_uncertainty_run_metric_idx
  ON benchmark_uncertainty_run(
    benchmark_metric_run_id,
    uncertainty_version,
    created_at
  );

CREATE TABLE benchmark_metric_uncertainty (
  benchmark_uncertainty_run_id TEXT NOT NULL,
  panel_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (
    period_type IN ('FIXED_PANEL_BACKCAST', 'CONTEMPORANEOUS')
  ),
  metric_name TEXT NOT NULL CHECK (
    metric_name IN ('RETURN_1D', 'INDEX', 'BREADTH', 'IQR', 'MAD')
  ),
  point_value REAL,
  lower_value REAL,
  upper_value REAL,
  status TEXT NOT NULL CHECK (
    status IN (
      'OK',
      'BASE_NO_RESULT',
      'INSUFFICIENT_UNCERTAINTY_SAMPLE'
    )
  ),
  valid_replicates INTEGER NOT NULL CHECK (valid_replicates >= 0),
  total_replicates INTEGER NOT NULL CHECK (total_replicates > 0),
  details_json TEXT NOT NULL,
  CHECK (valid_replicates <= total_replicates),
  CHECK (
    (status = 'OK'
      AND point_value IS NOT NULL
      AND lower_value IS NOT NULL
      AND upper_value IS NOT NULL
      AND lower_value <= upper_value)
    OR
    (status != 'OK'
      AND lower_value IS NULL
      AND upper_value IS NULL)
  ),
  PRIMARY KEY (
    benchmark_uncertainty_run_id,
    panel_id,
    metric_date,
    metric_name
  )
) STRICT;

CREATE INDEX benchmark_metric_uncertainty_panel_date_idx
  ON benchmark_metric_uncertainty(
    benchmark_uncertainty_run_id,
    panel_id,
    metric_date,
    metric_name
  );
