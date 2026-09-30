CREATE TABLE metadata_snapshot (
  metadata_snapshot_id TEXT PRIMARY KEY,
  spid TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  player_name TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  season_name TEXT NOT NULL,
  salary INTEGER,
  positions_json TEXT,
  ovr INTEGER,
  stats_json TEXT,
  traits_json TEXT,
  clubs_json TEXT,
  nations_json TEXT,
  team_colors_json TEXT,
  completeness TEXT NOT NULL CHECK (completeness IN ('IDENTITY_ONLY', 'FULL')),
  CHECK (salary IS NULL OR salary >= 0),
  CHECK (ovr IS NULL OR ovr > 0)
) STRICT;

CREATE INDEX metadata_snapshot_spid_observed_idx
  ON metadata_snapshot(spid, observed_at);

CREATE TABLE metadata_snapshot_source (
  metadata_snapshot_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  source_role TEXT NOT NULL CHECK (
    source_role IN ('SPID_META', 'SEASON_META', 'DETAIL')
  ),
  PRIMARY KEY (metadata_snapshot_id, source_snapshot_id, source_role)
) STRICT;

CREATE TABLE usage_point (
  usage_point_id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (
    subject_type IN ('PLAYER_CARD', 'INSTRUMENT')
  ),
  spid TEXT,
  instrument_id TEXT,
  as_of TEXT NOT NULL,
  source_data_date TEXT,
  observation_type TEXT NOT NULL CHECK (
    observation_type IN (
      'DAILY_CHART_CLASS_USAGE',
      'DAILY_CHART_POSITION_USAGE',
      'OPEN_API_RANKER_STATS'
    )
  ),
  appearances INTEGER CHECK (appearances IS NULL OR appearances >= 0),
  usage_share REAL CHECK (
    usage_share IS NULL OR (usage_share >= 0 AND usage_share <= 1)
  ),
  position_code INTEGER,
  performance_metrics_json TEXT,
  source_snapshot_id TEXT NOT NULL,
  CHECK (
    (subject_type = 'PLAYER_CARD' AND spid IS NOT NULL AND instrument_id IS NULL)
    OR
    (subject_type = 'INSTRUMENT' AND spid IS NULL AND instrument_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX usage_point_card_time_idx
  ON usage_point(spid, as_of)
  WHERE subject_type = 'PLAYER_CARD';
CREATE INDEX usage_point_instrument_time_idx
  ON usage_point(instrument_id, as_of)
  WHERE subject_type = 'INSTRUMENT';
