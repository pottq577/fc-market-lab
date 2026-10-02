import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  buildBenchmarkPanels,
  resolveBenchmarkPanelUniverseId,
  type DiscoveryStatusForPanel,
} from "../src/benchmark/panel.ts";

function fixtureDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE benchmark_discovery_frame (
      discovery_frame_id TEXT PRIMARY KEY,
      universe_snapshot_id TEXT NOT NULL,
      target_size INTEGER NOT NULL,
      population_count INTEGER NOT NULL,
      inclusion_probability REAL NOT NULL,
      population_weight REAL NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_discovery_member (
      discovery_frame_id TEXT NOT NULL,
      sample_rank INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      probe_spid TEXT NOT NULL,
      probe_grade INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE benchmark_discovery_outcome (
      discovery_frame_id TEXT NOT NULL,
      sample_rank INTEGER NOT NULL,
      outcome TEXT NOT NULL
    ) STRICT;
    CREATE TABLE market_universe_snapshot (
      universe_snapshot_id TEXT PRIMARY KEY,
      as_of TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      catalog_player_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE market_universe_instrument (
      universe_snapshot_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL,
      spid TEXT NOT NULL,
      grade INTEGER NOT NULL,
      latest_price INTEGER,
      latest_source_timestamp TEXT,
      valid_history_count INTEGER NOT NULL,
      price_eligible INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE market_universe_card (
      universe_snapshot_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      spid TEXT NOT NULL
    ) STRICT;
    CREATE TABLE usage_point (
      usage_point_id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL,
      spid TEXT,
      instrument_id TEXT,
      usage_share REAL,
      as_of TEXT NOT NULL
    ) STRICT;
    CREATE TABLE instrument (
      instrument_id TEXT PRIMARY KEY,
      spid TEXT NOT NULL,
      grade INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE source_snapshot (
      source_snapshot_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      capture_method TEXT NOT NULL,
      parse_status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE price_point (
      source_snapshot_id TEXT NOT NULL,
      instrument_id TEXT NOT NULL
    ) STRICT;
  `);
  db.exec(readFileSync("db/migrations/012_benchmark_panel.sql", "utf8"));
  return db;
}

function seedUniverse(
  db: DatabaseSync,
  id: string,
  asOf: string,
  sourceHash = "sha256:catalog",
): void {
  db.prepare(
    `INSERT INTO market_universe_snapshot
     VALUES (?, ?, ?, 100, ?)`,
  ).run(id, asOf, sourceHash, asOf);
}

function seedDiscovery(
  db: DatabaseSync,
  input: { targetSize: number; observedCount: number },
): DiscoveryStatusForPanel {
  const stage1 = input.targetSize / 100;
  db.prepare(
    `INSERT INTO benchmark_discovery_frame
     VALUES ('frame-1', 'universe-origin', ?, 100, ?, ?)`,
  ).run(input.targetSize, stage1, 1 / stage1);

  for (let rank = 1; rank <= input.targetSize; rank += 1) {
    const spid = `851${String(rank).padStart(6, "0")}`;
    db.prepare(
      `INSERT INTO benchmark_discovery_member
       VALUES ('frame-1', ?, ?, ?, ?, 1)`,
    ).run(rank, `pid:${rank}`, `선수 ${rank}`, spid);
    db.prepare(
      `INSERT INTO benchmark_discovery_outcome
       VALUES ('frame-1', ?, ?)`,
    ).run(rank, rank <= input.observedCount ? "OBSERVED" : "NO_USABLE_PRICE");
  }

  return {
    discovery_frame_id: "frame-1",
    universe_snapshot_id: "universe-origin",
    target_size: input.targetSize,
    attempted_count: input.targetSize,
    observed_count: input.observedCount,
    pending_count: 0,
    response_coverage: Number((input.observedCount / input.targetSize).toFixed(6)),
    readiness: "READY_FOR_PANEL",
  };
}

function seedEligibleResponders(
  db: DatabaseSync,
  count: number,
  usageValues: Map<number, number> = new Map(),
): void {
  for (let rank = 1; rank <= count; rank += 1) {
    const spid = `851${String(rank).padStart(6, "0")}`;
    const instrumentId = `${spid}:1`;
    db.prepare(
      `INSERT INTO market_universe_instrument
       VALUES ('universe-panel', ?, ?, ?, 1, ?,
         '2026-10-02T00:00:00.000Z', 365, 1)`,
    ).run(`pid:${rank}`, instrumentId, spid, rank * 100);
    db.prepare(
      `INSERT INTO market_universe_card
       VALUES ('universe-panel', ?, ?)`,
    ).run(`pid:${rank}`, spid);
    const usage = usageValues.get(rank);
    if (usage !== undefined) {
      db.prepare(
        `INSERT INTO usage_point
         VALUES (?, 'PLAYER_CARD', ?, NULL, ?, '2026-10-02T00:00:00.000Z')`,
      ).run(`usage-${rank}`, spid, usage);
    }
  }
}

test("builds deterministic nested panels with two-stage population weights", () => {
  const db = fixtureDb();
  try {
    seedUniverse(db, "universe-origin", "2026-10-01T00:00:00.000Z");
    seedUniverse(db, "universe-panel", "2026-10-02T00:00:00.000Z");
    const status = seedDiscovery(db, { targetSize: 21, observedCount: 20 });
    seedEligibleResponders(db, 20);

    const first = buildBenchmarkPanels(db, {
      discoveryStatus: status,
      universeSnapshotId: "universe-panel",
      panelSizes: [4, 8, 12, 16],
      effectiveFrom: "2026-10-02T00:00:00.000Z",
      createdAt: "2026-10-02T00:01:00.000Z",
    });
    const second = buildBenchmarkPanels(db, {
      discoveryStatus: status,
      universeSnapshotId: "universe-panel",
      panelSizes: [4, 8, 12, 16],
      effectiveFrom: "2026-10-02T00:00:00.000Z",
      createdAt: "2026-10-02T00:02:00.000Z",
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.panel_family_id, second.panel_family_id);
    assert.equal(first.eligible_responder_count, 20);
    assert.equal(first.discovery_response_coverage, 0.952381);
    assert.deepEqual(first.price_boundaries, { p50: 1000, p80: 1600, p95: 1900 });
    assert.equal(first.nonempty_stratum_count, 4);

    const panels = db
      .prepare(
        `SELECT panel_id, panel_size
         FROM benchmark_panel
         WHERE panel_family_id = ?
         ORDER BY panel_size`,
      )
      .all(first.panel_family_id) as Array<{ panel_id: string; panel_size: number }>;
    const sets = panels.map((panel) => new Set(
      (db.prepare(
        `SELECT player_id FROM benchmark_panel_member
         WHERE panel_id = ? ORDER BY admission_rank`,
      ).all(panel.panel_id) as Array<{ player_id: string }>).map((row) => row.player_id),
    ));
    assert.deepEqual(panels.map((row) => row.panel_size), [4, 8, 12, 16]);
    for (let index = 0; index < sets.length - 1; index += 1) {
      for (const playerId of sets[index]!) {
        assert.equal(sets[index + 1]!.has(playerId), true);
      }
    }

    for (const panel of first.panels) {
      assert.ok(Math.abs(panel.represented_population_weight - 95.238095) < 0.00001);
    }

    const p4 = panels[0]!;
    const strata = db.prepare(
      `SELECT discovery_responder_count, sampled_count,
              stage2_inclusion_probability,
              combined_inclusion_probability, population_weight
       FROM benchmark_panel_stratum
       WHERE panel_id = ?
       ORDER BY stratum_id`,
    ).all(p4.panel_id) as Array<Record<string, number>>;
    assert.equal(strata.length, 4);
    assert.ok(strata.every((row) => row.sampled_count === 1));
    assert.ok(strata.every((row) => Math.abs(
      row.population_weight - 1 / row.combined_inclusion_probability,
    ) < 0.001));
  } finally {
    db.close();
  }
});

test("preserves observed usage bands and keeps missing usage as UNOBSERVED", () => {
  const db = fixtureDb();
  try {
    seedUniverse(db, "universe-origin", "2026-10-01T00:00:00.000Z");
    seedUniverse(db, "universe-panel", "2026-10-02T00:00:00.000Z");
    const status = seedDiscovery(db, { targetSize: 12, observedCount: 12 });
    seedEligibleResponders(
      db,
      12,
      new Map([
        [1, 0.1], [2, 0.2], [3, 0.3],
        [4, 0.4], [5, 0.5], [6, 0.6],
      ]),
    );

    const result = buildBenchmarkPanels(db, {
      discoveryStatus: status,
      universeSnapshotId: "universe-panel",
      panelSizes: [8],
      effectiveFrom: "2026-10-02T00:00:00.000Z",
      createdAt: "2026-10-02T00:01:00.000Z",
    });

    assert.equal(result.usage_observed_count, 6);
    assert.deepEqual(result.usage_boundaries, { p33: 0.2, p67: 0.4 });
    const bands = db.prepare(
      `SELECT usage_band, COUNT(*) AS count
       FROM benchmark_panel_member
       WHERE panel_id = ?
       GROUP BY usage_band
       ORDER BY usage_band`,
    ).all(result.panels[0]!.panel_id) as Array<{ usage_band: string; count: number }>;
    assert.ok(bands.some((row) => row.usage_band === "UNOBSERVED"));
    assert.ok(bands.some((row) => row.usage_band === "LOW_OBSERVED"));
    assert.ok(bands.some((row) => row.usage_band === "MID_OBSERVED"));
    assert.ok(bands.some((row) => row.usage_band === "HIGH_OBSERVED"));
  } finally {
    db.close();
  }
});

test("rejects panel creation before discovery is ready", () => {
  const db = fixtureDb();
  try {
    seedUniverse(db, "universe-origin", "2026-10-01T00:00:00.000Z");
    seedUniverse(db, "universe-panel", "2026-10-02T00:00:00.000Z");
    const status = seedDiscovery(db, { targetSize: 10, observedCount: 10 });
    assert.throws(
      () => buildBenchmarkPanels(db, {
        discoveryStatus: { ...status, readiness: "IN_PROGRESS", pending_count: 1 },
        universeSnapshotId: "universe-panel",
        panelSizes: [4],
      }),
      /READY_FOR_PANEL/,
    );
  } finally {
    db.close();
  }
});

test("rejects a refreshed universe whose catalog provenance drifted", () => {
  const db = fixtureDb();
  try {
    seedUniverse(db, "universe-origin", "2026-10-01T00:00:00.000Z");
    seedUniverse(db, "universe-panel", "2026-10-02T00:00:00.000Z", "sha256:changed");
    seedDiscovery(db, { targetSize: 10, observedCount: 10 });
    assert.throws(
      () => resolveBenchmarkPanelUniverseId(db, "frame-1", "universe-panel"),
      /source_hash differs/,
    );
  } finally {
    db.close();
  }
});
