CREATE TABLE benchmark_signal_candidate_run (
  benchmark_signal_candidate_run_id TEXT PRIMARY KEY,
  benchmark_signal_diagnostic_run_id TEXT NOT NULL,
  benchmark_metric_run_id TEXT NOT NULL,
  panel_family_id TEXT NOT NULL,
  evaluation_version TEXT NOT NULL CHECK (length(evaluation_version) > 0),
  mover_winsor_ratio REAL NOT NULL CHECK (
    mover_winsor_ratio >= 0 AND mover_winsor_ratio < 0.5
  ),
  minimum_common_valid_days INTEGER NOT NULL CHECK (minimum_common_valid_days > 0),
  return_median_abs_diff_max REAL NOT NULL CHECK (return_median_abs_diff_max >= 0),
  return_p95_abs_diff_max REAL NOT NULL CHECK (return_p95_abs_diff_max >= 0),
  direction_match_ratio_min REAL NOT NULL CHECK (
    direction_match_ratio_min >= 0 AND direction_match_ratio_min <= 1
  ),
  input_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'SUCCEEDED'),
  result_hash TEXT NOT NULL
) STRICT;

CREATE INDEX benchmark_signal_candidate_run_metric_idx
  ON benchmark_signal_candidate_run(
    benchmark_metric_run_id,
    evaluation_version,
    created_at
  );

CREATE TABLE benchmark_signal_candidate_metric (
  benchmark_signal_candidate_run_id TEXT NOT NULL,
  panel_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (
    period_type IN ('FIXED_PANEL_BACKCAST', 'CONTEMPORANEOUS')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('OK', 'ZERO_ACTIVITY', 'BASE_NO_RESULT')
  ),
  valid_count INTEGER NOT NULL CHECK (valid_count >= 0),
  mover_count INTEGER NOT NULL CHECK (mover_count >= 0),
  valid_weight REAL NOT NULL CHECK (valid_weight >= 0),
  mover_weight REAL NOT NULL CHECK (mover_weight >= 0),
  activity_weight_ratio REAL,
  weighted_mean REAL,
  mover_weighted_mean REAL,
  mover_weighted_median REAL,
  mover_winsorized_mean REAL,
  activity_scaled_mover_median REAL,
  activity_scaled_mover_winsorized_mean REAL,
  CHECK (mover_count <= valid_count),
  CHECK (mover_weight <= valid_weight + 0.000001),
  CHECK (
    (status = 'BASE_NO_RESULT'
      AND activity_weight_ratio IS NULL
      AND weighted_mean IS NULL
      AND mover_weighted_mean IS NULL
      AND mover_weighted_median IS NULL
      AND mover_winsorized_mean IS NULL
      AND activity_scaled_mover_median IS NULL
      AND activity_scaled_mover_winsorized_mean IS NULL)
    OR
    (status = 'ZERO_ACTIVITY'
      AND valid_count > 0
      AND mover_count = 0
      AND activity_weight_ratio = 0
      AND weighted_mean = 0
      AND mover_weighted_mean IS NULL
      AND mover_weighted_median IS NULL
      AND mover_winsorized_mean IS NULL
      AND activity_scaled_mover_median = 0
      AND activity_scaled_mover_winsorized_mean = 0)
    OR
    (status = 'OK'
      AND valid_count > 0
      AND mover_count > 0
      AND activity_weight_ratio IS NOT NULL
      AND weighted_mean IS NOT NULL
      AND mover_weighted_mean IS NOT NULL
      AND mover_weighted_median IS NOT NULL
      AND mover_winsorized_mean IS NOT NULL
      AND activity_scaled_mover_median IS NOT NULL
      AND activity_scaled_mover_winsorized_mean IS NOT NULL)
  ),
  CHECK (
    activity_weight_ratio IS NULL
    OR (activity_weight_ratio >= 0 AND activity_weight_ratio <= 1)
  ),
  PRIMARY KEY (
    benchmark_signal_candidate_run_id,
    panel_id,
    metric_date
  )
) STRICT;

CREATE INDEX benchmark_signal_candidate_metric_panel_idx
  ON benchmark_signal_candidate_metric(
    benchmark_signal_candidate_run_id,
    panel_id,
    metric_date
  );

CREATE TABLE benchmark_signal_candidate_pair (
  benchmark_signal_candidate_run_id TEXT NOT NULL,
  candidate_name TEXT NOT NULL CHECK (
    candidate_name IN (
      'WEIGHTED_MEAN',
      'ACTIVITY_SCALED_MOVER_MEDIAN',
      'ACTIVITY_SCALED_MOVER_WINSORIZED_MEAN'
    )
  ),
  smaller_panel_id TEXT NOT NULL,
  larger_panel_id TEXT NOT NULL,
  smaller_panel_size INTEGER NOT NULL CHECK (smaller_panel_size > 0),
  larger_panel_size INTEGER NOT NULL CHECK (larger_panel_size > smaller_panel_size),
  common_valid_days INTEGER NOT NULL CHECK (common_valid_days >= 0),
  direction_compared_days INTEGER NOT NULL CHECK (direction_compared_days >= 0),
  return_median_abs_diff REAL,
  return_p95_abs_diff REAL,
  return_direction_match_ratio REAL,
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'INSUFFICIENT')),
  details_json TEXT NOT NULL,
  CHECK (
    return_median_abs_diff IS NULL
    OR return_median_abs_diff >= 0
  ),
  CHECK (
    return_p95_abs_diff IS NULL
    OR return_p95_abs_diff >= 0
  ),
  CHECK (
    return_direction_match_ratio IS NULL
    OR (return_direction_match_ratio >= 0 AND return_direction_match_ratio <= 1)
  ),
  CHECK (
    status = 'INSUFFICIENT'
    OR (
      return_median_abs_diff IS NOT NULL
      AND return_p95_abs_diff IS NOT NULL
      AND return_direction_match_ratio IS NOT NULL
    )
  ),
  PRIMARY KEY (
    benchmark_signal_candidate_run_id,
    candidate_name,
    smaller_panel_id,
    larger_panel_id
  )
) STRICT;
