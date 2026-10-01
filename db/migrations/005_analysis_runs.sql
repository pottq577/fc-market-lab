CREATE TABLE dataset_snapshot (
  dataset_snapshot_id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL,
  analysis_cutoff TEXT NOT NULL,
  created_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  catalog_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL UNIQUE
) STRICT;

CREATE INDEX dataset_snapshot_cutoff_idx
  ON dataset_snapshot(analysis_cutoff);

CREATE TABLE dataset_snapshot_source (
  dataset_snapshot_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  source_role TEXT NOT NULL CHECK (length(source_role) > 0),
  PRIMARY KEY (dataset_snapshot_id, source_snapshot_id, source_role)
) STRICT;

CREATE TABLE dataset_snapshot_price_point (
  dataset_snapshot_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  PRIMARY KEY (
    dataset_snapshot_id,
    source_snapshot_id,
    instrument_id,
    source_timestamp
  )
) STRICT;

CREATE INDEX dataset_snapshot_price_instrument_idx
  ON dataset_snapshot_price_point(dataset_snapshot_id, instrument_id, source_timestamp);

CREATE TABLE dataset_snapshot_metadata (
  dataset_snapshot_id TEXT NOT NULL,
  metadata_snapshot_id TEXT NOT NULL,
  spid TEXT NOT NULL,
  PRIMARY KEY (dataset_snapshot_id, metadata_snapshot_id)
) STRICT;

CREATE TABLE dataset_snapshot_usage (
  dataset_snapshot_id TEXT NOT NULL,
  usage_point_id TEXT NOT NULL,
  spid TEXT,
  instrument_id TEXT,
  PRIMARY KEY (dataset_snapshot_id, usage_point_id)
) STRICT;

CREATE TABLE dataset_snapshot_relation (
  dataset_snapshot_id TEXT NOT NULL,
  relation_id TEXT NOT NULL,
  relation_as_of TEXT NOT NULL,
  PRIMARY KEY (dataset_snapshot_id, relation_id)
) STRICT;

CREATE TABLE dataset_snapshot_cohort_membership (
  dataset_snapshot_id TEXT NOT NULL,
  cohort_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  PRIMARY KEY (dataset_snapshot_id, cohort_id, instrument_id, valid_from)
) STRICT;

CREATE TABLE dataset_snapshot_event (
  dataset_snapshot_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (dataset_snapshot_id, event_id)
) STRICT;

CREATE TABLE dataset_snapshot_product (
  dataset_snapshot_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  PRIMARY KEY (dataset_snapshot_id, product_id)
) STRICT;

CREATE TABLE dataset_snapshot_reward (
  dataset_snapshot_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  PRIMARY KEY (dataset_snapshot_id, reward_id)
) STRICT;

CREATE TABLE dataset_snapshot_exposure (
  dataset_snapshot_id TEXT NOT NULL,
  exposure_id TEXT NOT NULL,
  PRIMARY KEY (dataset_snapshot_id, exposure_id)
) STRICT;

CREATE TABLE analysis_run (
  analysis_run_id TEXT PRIMARY KEY,
  dataset_snapshot_id TEXT NOT NULL,
  analysis_version TEXT NOT NULL CHECK (length(analysis_version) > 0),
  parameters_json TEXT NOT NULL,
  parameter_hash TEXT NOT NULL,
  code_commit TEXT NOT NULL CHECK (length(code_commit) > 0),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  result_hash TEXT,
  UNIQUE (dataset_snapshot_id, analysis_version, parameter_hash, code_commit)
) STRICT;

CREATE INDEX analysis_run_snapshot_idx ON analysis_run(dataset_snapshot_id);
