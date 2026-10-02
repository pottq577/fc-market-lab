CREATE TABLE benchmark_discovery_outcome (
  discovery_frame_id TEXT NOT NULL,
  sample_rank INTEGER NOT NULL CHECK (sample_rank > 0),
  player_id TEXT NOT NULL,
  spid TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 13),
  outcome TEXT NOT NULL CHECK (
    outcome IN ('OBSERVED', 'NO_USABLE_PRICE', 'FETCH_FAILED')
  ),
  batch_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  error_message TEXT,
  PRIMARY KEY (discovery_frame_id, sample_rank),
  UNIQUE (discovery_frame_id, player_id),
  CHECK (
    (outcome = 'OBSERVED' AND error_message IS NULL)
    OR
    (outcome IN ('NO_USABLE_PRICE', 'FETCH_FAILED') AND error_message IS NOT NULL)
  )
) STRICT;

CREATE INDEX benchmark_discovery_outcome_status_idx
  ON benchmark_discovery_outcome(discovery_frame_id, outcome, sample_rank);
