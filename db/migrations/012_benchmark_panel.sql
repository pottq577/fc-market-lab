CREATE TABLE benchmark_panel_family (
  panel_family_id TEXT PRIMARY KEY,
  discovery_frame_id TEXT NOT NULL,
  universe_snapshot_id TEXT NOT NULL,
  panel_version TEXT NOT NULL,
  sample_seed TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  discovery_target_count INTEGER NOT NULL CHECK (discovery_target_count > 0),
  discovery_observed_count INTEGER NOT NULL CHECK (discovery_observed_count > 0),
  discovery_response_coverage REAL NOT NULL CHECK (
    discovery_response_coverage >= 0 AND discovery_response_coverage <= 1
  ),
  eligible_responder_count INTEGER NOT NULL CHECK (eligible_responder_count > 0),
  usage_observed_count INTEGER NOT NULL CHECK (usage_observed_count >= 0),
  usage_p33 REAL,
  usage_p67 REAL,
  price_p50 INTEGER NOT NULL CHECK (price_p50 > 0),
  price_p80 INTEGER NOT NULL CHECK (price_p80 > 0),
  price_p95 INTEGER NOT NULL CHECK (price_p95 > 0),
  stage1_inclusion_probability REAL NOT NULL CHECK (
    stage1_inclusion_probability > 0 AND stage1_inclusion_probability <= 1
  ),
  stage1_population_weight REAL NOT NULL CHECK (stage1_population_weight >= 1),
  panel_sizes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (
    discovery_frame_id,
    universe_snapshot_id,
    panel_version,
    sample_seed,
    effective_from,
    panel_sizes_json
  )
) STRICT;

CREATE TABLE benchmark_panel (
  panel_id TEXT PRIMARY KEY,
  panel_family_id TEXT NOT NULL,
  panel_label TEXT NOT NULL,
  panel_size INTEGER NOT NULL CHECK (panel_size > 0),
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (panel_family_id, panel_size),
  UNIQUE (panel_family_id, panel_label)
) STRICT;

CREATE TABLE benchmark_panel_stratum (
  panel_id TEXT NOT NULL,
  stratum_id TEXT NOT NULL,
  usage_band TEXT NOT NULL CHECK (
    usage_band IN ('HIGH_OBSERVED', 'MID_OBSERVED', 'LOW_OBSERVED', 'UNOBSERVED')
  ),
  price_band TEXT NOT NULL CHECK (
    price_band IN ('P00_50', 'P50_80', 'P80_95', 'P95_100')
  ),
  discovery_responder_count INTEGER NOT NULL CHECK (discovery_responder_count > 0),
  sampled_count INTEGER NOT NULL CHECK (sampled_count > 0),
  stage2_inclusion_probability REAL NOT NULL CHECK (
    stage2_inclusion_probability > 0 AND stage2_inclusion_probability <= 1
  ),
  combined_inclusion_probability REAL NOT NULL CHECK (
    combined_inclusion_probability > 0 AND combined_inclusion_probability <= 1
  ),
  population_weight REAL NOT NULL CHECK (population_weight >= 1),
  PRIMARY KEY (panel_id, stratum_id)
) STRICT;

CREATE TABLE benchmark_panel_member (
  panel_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  discovery_sample_rank INTEGER NOT NULL CHECK (discovery_sample_rank > 0),
  stratum_id TEXT NOT NULL,
  usage_band TEXT NOT NULL CHECK (
    usage_band IN ('HIGH_OBSERVED', 'MID_OBSERVED', 'LOW_OBSERVED', 'UNOBSERVED')
  ),
  price_band TEXT NOT NULL CHECK (
    price_band IN ('P00_50', 'P50_80', 'P80_95', 'P95_100')
  ),
  anchor_instrument_id TEXT NOT NULL,
  anchor_spid TEXT NOT NULL,
  anchor_grade INTEGER NOT NULL CHECK (anchor_grade BETWEEN 1 AND 13),
  anchor_price INTEGER NOT NULL CHECK (anchor_price > 0),
  anchor_source_timestamp TEXT NOT NULL,
  anchor_history_count INTEGER NOT NULL CHECK (anchor_history_count > 0),
  usage_value REAL,
  stratum_rank INTEGER NOT NULL CHECK (stratum_rank > 0),
  admission_rank INTEGER NOT NULL CHECK (admission_rank > 0),
  selection_hash TEXT NOT NULL,
  stage1_inclusion_probability REAL NOT NULL CHECK (
    stage1_inclusion_probability > 0 AND stage1_inclusion_probability <= 1
  ),
  stage2_inclusion_probability REAL NOT NULL CHECK (
    stage2_inclusion_probability > 0 AND stage2_inclusion_probability <= 1
  ),
  combined_inclusion_probability REAL NOT NULL CHECK (
    combined_inclusion_probability > 0 AND combined_inclusion_probability <= 1
  ),
  population_weight REAL NOT NULL CHECK (population_weight >= 1),
  PRIMARY KEY (panel_id, player_id),
  UNIQUE (panel_id, admission_rank)
) STRICT;

CREATE INDEX benchmark_panel_member_stratum_idx
  ON benchmark_panel_member(panel_id, stratum_id, stratum_rank);
CREATE INDEX benchmark_panel_member_anchor_idx
  ON benchmark_panel_member(panel_id, anchor_instrument_id);
