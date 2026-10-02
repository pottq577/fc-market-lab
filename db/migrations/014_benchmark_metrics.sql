CREATE TABLE benchmark_metric_run (
  benchmark_metric_run_id TEXT PRIMARY KEY,
  panel_family_id TEXT NOT NULL,
  metric_version TEXT NOT NULL CHECK (length(metric_version) > 0),
  analysis_cutoff TEXT NOT NULL,
  timezone TEXT NOT NULL CHECK (length(timezone) > 0),
  price_semantics TEXT NOT NULL CHECK (
    price_semantics IN ('MARKET_REFERENCE_PRICE', 'TRADE_PRICE', 'UNKNOWN')
  ),
  minimum_weighted_coverage REAL NOT NULL CHECK (
    minimum_weighted_coverage > 0 AND minimum_weighted_coverage <= 1
  ),
  input_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED')),
  result_hash TEXT NOT NULL,
  UNIQUE (
    panel_family_id,
    metric_version,
    analysis_cutoff,
    timezone,
    price_semantics,
    minimum_weighted_coverage,
    input_hash
  )
) STRICT;

CREATE INDEX benchmark_metric_run_family_idx
  ON benchmark_metric_run(panel_family_id, analysis_cutoff, metric_version);

CREATE TABLE benchmark_metric_input_price (
  benchmark_metric_run_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  value INTEGER,
  price_semantics TEXT NOT NULL CHECK (
    price_semantics IN ('MARKET_REFERENCE_PRICE', 'TRADE_PRICE', 'UNKNOWN')
  ),
  quality_status TEXT NOT NULL CHECK (
    quality_status IN (
      'VALID', 'MISSING', 'FETCH_FAILED', 'STALE_SOURCE', 'INVALID', 'UNCHANGED_RUN'
    )
  ),
  CHECK (
    (quality_status IN ('VALID', 'UNCHANGED_RUN') AND value IS NOT NULL AND value > 0)
    OR
    (quality_status IN ('MISSING', 'FETCH_FAILED', 'STALE_SOURCE', 'INVALID') AND value IS NULL)
  ),
  PRIMARY KEY (
    benchmark_metric_run_id,
    instrument_id,
    source_timestamp
  )
) STRICT;

CREATE INDEX benchmark_metric_input_price_instrument_idx
  ON benchmark_metric_input_price(
    benchmark_metric_run_id,
    instrument_id,
    source_timestamp
  );

CREATE TABLE benchmark_metric (
  benchmark_metric_run_id TEXT NOT NULL,
  panel_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (
    period_type IN ('FIXED_PANEL_BACKCAST', 'CONTEMPORANEOUS')
  ),
  metric_name TEXT NOT NULL CHECK (
    metric_name IN ('RETURN_1D', 'INDEX', 'BREADTH', 'IQR', 'MAD')
  ),
  value REAL,
  status TEXT NOT NULL CHECK (status IN ('OK', 'NO_RESULT')),
  valid_count INTEGER NOT NULL CHECK (valid_count >= 0),
  total_count INTEGER NOT NULL CHECK (total_count > 0),
  valid_weight REAL NOT NULL CHECK (valid_weight >= 0),
  total_weight REAL NOT NULL CHECK (total_weight > 0),
  weighted_coverage REAL NOT NULL CHECK (
    weighted_coverage >= 0 AND weighted_coverage <= 1
  ),
  details_json TEXT NOT NULL,
  CHECK (valid_count <= total_count),
  CHECK (valid_weight <= total_weight + 0.000001),
  CHECK (
    (status = 'OK' AND value IS NOT NULL)
    OR
    (status = 'NO_RESULT' AND value IS NULL)
  ),
  PRIMARY KEY (
    benchmark_metric_run_id,
    panel_id,
    metric_date,
    metric_name
  )
) STRICT;

CREATE INDEX benchmark_metric_panel_date_idx
  ON benchmark_metric(
    benchmark_metric_run_id,
    panel_id,
    metric_date,
    metric_name
  );
CREATE INDEX benchmark_metric_name_date_idx
  ON benchmark_metric(
    benchmark_metric_run_id,
    metric_name,
    metric_date
  );
