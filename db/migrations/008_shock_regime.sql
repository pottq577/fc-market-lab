CREATE TABLE shock_score (
  analysis_run_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  metric_name TEXT NOT NULL CHECK (metric_name = 'RETURN_1D'),
  value REAL,
  robust_z REAL,
  status TEXT NOT NULL CHECK (status IN ('OK', 'NO_RESULT')),
  baseline_count INTEGER NOT NULL CHECK (baseline_count >= 0),
  baseline_median REAL,
  baseline_mad REAL,
  reason TEXT,
  is_candidate INTEGER NOT NULL CHECK (is_candidate IN (0, 1)),
  details_json TEXT NOT NULL,
  CHECK (status = 'OK' OR robust_z IS NULL),
  CHECK (is_candidate = 0 OR (status = 'OK' AND robust_z IS NOT NULL)),
  PRIMARY KEY (analysis_run_id, metric_date, scope_id, metric_name)
) STRICT;

CREATE INDEX shock_score_scope_date_idx
  ON shock_score(analysis_run_id, scope_id, metric_date);

CREATE TABLE shock_candidate (
  shock_candidate_id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  metric_name TEXT NOT NULL CHECK (metric_name = 'RETURN_1D'),
  value REAL NOT NULL,
  robust_z REAL NOT NULL,
  severity REAL NOT NULL CHECK (severity >= 0),
  detector_version TEXT NOT NULL,
  UNIQUE (analysis_run_id, metric_date, scope_id, metric_name)
) STRICT;

CREATE INDEX shock_candidate_run_date_idx
  ON shock_candidate(analysis_run_id, metric_date);
