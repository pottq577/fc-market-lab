CREATE TABLE benchmark_discovery_frame (
  discovery_frame_id TEXT PRIMARY KEY,
  universe_snapshot_id TEXT NOT NULL,
  frame_version TEXT NOT NULL,
  sample_seed TEXT NOT NULL,
  target_size INTEGER NOT NULL CHECK (target_size > 0),
  population_count INTEGER NOT NULL CHECK (population_count > 0),
  probe_grade INTEGER NOT NULL CHECK (probe_grade BETWEEN 1 AND 13),
  inclusion_probability REAL NOT NULL CHECK (
    inclusion_probability > 0 AND inclusion_probability <= 1
  ),
  population_weight REAL NOT NULL CHECK (population_weight >= 1),
  created_at TEXT NOT NULL,
  UNIQUE (
    universe_snapshot_id,
    frame_version,
    sample_seed,
    target_size,
    probe_grade
  )
) STRICT;

CREATE TABLE benchmark_discovery_member (
  discovery_frame_id TEXT NOT NULL,
  sample_rank INTEGER NOT NULL CHECK (sample_rank > 0),
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  probe_spid TEXT NOT NULL,
  probe_season_id INTEGER NOT NULL,
  probe_season_name TEXT NOT NULL,
  probe_grade INTEGER NOT NULL CHECK (probe_grade BETWEEN 1 AND 13),
  selection_hash TEXT NOT NULL,
  card_selection_hash TEXT NOT NULL,
  inclusion_probability REAL NOT NULL CHECK (
    inclusion_probability > 0 AND inclusion_probability <= 1
  ),
  population_weight REAL NOT NULL CHECK (population_weight >= 1),
  PRIMARY KEY (discovery_frame_id, player_id),
  UNIQUE (discovery_frame_id, sample_rank)
) STRICT;

CREATE INDEX benchmark_discovery_member_rank_idx
  ON benchmark_discovery_member(discovery_frame_id, sample_rank);
