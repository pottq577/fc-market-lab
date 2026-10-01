CREATE TABLE dataset_snapshot_cohort_definition (
  dataset_snapshot_id TEXT NOT NULL,
  cohort_id TEXT NOT NULL,
  name TEXT NOT NULL,
  aggregation_level TEXT NOT NULL CHECK (
    aggregation_level IN ('PLAYER', 'INSTRUMENT')
  ),
  rule_version TEXT NOT NULL,
  rule_params_json TEXT NOT NULL,
  PRIMARY KEY (dataset_snapshot_id, cohort_id)
) STRICT;

CREATE TABLE analysis_metric (
  analysis_run_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (
    scope_type IN ('INSTRUMENT', 'PLAYER', 'COHORT')
  ),
  scope_id TEXT NOT NULL,
  metric_name TEXT NOT NULL CHECK (
    metric_name IN (
      'RETURN_1D',
      'INDEX',
      'RELATIVE_STRENGTH',
      'BREADTH',
      'IQR',
      'MAD'
    )
  ),
  value REAL,
  status TEXT NOT NULL CHECK (status IN ('OK', 'NO_RESULT')),
  valid_count INTEGER NOT NULL CHECK (valid_count >= 0),
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  coverage_ratio REAL NOT NULL CHECK (
    coverage_ratio >= 0 AND coverage_ratio <= 1
  ),
  details_json TEXT NOT NULL,
  CHECK (valid_count <= total_count),
  CHECK (
    (status = 'OK' AND value IS NOT NULL)
    OR (status = 'NO_RESULT' AND value IS NULL)
  ),
  PRIMARY KEY (
    analysis_run_id,
    metric_date,
    scope_type,
    scope_id,
    metric_name
  )
) STRICT;

CREATE INDEX analysis_metric_scope_date_idx
  ON analysis_metric(analysis_run_id, scope_type, scope_id, metric_date);
CREATE INDEX analysis_metric_name_date_idx
  ON analysis_metric(analysis_run_id, metric_name, metric_date);
