CREATE TABLE market_universe_snapshot (
  universe_snapshot_id TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  price_semantics TEXT NOT NULL CHECK (
    price_semantics IN ('MARKET_REFERENCE_PRICE', 'TRADE_PRICE', 'UNKNOWN')
  ),
  price_max_age_days INTEGER NOT NULL CHECK (price_max_age_days > 0),
  catalog_player_count INTEGER NOT NULL CHECK (catalog_player_count >= 0),
  catalog_card_count INTEGER NOT NULL CHECK (catalog_card_count >= 0),
  price_eligible_player_count INTEGER NOT NULL CHECK (price_eligible_player_count >= 0),
  price_eligible_instrument_count INTEGER NOT NULL CHECK (price_eligible_instrument_count >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (as_of, rule_version, source_hash, price_semantics, price_max_age_days)
) STRICT;

CREATE TABLE market_universe_source (
  universe_snapshot_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  source_role TEXT NOT NULL CHECK (source_role IN ('SPID_META', 'SEASON_META')),
  PRIMARY KEY (universe_snapshot_id, source_snapshot_id, source_role)
) STRICT;

CREATE TABLE market_universe_member (
  universe_snapshot_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  catalog_card_count INTEGER NOT NULL CHECK (catalog_card_count > 0),
  observed_instrument_count INTEGER NOT NULL CHECK (observed_instrument_count >= 0),
  eligible_instrument_count INTEGER NOT NULL CHECK (eligible_instrument_count >= 0),
  price_eligible INTEGER NOT NULL CHECK (price_eligible IN (0, 1)),
  anchor_instrument_id TEXT,
  anchor_price INTEGER,
  anchor_source_timestamp TEXT,
  anchor_history_count INTEGER,
  CHECK (
    (price_eligible = 0
      AND eligible_instrument_count = 0
      AND anchor_instrument_id IS NULL
      AND anchor_price IS NULL
      AND anchor_source_timestamp IS NULL
      AND anchor_history_count IS NULL)
    OR
    (price_eligible = 1
      AND eligible_instrument_count > 0
      AND anchor_instrument_id IS NOT NULL
      AND anchor_price IS NOT NULL
      AND anchor_price > 0
      AND anchor_source_timestamp IS NOT NULL
      AND anchor_history_count IS NOT NULL
      AND anchor_history_count > 0)
  ),
  PRIMARY KEY (universe_snapshot_id, player_id)
) STRICT;

CREATE INDEX market_universe_member_eligible_idx
  ON market_universe_member(universe_snapshot_id, price_eligible, player_id);

CREATE TABLE market_universe_card (
  universe_snapshot_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  spid TEXT NOT NULL,
  player_name TEXT NOT NULL,
  season_id INTEGER NOT NULL,
  season_name TEXT NOT NULL,
  PRIMARY KEY (universe_snapshot_id, spid)
) STRICT;

CREATE INDEX market_universe_card_player_idx
  ON market_universe_card(universe_snapshot_id, player_id, spid);

CREATE TABLE market_universe_instrument (
  universe_snapshot_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  spid TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 13),
  latest_price INTEGER,
  latest_source_timestamp TEXT,
  latest_observed_at TEXT,
  latest_price_semantics TEXT,
  latest_quality_status TEXT,
  valid_history_count INTEGER NOT NULL CHECK (valid_history_count >= 0),
  price_eligible INTEGER NOT NULL CHECK (price_eligible IN (0, 1)),
  CHECK (latest_price IS NULL OR latest_price > 0),
  CHECK (
    price_eligible = 0
    OR (
      latest_price IS NOT NULL
      AND latest_source_timestamp IS NOT NULL
      AND latest_observed_at IS NOT NULL
      AND valid_history_count > 0
    )
  ),
  PRIMARY KEY (universe_snapshot_id, instrument_id)
) STRICT;

CREATE INDEX market_universe_instrument_player_idx
  ON market_universe_instrument(universe_snapshot_id, player_id, price_eligible, instrument_id);
