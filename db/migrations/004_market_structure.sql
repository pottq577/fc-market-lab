CREATE TABLE card_relation (
  relation_id TEXT PRIMARY KEY,
  source_instrument TEXT NOT NULL,
  target_instrument TEXT NOT NULL,
  same_player INTEGER NOT NULL CHECK (same_player IN (0, 1)),
  same_position INTEGER NOT NULL CHECK (same_position IN (0, 1)),
  relation_source TEXT NOT NULL CHECK (length(relation_source) > 0),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  CHECK (source_instrument < target_instrument),
  CHECK (same_player = 1 OR same_position = 1),
  CHECK (valid_to IS NULL OR valid_from < valid_to)
) STRICT;

CREATE INDEX card_relation_source_time_idx
  ON card_relation(source_instrument, valid_from, valid_to);
CREATE INDEX card_relation_target_time_idx
  ON card_relation(target_instrument, valid_from, valid_to);

CREATE TABLE relation_snapshot (
  relation_id TEXT NOT NULL,
  as_of TEXT NOT NULL,
  shared_team_colors_json TEXT NOT NULL,
  salary_diff INTEGER,
  ovr_diff INTEGER,
  stat_distance REAL,
  price_ratio REAL CHECK (price_ratio IS NULL OR price_ratio > 0),
  usage_distance REAL CHECK (usage_distance IS NULL OR usage_distance >= 0),
  movement_similarity REAL CHECK (
    movement_similarity IS NULL
    OR (movement_similarity >= -1 AND movement_similarity <= 1)
  ),
  definition_version TEXT NOT NULL CHECK (length(definition_version) > 0),
  PRIMARY KEY (relation_id, as_of)
) STRICT;

CREATE INDEX relation_snapshot_as_of_idx ON relation_snapshot(as_of);

CREATE TABLE cohort_definition (
  cohort_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aggregation_level TEXT NOT NULL CHECK (
    aggregation_level IN ('PLAYER', 'INSTRUMENT')
  ),
  rule_version TEXT NOT NULL,
  rule_params_json TEXT NOT NULL
) STRICT;

CREATE TABLE cohort_membership (
  cohort_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  membership_source TEXT NOT NULL CHECK (length(membership_source) > 0),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  CHECK (valid_to IS NULL OR valid_from < valid_to),
  PRIMARY KEY (cohort_id, instrument_id, valid_from)
) STRICT;

CREATE INDEX cohort_membership_time_idx
  ON cohort_membership(cohort_id, valid_from, valid_to);
CREATE INDEX cohort_membership_instrument_idx
  ON cohort_membership(instrument_id, valid_from, valid_to);
