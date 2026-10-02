CREATE TABLE benchmark_convergence_run (
  benchmark_convergence_run_id TEXT PRIMARY KEY,
  benchmark_uncertainty_run_id TEXT NOT NULL,
  benchmark_metric_run_id TEXT NOT NULL,
  panel_family_id TEXT NOT NULL,
  convergence_version TEXT NOT NULL CHECK (length(convergence_version) > 0),
  minimum_common_valid_days INTEGER NOT NULL CHECK (minimum_common_valid_days > 0),
  return_median_abs_diff_max REAL NOT NULL CHECK (return_median_abs_diff_max >= 0),
  return_p95_abs_diff_max REAL NOT NULL CHECK (return_p95_abs_diff_max >= 0),
  direction_match_ratio_min REAL NOT NULL CHECK (
    direction_match_ratio_min >= 0 AND direction_match_ratio_min <= 1
  ),
  breadth_median_abs_diff_max REAL NOT NULL CHECK (breadth_median_abs_diff_max >= 0),
  input_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'SUCCEEDED'),
  benchmark_status TEXT NOT NULL CHECK (benchmark_status IN ('STABLE', 'UNSTABLE')),
  selected_panel_id TEXT,
  result_hash TEXT NOT NULL,
  CHECK (
    (benchmark_status = 'STABLE' AND selected_panel_id IS NOT NULL)
    OR
    (benchmark_status = 'UNSTABLE' AND selected_panel_id IS NULL)
  )
) STRICT;

CREATE INDEX benchmark_convergence_run_family_idx
  ON benchmark_convergence_run(
    panel_family_id,
    convergence_version,
    created_at
  );

CREATE TABLE panel_convergence (
  benchmark_convergence_run_id TEXT NOT NULL,
  smaller_panel_id TEXT NOT NULL,
  larger_panel_id TEXT NOT NULL,
  smaller_panel_size INTEGER NOT NULL CHECK (smaller_panel_size > 0),
  larger_panel_size INTEGER NOT NULL CHECK (larger_panel_size > smaller_panel_size),
  common_valid_return_days INTEGER NOT NULL CHECK (common_valid_return_days >= 0),
  common_valid_breadth_days INTEGER NOT NULL CHECK (common_valid_breadth_days >= 0),
  direction_compared_days INTEGER NOT NULL CHECK (direction_compared_days >= 0),
  return_median_abs_diff REAL CHECK (return_median_abs_diff IS NULL OR return_median_abs_diff >= 0),
  return_p95_abs_diff REAL CHECK (return_p95_abs_diff IS NULL OR return_p95_abs_diff >= 0),
  return_direction_match_ratio REAL CHECK (
    return_direction_match_ratio IS NULL
    OR (return_direction_match_ratio >= 0 AND return_direction_match_ratio <= 1)
  ),
  breadth_median_abs_diff REAL CHECK (
    breadth_median_abs_diff IS NULL OR breadth_median_abs_diff >= 0
  ),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL', 'INSUFFICIENT')),
  details_json TEXT NOT NULL,
  CHECK (
    status = 'INSUFFICIENT'
    OR (
      return_median_abs_diff IS NOT NULL
      AND return_p95_abs_diff IS NOT NULL
      AND return_direction_match_ratio IS NOT NULL
      AND breadth_median_abs_diff IS NOT NULL
    )
  ),
  PRIMARY KEY (
    benchmark_convergence_run_id,
    smaller_panel_id,
    larger_panel_id
  )
) STRICT;

CREATE INDEX panel_convergence_pair_idx
  ON panel_convergence(
    benchmark_convergence_run_id,
    smaller_panel_size,
    larger_panel_size
  );
