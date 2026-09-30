CREATE TABLE player (
  player_id TEXT PRIMARY KEY,
  name TEXT NOT NULL
) STRICT;

CREATE TABLE player_card (
  spid TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  season TEXT NOT NULL
) STRICT;

CREATE INDEX player_card_player_id_idx ON player_card(player_id);

CREATE TABLE instrument (
  instrument_id TEXT PRIMARY KEY,
  spid TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 13),
  UNIQUE (spid, grade)
) STRICT;

CREATE TABLE source_snapshot (
  source_snapshot_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  raw_payload BLOB NOT NULL,
  raw_hash TEXT NOT NULL,
  capture_method TEXT NOT NULL,
  collector_version TEXT NOT NULL,
  policy_evidence_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('PARSED', 'FAILED')),
  parse_error TEXT
) STRICT;

CREATE INDEX source_snapshot_ref_observed_idx
  ON source_snapshot(source_ref, observed_at);
CREATE INDEX source_snapshot_raw_hash_idx ON source_snapshot(raw_hash);

CREATE TABLE price_point (
  source_snapshot_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  source_timestamp TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  value INTEGER,
  currency TEXT NOT NULL CHECK (currency = 'BP'),
  price_semantics TEXT NOT NULL CHECK (
    price_semantics IN ('MARKET_REFERENCE_PRICE', 'TRADE_PRICE', 'UNKNOWN')
  ),
  quality_status TEXT NOT NULL CHECK (
    quality_status IN ('VALID', 'MISSING', 'FETCH_FAILED', 'STALE_SOURCE', 'INVALID', 'UNCHANGED_RUN')
  ),
  CHECK (
    (quality_status IN ('VALID', 'UNCHANGED_RUN') AND value IS NOT NULL AND value > 0)
    OR
    (quality_status IN ('MISSING', 'FETCH_FAILED', 'STALE_SOURCE', 'INVALID') AND value IS NULL)
  ),
  PRIMARY KEY (source_snapshot_id, source_timestamp)
) STRICT;

CREATE INDEX price_point_instrument_time_idx
  ON price_point(instrument_id, source_timestamp);
