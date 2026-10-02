import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { BENCHMARK_PANEL_VERSION } from "../src/benchmark/panel.ts";

test("price-only panel migration preserves v1 rows and enables v2 strata", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(readFileSync("db/migrations/012_benchmark_panel.sql", "utf8"));
    db.prepare(
      `INSERT INTO benchmark_panel_family(
        panel_family_id, discovery_frame_id, universe_snapshot_id,
        panel_version, sample_seed, effective_from,
        discovery_target_count, discovery_observed_count,
        discovery_response_coverage, eligible_responder_count,
        usage_observed_count, usage_p33, usage_p67,
        price_p50, price_p80, price_p95,
        stage1_inclusion_probability, stage1_population_weight,
        panel_sizes_json, created_at
      ) VALUES (
        'family-v1', 'frame-1', 'universe-1',
        'market-benchmark-panel-v1', 'seed', '2026-10-02T00:00:00.000Z',
        10, 10, 1, 10,
        0, NULL, NULL,
        1000, 2000, 3000,
        0.1, 10,
        '[4]', '2026-10-02T00:00:00.000Z'
      )`,
    ).run();
    db.prepare(
      `INSERT INTO benchmark_panel(
        panel_id, panel_family_id, panel_label, panel_size,
        effective_from, created_at
      ) VALUES (
        'panel-v1', 'family-v1', 'P4', 4,
        '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z'
      )`,
    ).run();
    db.prepare(
      `INSERT INTO benchmark_panel_stratum(
        panel_id, stratum_id, usage_band, price_band,
        discovery_responder_count, sampled_count,
        stage2_inclusion_probability, combined_inclusion_probability,
        population_weight
      ) VALUES (
        'panel-v1', 'UNOBSERVED:P00_50', 'UNOBSERVED', 'P00_50',
        10, 4, 0.4, 0.04, 25
      )`,
    ).run();

    db.exec(readFileSync("db/migrations/013_benchmark_price_strata.sql", "utf8"));

    const family = db.prepare(
      `SELECT stratification_basis, usage_observation_coverage,
              price_band_counts_json
       FROM benchmark_panel_family
       WHERE panel_family_id = 'family-v1'`,
    ).get() as Record<string, unknown>;
    assert.equal(family.stratification_basis, "USAGE_PRICE");
    assert.equal(family.usage_observation_coverage, 0);
    assert.equal(family.price_band_counts_json, "{}");

    const preserved = db.prepare(
      `SELECT usage_band, price_band FROM benchmark_panel_stratum
       WHERE panel_id = 'panel-v1'`,
    ).get() as { usage_band: string | null; price_band: string };
    assert.deepEqual({ ...preserved }, {
      usage_band: "UNOBSERVED",
      price_band: "P00_50",
    });

    db.prepare(
      `INSERT INTO benchmark_panel_stratum(
        panel_id, stratum_id, usage_band, price_band,
        discovery_responder_count, sampled_count,
        stage2_inclusion_probability, combined_inclusion_probability,
        population_weight
      ) VALUES (
        'panel-v1', 'P95_100', NULL, 'P95_100',
        1, 1, 1, 0.1, 10
      )`,
    ).run();
    const priceOnly = db.prepare(
      `SELECT usage_band, price_band
       FROM benchmark_panel_stratum
       WHERE panel_id = 'panel-v1' AND stratum_id = 'P95_100'`,
    ).get() as { usage_band: string | null; price_band: string };
    assert.deepEqual({ ...priceOnly }, {
      usage_band: null,
      price_band: "P95_100",
    });
    assert.equal(BENCHMARK_PANEL_VERSION, "market-benchmark-panel-v2");
  } finally {
    db.close();
  }
});
