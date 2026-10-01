CREATE TABLE event (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'MAINTENANCE_NOTICE',
      'MAINTENANCE',
      'UPDATE_NOTICE',
      'GAMEPLAY_PATCH',
      'TRAIT_CHANGE',
      'NEW_CLASS',
      'EVENT_START',
      'EVENT_END',
      'BURNING',
      'PAID_PRODUCT_START',
      'PAID_PRODUCT_END',
      'MEMBERSHIP_RESET',
      'BP_SUPPLY',
      'PLAYER_SUPPLY',
      'FEE_CHANGE',
      'MARKET_RULE_CHANGE',
      'INCIDENT',
      'COMPENSATION',
      'UNKNOWN_SHOCK'
    )
  ),
  title TEXT NOT NULL,
  announced_at TEXT,
  effective_at TEXT,
  ended_at TEXT,
  first_observed_at TEXT,
  source_snapshot_id TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  notes TEXT,
  CHECK (
    announced_at IS NOT NULL
    OR effective_at IS NOT NULL
    OR first_observed_at IS NOT NULL
  )
) STRICT;

CREATE INDEX event_time_idx
  ON event(COALESCE(effective_at, announced_at, first_observed_at));
CREATE INDEX event_type_idx ON event(event_type);

CREATE TABLE product (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sale_start TEXT NOT NULL,
  sale_end TEXT,
  price INTEGER NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL CHECK (length(currency) > 0),
  purchase_limit INTEGER CHECK (purchase_limit IS NULL OR purchase_limit > 0),
  channel TEXT NOT NULL CHECK (length(channel) > 0),
  source_snapshot_id TEXT NOT NULL,
  notes TEXT
) STRICT;

CREATE INDEX product_sale_time_idx ON product(sale_start, sale_end);

CREATE TABLE reward (
  reward_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  reward_type TEXT NOT NULL CHECK (
    reward_type IN (
      'BP',
      'FC',
      'MC',
      'PLAYER_PACK',
      'CHOICE_PACK',
      'EXCHANGE_TOKEN',
      'OTHER_ITEM'
    )
  ),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  probability REAL CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
  class_filter_json TEXT,
  grade_min INTEGER CHECK (grade_min IS NULL OR grade_min BETWEEN 1 AND 13),
  grade_max INTEGER CHECK (grade_max IS NULL OR grade_max BETWEEN 1 AND 13),
  ovr_min INTEGER CHECK (ovr_min IS NULL OR ovr_min > 0),
  top_price_n INTEGER CHECK (top_price_n IS NULL OR top_price_n > 0),
  CHECK (grade_min IS NULL OR grade_max IS NULL OR grade_min <= grade_max)
) STRICT;

CREATE INDEX reward_product_idx ON reward(product_id);

CREATE TABLE exposure (
  exposure_id TEXT PRIMARY KEY,
  event_id TEXT,
  product_id TEXT,
  instrument_id TEXT NOT NULL,
  exposure_type TEXT NOT NULL CHECK (exposure_type IN ('DIRECT', 'INDIRECT')),
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  source TEXT NOT NULL CHECK (length(source) > 0),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  CHECK (event_id IS NOT NULL OR product_id IS NOT NULL)
) STRICT;

CREATE INDEX exposure_instrument_time_idx
  ON exposure(instrument_id, valid_from, valid_to);
CREATE INDEX exposure_event_idx ON exposure(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX exposure_product_idx ON exposure(product_id) WHERE product_id IS NOT NULL;
