ALTER TABLE dataset_snapshot_cohort_membership ADD COLUMN valid_to TEXT;
ALTER TABLE dataset_snapshot_cohort_membership ADD COLUMN membership_source TEXT;
ALTER TABLE dataset_snapshot_cohort_membership ADD COLUMN confidence REAL;

CREATE TABLE dataset_snapshot_usage_history (
  dataset_snapshot_id TEXT NOT NULL,
  usage_point_id TEXT NOT NULL,
  spid TEXT,
  instrument_id TEXT,
  usage_as_of TEXT NOT NULL,
  PRIMARY KEY (dataset_snapshot_id, usage_point_id)
) STRICT;

CREATE INDEX dataset_snapshot_usage_history_time_idx
  ON dataset_snapshot_usage_history(dataset_snapshot_id, usage_as_of);

CREATE TABLE dataset_snapshot_relation_history (
  dataset_snapshot_id TEXT NOT NULL,
  relation_id TEXT NOT NULL,
  relation_as_of TEXT NOT NULL,
  relation_valid_from TEXT NOT NULL,
  relation_valid_to TEXT,
  PRIMARY KEY (dataset_snapshot_id, relation_id, relation_as_of)
) STRICT;

CREATE INDEX dataset_snapshot_relation_history_time_idx
  ON dataset_snapshot_relation_history(dataset_snapshot_id, relation_as_of);

CREATE TABLE event_replay_run (
  analysis_run_id TEXT PRIMARY KEY,
  replay_version TEXT NOT NULL CHECK (length(replay_version) > 0),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  result_hash TEXT NOT NULL
) STRICT;

CREATE TABLE event_replay_anchor (
  analysis_run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  anchor_type TEXT NOT NULL CHECK (
    anchor_type IN ('ANNOUNCED', 'EFFECTIVE', 'FIRST_OBSERVED')
  ),
  anchor_at TEXT NOT NULL,
  anchor_date TEXT NOT NULL,
  details_json TEXT NOT NULL,
  PRIMARY KEY (analysis_run_id, event_id, anchor_type)
) STRICT;

CREATE TABLE event_replay_metric (
  analysis_run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  anchor_type TEXT NOT NULL CHECK (
    anchor_type IN ('ANNOUNCED', 'EFFECTIVE', 'FIRST_OBSERVED')
  ),
  offset_days INTEGER NOT NULL,
  metric_date TEXT NOT NULL,
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
  reason TEXT,
  PRIMARY KEY (
    analysis_run_id,
    event_id,
    anchor_type,
    offset_days,
    scope_id,
    metric_name
  ),
  CHECK (
    (status = 'OK' AND value IS NOT NULL AND reason IS NULL)
    OR (status = 'NO_RESULT' AND value IS NULL AND reason IS NOT NULL)
  )
) STRICT;

CREATE INDEX event_replay_metric_event_idx
  ON event_replay_metric(analysis_run_id, event_id, anchor_type, offset_days);
