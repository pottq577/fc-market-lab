import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  countMarketStructureDatabase,
  MARKET_SCHEMA_VERSION,
  openMarketDatabase,
} from "../src/db/market-db.ts";
import {
  buildMarketStructure,
  type StructureSeedCatalog,
} from "../src/normalize/market-structure.ts";

async function tempDb() {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-structure-db-"));
  return openMarketDatabase(join(directory, "market.db"));
}

const catalog: StructureSeedCatalog = {
  catalog_id: "test-sample",
  frozen_at: "2026-09-29T00:00:00.000Z",
  seeds: [
    {
      player_key: "p1",
      primary_instrument: { spid: "100", grade: 1 },
      selection_observation: {
        ranker_squad_count: 100,
        displayed_share_percent: 20,
      },
    },
    {
      player_key: "p2",
      primary_instrument: { spid: "200", grade: 1 },
      selection_observation: {
        ranker_squad_count: 90,
        displayed_share_percent: 10,
      },
    },
    {
      player_key: "p3",
      primary_instrument: { spid: "300", grade: 1 },
      selection_observation: {
        ranker_squad_count: 80,
        displayed_share_percent: 5,
      },
    },
  ],
};

function seedCard(
  db: ReturnType<typeof openMarketDatabase>,
  input: {
    playerId: string;
    spid: string;
    name: string;
    salary: number;
    ovr: number;
    teamColors: string[];
    stats: Record<string, number>;
    price: number;
    usageShare: number;
  },
): void {
  const instrumentId = `${input.spid}:1`;
  db.prepare("INSERT INTO player(player_id, name) VALUES (?, ?)").run(
    input.playerId,
    input.name,
  );
  db.prepare(
    "INSERT INTO player_card(spid, player_id, season) VALUES (?, ?, 'PTG')",
  ).run(input.spid, input.playerId);
  db.prepare(
    "INSERT INTO instrument(instrument_id, spid, grade) VALUES (?, ?, 1)",
  ).run(instrumentId, input.spid);
  db.prepare(
    `INSERT INTO metadata_snapshot(
      metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
      player_name, season_id, season_name, salary, positions_json, ovr,
      stats_json, traits_json, clubs_json, nations_json, team_colors_json,
      completeness
    ) VALUES (?, ?, '2026-09-30T00:00:00.000Z',
      '2026-09-30T00:00:00.000Z', NULL, ?, 863, 'PTG', ?, ?, ?, ?,
      '[]', '[]', '[]', ?, 'FULL')`,
  ).run(
    `meta-${input.spid}`,
    input.spid,
    input.name,
    input.salary,
    JSON.stringify([{ name: "RB", ovr: input.ovr, primary: true }]),
    input.ovr,
    JSON.stringify(input.stats),
    JSON.stringify(input.teamColors),
  );
  db.prepare(
    `INSERT INTO price_point(
      source_snapshot_id, instrument_id, source_timestamp, observed_at,
      value, currency, price_semantics, quality_status
    ) VALUES (?, ?, '2026-09-30T00:00:00.000Z', '2026-09-30T01:00:00.000Z',
      ?, 'BP', 'MARKET_REFERENCE_PRICE', 'VALID')`,
  ).run(`price-src-${input.spid}`, instrumentId, input.price);
  db.prepare(
    `INSERT INTO usage_point(
      usage_point_id, subject_type, spid, instrument_id, as_of,
      source_data_date, observation_type, appearances, usage_share,
      position_code, performance_metrics_json, source_snapshot_id
    ) VALUES (?, 'PLAYER_CARD', ?, NULL, '2026-09-30T02:00:00.000Z',
      '2026-09-30', 'DAILY_CHART_CLASS_USAGE', 10, ?, NULL, NULL, ?)`,
  ).run(
    `usage-${input.spid}`,
    input.spid,
    input.usageShare,
    `usage-src-${input.spid}`,
  );
}

function seedAdditionalInstrumentForPlayerOne(
  db: ReturnType<typeof openMarketDatabase>,
): void {
  db.prepare(
    "INSERT INTO player_card(spid, player_id, season) VALUES ('400', 'p1', 'ALT')",
  ).run();
  db.prepare(
    "INSERT INTO instrument(instrument_id, spid, grade) VALUES ('400:1', '400', 1)",
  ).run();
  db.prepare(
    `INSERT INTO metadata_snapshot(
      metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
      player_name, season_id, season_name, salary, positions_json, ovr,
      stats_json, traits_json, clubs_json, nations_json, team_colors_json,
      completeness
    ) VALUES ('meta-400', '400', '2026-09-30T00:00:00.000Z',
      '2026-09-30T00:00:00.000Z', NULL, 'A', 900, 'ALT', 25, ?, 121, ?,
      '[]', '[]', '[]', ?, 'FULL')`,
  ).run(
    JSON.stringify([{ name: "ST", ovr: 121, primary: true }]),
    JSON.stringify({ pace: 115, pass: 95 }),
    JSON.stringify(["Arsenal", "ALT"]),
  );
}

function seedHistoricalDirectExposure(
  db: ReturnType<typeof openMarketDatabase>,
): void {
  db.prepare(
    `INSERT INTO product(
      product_id, name, sale_start, sale_end, price, currency,
      purchase_limit, channel, source_snapshot_id, notes
    ) VALUES ('pack-1', 'pack', '2026-09-17T00:00:00.000Z',
      '2026-09-18T00:00:00.000Z', 20, 'PREMIUM_COIN', 2,
      'SPECIAL_WEB_SHOP', 'source-pack', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO exposure(
      exposure_id, event_id, product_id, instrument_id, exposure_type,
      valid_from, valid_to, source, confidence
    ) VALUES ('exp-1', NULL, 'pack-1', '100:1', 'DIRECT',
      '2026-09-17T00:00:00.000Z', '2026-09-18T00:00:00.000Z',
      'TEST', 1)`,
  ).run();
}

test("applies the relation and cohort migration", async () => {
  const db = await tempDb();
  try {
    const versions = db
      .prepare("SELECT version FROM schema_migration ORDER BY version")
      .all() as Array<{ version: number }>;
    assert.deepEqual(
      versions.map((row) => row.version),
      Array.from({ length: MARKET_SCHEMA_VERSION }, (_, index) => index + 1),
    );
    assert.deepEqual(countMarketStructureDatabase(db), {
      card_relations: 0,
      relation_snapshots: 0,
      cohort_definitions: 0,
      cohort_memberships: 0,
    });
  } finally {
    db.close();
  }
});

test("builds time-aware substitute relations and frozen cohort membership idempotently", async () => {
  const db = await tempDb();
  try {
    seedCard(db, {
      playerId: "p1",
      spid: "100",
      name: "A",
      salary: 20,
      ovr: 120,
      teamColors: ["Chelsea", "PTG"],
      stats: { pace: 120, pass: 100 },
      price: 100,
      usageShare: 0.2,
    });
    seedCard(db, {
      playerId: "p2",
      spid: "200",
      name: "B",
      salary: 21,
      ovr: 119,
      teamColors: ["Chelsea", "PTG"],
      stats: { pace: 118, pass: 104 },
      price: 110,
      usageShare: 0.1,
    });
    seedCard(db, {
      playerId: "p3",
      spid: "300",
      name: "C",
      salary: 22,
      ovr: 118,
      teamColors: ["PTG"],
      stats: { pace: 110, pass: 90 },
      price: 90,
      usageShare: 0.05,
    });
    seedAdditionalInstrumentForPlayerOne(db);
    seedHistoricalDirectExposure(db);

    const first = buildMarketStructure(db, catalog, {
      asOf: "2026-10-01T00:00:00.000Z",
    });
    const second = buildMarketStructure(db, catalog, {
      asOf: "2026-10-01T00:00:00.000Z",
    });

    assert.deepEqual(first, {
      as_of: "2026-10-01T00:00:00.000Z",
      relations_created: 2,
      relation_snapshots_created: 2,
      cohort_definitions_created: 5,
      cohort_memberships_created: 10,
    });
    assert.deepEqual(second, {
      as_of: "2026-10-01T00:00:00.000Z",
      relations_created: 0,
      relation_snapshots_created: 0,
      cohort_definitions_created: 0,
      cohort_memberships_created: 0,
    });

    const relation = db
      .prepare(
        `SELECT source_instrument, target_instrument, same_player,
                same_position, relation_source
         FROM card_relation
         WHERE relation_source = 'TEAM_COLOR_POSITION_FULL_METADATA'`,
      )
      .get() as Record<string, unknown>;
    assert.deepEqual(
      { ...relation },
      {
        source_instrument: "100:1",
        target_instrument: "200:1",
        same_player: 0,
        same_position: 1,
        relation_source: "TEAM_COLOR_POSITION_FULL_METADATA",
      },
    );

    const snapshot = db
      .prepare(
        `SELECT rs.shared_team_colors_json, rs.salary_diff, rs.ovr_diff,
                rs.stat_distance, rs.price_ratio, rs.usage_distance,
                rs.movement_similarity, rs.definition_version
         FROM relation_snapshot rs
         JOIN card_relation cr ON cr.relation_id = rs.relation_id
         WHERE cr.relation_source = 'TEAM_COLOR_POSITION_FULL_METADATA'`,
      )
      .get() as Record<string, unknown>;
    assert.deepEqual(JSON.parse(snapshot.shared_team_colors_json as string), [
      "Chelsea",
    ]);
    assert.equal(snapshot.salary_diff, 1);
    assert.equal(snapshot.ovr_diff, -1);
    assert.equal(snapshot.stat_distance, 3.162278);
    assert.equal(snapshot.price_ratio, 1.1);
    assert.equal(snapshot.usage_distance, 0.1);
    assert.equal(snapshot.movement_similarity, null);
    assert.equal(snapshot.definition_version, "full-metadata-v1");

    const samePlayer = db
      .prepare(
        `SELECT source_instrument, target_instrument, same_player, same_position
         FROM card_relation
         WHERE relation_source = 'SAME_PLAYER_FULL_METADATA'`,
      )
      .get();
    assert.deepEqual(
      { ...samePlayer },
      {
        source_instrument: "100:1",
        target_instrument: "400:1",
        same_player: 1,
        same_position: 0,
      },
    );

    const sampleMemberships = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM cohort_membership
         WHERE cohort_id = 'SAMPLE_MARKET:test-sample'`,
      )
      .get() as { count: number | bigint };
    assert.equal(Number(sampleMemberships.count), 3);

    const packMembership = db
      .prepare(
        `SELECT valid_from, valid_to, membership_source
         FROM cohort_membership
         WHERE cohort_id = 'PACK_EXPOSED' AND instrument_id = '100:1'`,
      )
      .get();
    assert.deepEqual(
      { ...packMembership },
      {
        valid_from: "2026-09-17T00:00:00.000Z",
        valid_to: "2026-09-18T00:00:00.000Z",
        membership_source: "DIRECT_EXPOSURE:exp-1",
      },
    );

    assert.deepEqual(countMarketStructureDatabase(db), {
      card_relations: 2,
      relation_snapshots: 2,
      cohort_definitions: 5,
      cohort_memberships: 10,
    });
  } finally {
    db.close();
  }
});
