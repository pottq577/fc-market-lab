ALTER TABLE benchmark_panel_family
  ADD COLUMN stratification_basis TEXT NOT NULL DEFAULT 'USAGE_PRICE'
  CHECK (stratification_basis IN ('USAGE_PRICE', 'PRICE_ONLY'));

ALTER TABLE benchmark_panel_family
  ADD COLUMN usage_observation_coverage REAL NOT NULL DEFAULT 0
  CHECK (usage_observation_coverage >= 0 AND usage_observation_coverage <= 1);

ALTER TABLE benchmark_panel_family
  ADD COLUMN price_band_counts_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE benchmark_panel_stratum RENAME TO benchmark_panel_stratum_v1;

CREATE TABLE benchmark_panel_stratum (
  panel_id TEXT NOT NULL,
  stratum_id TEXT NOT NULL,
  usage_band TEXT CHECK (
    usage_band IS NULL OR
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

INSERT INTO benchmark_panel_stratum(
  panel_id, stratum_id, usage_band, price_band,
  discovery_responder_count, sampled_count,
  stage2_inclusion_probability, combined_inclusion_probability,
  population_weight
)
SELECT
  panel_id, stratum_id, usage_band, price_band,
  discovery_responder_count, sampled_count,
  stage2_inclusion_probability, combined_inclusion_probability,
  population_weight
FROM benchmark_panel_stratum_v1;

DROP TABLE benchmark_panel_stratum_v1;

