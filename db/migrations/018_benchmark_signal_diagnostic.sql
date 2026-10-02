CREATE TABLE benchmark_signal_diagnostic_run (
  benchmark_signal_diagnostic_run_id TEXT PRIMARY KEY,
  benchmark_metric_run_id TEXT NOT NULL,
  diagnostic_version TEXT NOT NULL CHECK (length(diagnostic_version) > 0),
  trim_ratio REAL NOT NULL CHECK (trim_ratio >= 0 AND trim_ratio < 0.5),
  zero_dominance_threshold REAL NOT NULL CHECK (
    zero_dominance_threshold > 0 AND zero_dominance_threshold <= 1
  ),
  input_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'SUCCEEDED'),
  result_hash TEXT NOT NULL
) STRICT;

CREATE INDEX benchmark_signal_diagnostic_run_metric_idx
  ON benchmark_signal_diagnostic_run(
    benchmark_metric_run_id,
    diagnostic_version,
    created_at
  );

CREATE TABLE benchmark_signal_diagnostic (
  benchmark_signal_diagnostic_run_id TEXT NOT NULL,
  panel_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (
    period_type IN ('FIXED_PANEL_BACKCAST', 'CONTEMPORANEOUS')
  ),
  base_status TEXT NOT NULL CHECK (base_status IN ('OK', 'NO_RESULT')),
  base_point_value REAL,
  valid_count INTEGER NOT NULL CHECK (valid_count >= 0),
  total_count INTEGER NOT NULL CHECK (total_count > 0),
  valid_weight REAL NOT NULL CHECK (valid_weight >= 0),
  total_weight REAL NOT NULL CHECK (total_weight > 0),
  weighted_coverage REAL NOT NULL CHECK (
    weighted_coverage >= 0 AND weighted_coverage <= 1
  ),
  zero_count INTEGER NOT NULL CHECK (zero_count >= 0),
  positive_count INTEGER NOT NULL CHECK (positive_count >= 0),
  negative_count INTEGER NOT NULL CHECK (negative_count >= 0),
  zero_weight_ratio REAL,
  positive_weight_ratio REAL,
  negative_weight_ratio REAL,
  weighted_median REAL,
  weighted_mean REAL,
  weighted_trimmed_mean REAL,
  CHECK (valid_count <= total_count),
  CHECK (zero_count + positive_count + negative_count = valid_count),
  CHECK (
    (valid_count = 0
      AND zero_weight_ratio IS NULL
      AND positive_weight_ratio IS NULL
      AND negative_weight_ratio IS NULL
      AND weighted_median IS NULL
      AND weighted_mean IS NULL
      AND weighted_trimmed_mean IS NULL)
    OR
    (valid_count > 0
      AND zero_weight_ratio IS NOT NULL
      AND positive_weight_ratio IS NOT NULL
      AND negative_weight_ratio IS NOT NULL
      AND weighted_median IS NOT NULL
      AND weighted_mean IS NOT NULL
      AND weighted_trimmed_mean IS NOT NULL)
  ),
  CHECK (
    zero_weight_ratio IS NULL
    OR (zero_weight_ratio >= 0 AND zero_weight_ratio <= 1)
  ),
  CHECK (
    positive_weight_ratio IS NULL
    OR (positive_weight_ratio >= 0 AND positive_weight_ratio <= 1)
  ),
  CHECK (
    negative_weight_ratio IS NULL
    OR (negative_weight_ratio >= 0 AND negative_weight_ratio <= 1)
  ),
  PRIMARY KEY (
    benchmark_signal_diagnostic_run_id,
    panel_id,
    metric_date
  )
) STRICT;

CREATE INDEX benchmark_signal_diagnostic_panel_date_idx
  ON benchmark_signal_diagnostic(
    benchmark_signal_diagnostic_run_id,
    panel_id,
    metric_date
  );
