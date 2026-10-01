import assert from "node:assert/strict";
import test from "node:test";

import {
  benchmarkDiscoveryTargets,
  buildBenchmarkDiscoveryFrame,
} from "../src/benchmark/discovery-frame.ts";
import { openMarketDatabase } from "../src/db/market-db.ts";

function fixtureDb() {
  const db = openMarketDatabase(":memory:");
  db.prepare(
    `INSERT INTO market_universe_snapshot(
      universe_snapshot_id, as_of, rule_version, source_hash,
      price_semantics, price_max_age_days, catalog_player_count,
      catalog_card_count, price_eligible_player_count,
      price_eligible_instrument_count, created_at
    ) VALUES ('universe-test', '2026-10-01T06:00:00.000Z',
      'market-universe-v1', 'sha256:test', 'MARKET_REFERENCE_PRICE', 7,
      5, 10, 0, 0, '2026-10-01T06:01:00.000Z')`,
  ).run();

  for (let index = 1; index <= 5; index += 1) {
    const playerId = `pid:${String(index).padStart(6, "0")}`;
    db.prepare(
      `INSERT INTO market_universe_member(
        universe_snapshot_id, player_id, player_name, catalog_card_count,
        observed_instrument_count, eligible_instrument_count, price_eligible,
        anchor_instrument_id, anchor_price, anchor_source_timestamp,
        anchor_history_count
      ) VALUES ('universe-test', ?, ?, 2, 0, 0, 0, NULL, NULL, NULL, NULL)`,
    ).run(playerId, `선수 ${index}`);
    db.prepare(
      `INSERT INTO market_universe_card(
        universe_snapshot_id, player_id, spid, player_name,
        season_id, season_name
      ) VALUES ('universe-test', ?, ?, ?, 851, '26TOTS')`,
    ).run(
      playerId,
      `851${String(index).padStart(6, "0")}`,
      `선수 ${index}`,
    );
    db.prepare(
      `INSERT INTO market_universe_card(
        universe_snapshot_id, player_id, spid, player_name,
        season_id, season_name
      ) VALUES ('universe-test', ?, ?, ?, 863, 'PTG')`,
    ).run(
      playerId,
      `863${String(index).padStart(6, "0")}`,
      `선수 ${index}`,
    );
  }
  return db;
}

test("builds an idempotent catalog discovery frame without inventing instruments", () => {
  const db = fixtureDb();
  try {
    const first = buildBenchmarkDiscoveryFrame(db, {
      universeSnapshotId: "universe-test",
      targetSize: 3,
      sampleSeed: "fixture-seed",
      createdAt: "2026-10-01T07:00:00.000Z",
    });
    const second = buildBenchmarkDiscoveryFrame(db, {
      universeSnapshotId: "universe-test",
      targetSize: 3,
      sampleSeed: "fixture-seed",
      createdAt: "2026-10-01T07:01:00.000Z",
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.discovery_frame_id, first.discovery_frame_id);
    assert.equal(first.population_count, 5);
    assert.equal(first.inclusion_probability, 3 / 5);
    assert.equal(first.population_weight, 5 / 3);

    const members = db
      .prepare(
        `SELECT sample_rank, player_id, probe_spid, probe_grade,
                inclusion_probability, population_weight
         FROM benchmark_discovery_member
         WHERE discovery_frame_id = ?
         ORDER BY sample_rank`,
      )
      .all(first.discovery_frame_id)
      .map((row) => ({ ...row }));
    assert.equal(members.length, 3);
    assert.deepEqual(
      members.map((member) => member.sample_rank),
      [1, 2, 3],
    );
    assert.ok(members.every((member) => member.probe_grade === 1));
    assert.ok(
      members.every(
        (member) => Number(member.inclusion_probability) === 3 / 5,
      ),
    );
    assert.ok(
      members.every((member) => Number(member.population_weight) === 5 / 3),
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM instrument").get()!.count,
      0,
    );
  } finally {
    db.close();
  }
});

test("exports rank-bounded discovery targets for the existing collector", () => {
  const db = fixtureDb();
  try {
    const frame = buildBenchmarkDiscoveryFrame(db, {
      universeSnapshotId: "universe-test",
      targetSize: 4,
      sampleSeed: "fixture-seed",
      createdAt: "2026-10-01T07:00:00.000Z",
    });
    const targets = benchmarkDiscoveryTargets(db, frame.discovery_frame_id, {
      fromRank: 2,
      toRank: 3,
    });

    assert.deepEqual(
      targets.map((target) => target.sample_rank),
      [2, 3],
    );
    assert.ok(targets.every((target) => /^\d{9}$/.test(target.spid)));
    assert.ok(targets.every((target) => target.grade === 1));
  } finally {
    db.close();
  }
});

test("rejects discovery frames larger than the frozen catalog population", () => {
  const db = fixtureDb();
  try {
    assert.throws(
      () =>
        buildBenchmarkDiscoveryFrame(db, {
          universeSnapshotId: "universe-test",
          targetSize: 6,
        }),
      /exceeds catalog population/,
    );
  } finally {
    db.close();
  }
});
