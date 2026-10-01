import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createDatasetSnapshot } from "../src/analysis/run-context.ts";
import { MARKET_SCHEMA_VERSION, openMarketDatabase } from "../src/db/market-db.ts";

function source(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO source_snapshot(
      source_snapshot_id, source_id, source_type, source_url,
      source_timestamp, observed_at, raw_payload, raw_hash,
      capture_method, collector_version, policy_evidence_id,
      source_ref, parse_status, parse_error
    ) VALUES (?, ?, 'TEST', 'https://example.com', '2026-09-30T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z', X'00', ?, 'TEST', 'test-v1', 'test', ?, 'PARSED', NULL)`,
  ).run(id, id, `sha256:${id}`, id);
}

function price(db: DatabaseSync, instrumentId: string, sourceId: string, value: number): void {
  source(db, sourceId);
  db.prepare(
    `INSERT INTO price_point(
      source_snapshot_id, instrument_id, source_timestamp, observed_at,
      value, currency, price_semantics, quality_status
    ) VALUES (?, ?, '2026-09-30T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
      ?, 'BP', 'MARKET_REFERENCE_PRICE', 'VALID')`,
  ).run(sourceId, instrumentId, value);
}

test("freezes supplementary cohort instruments without changing SAMPLE_MARKET", () => {
  const db = openMarketDatabase(":memory:");
  try {
    db.prepare("INSERT INTO player VALUES ('seed', 'Seed')").run();
    db.prepare("INSERT INTO player_card VALUES ('100', 'seed', 'PTG')").run();
    db.prepare("INSERT INTO instrument VALUES ('100:1', '100', 1)").run();
    price(db, "100:1", "price-seed", 100);
    source(db, "meta-seed");
    db.prepare(
      `INSERT INTO metadata_snapshot(
        metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
        player_name, season_id, season_name, salary, positions_json, ovr,
        stats_json, traits_json, clubs_json, nations_json, team_colors_json,
        completeness
      ) VALUES ('meta-row', '100', '2026-10-01T00:00:00.000Z',
        '2026-09-01T00:00:00.000Z', NULL, 'Seed', 863, 'PTG', 20,
        '[{"name":"RB","primary":true}]', 120, '{}', '[]', '[]', '[]', '[]', 'FULL')`,
    ).run();
    db.prepare(
      "INSERT INTO metadata_snapshot_source VALUES ('meta-row', 'meta-seed', 'DETAIL')",
    ).run();

    db.prepare("INSERT INTO player VALUES ('supp', 'Supplement')").run();
    db.prepare("INSERT INTO player_card VALUES ('868001001', 'supp', '26FSL')").run();
    db.prepare("INSERT INTO instrument VALUES ('868001001:11', '868001001', 11)").run();
    price(db, "868001001:11", "price-supp", 500);

    db.prepare(
      "INSERT INTO cohort_definition VALUES ('SAMPLE_MARKET:test', 'SAMPLE_MARKET', 'PLAYER', 'test-v1', '{}')",
    ).run();
    db.prepare(
      "INSERT INTO cohort_definition VALUES ('PREMIUM_SCARCE', 'PREMIUM_SCARCE', 'PLAYER', 'test-v1', '{}')",
    ).run();
    db.prepare(
      `INSERT INTO cohort_membership VALUES (
        'SAMPLE_MARKET:test', '100:1', '2026-09-01T00:00:00.000Z', NULL, 'TEST', 1
      )`,
    ).run();
    db.prepare(
      `INSERT INTO cohort_membership VALUES (
        'PREMIUM_SCARCE', '868001001:11', '2026-09-17T02:15:00.000Z', NULL, 'TEST', 1
      )`,
    ).run();

    const snapshot = createDatasetSnapshot(db, {
      catalog_id: "test",
      seeds: [{ player_key: "seed", primary_instrument: { spid: "100", grade: 1 } }],
    }, {
      analysisCutoff: "2026-10-01T01:00:00.000Z",
      createdAt: "2026-10-01T01:01:00.000Z",
      schemaVersion: MARKET_SCHEMA_VERSION,
    });

    assert.equal(snapshot.counts.price_points, 2);
    const instruments = db.prepare(
      `SELECT DISTINCT instrument_id
       FROM dataset_snapshot_price_point
       WHERE dataset_snapshot_id = ?
       ORDER BY instrument_id`,
    ).all(snapshot.dataset_snapshot_id).map((row) => (row as { instrument_id: string }).instrument_id);
    assert.deepEqual(instruments, ["100:1", "868001001:11"]);
    const sample = db.prepare(
      `SELECT instrument_id FROM dataset_snapshot_cohort_membership
       WHERE dataset_snapshot_id = ? AND cohort_id = 'SAMPLE_MARKET:test'`,
    ).all(snapshot.dataset_snapshot_id);
    assert.deepEqual(sample.map((row) => ({ ...row })), [{ instrument_id: "100:1" }]);
  } finally {
    db.close();
  }
});
