import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openMarketDatabase } from "../src/db/market-db.ts";
import {
  buildMarketStructure,
  type StructureSeedCatalog,
} from "../src/normalize/market-structure.ts";

async function tempDb() {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-cohorts-db-"));
  return openMarketDatabase(join(directory, "market.db"));
}

function catalog(): StructureSeedCatalog {
  return {
    catalog_id: "test-sample",
    frozen_at: "2026-09-29T00:00:00.000Z",
    seeds: Array.from({ length: 11 }, (_, index) => ({
      player_key: `p${index + 1}`,
      primary_instrument: { spid: String(100 + index), grade: 1 },
      selection_observation: {
        ranker_squad_count: 110 - index,
        displayed_share_percent: 20 - index,
      },
    })),
  };
}

function seedCard(
  db: ReturnType<typeof openMarketDatabase>,
  input: {
    index: number;
    usageShare: number;
    teamColors: string[];
  },
): void {
  const playerId = `p${input.index}`;
  const spid = String(99 + input.index);
  const instrumentId = `${spid}:1`;
  db.prepare("INSERT INTO player(player_id, name) VALUES (?, ?)").run(
    playerId,
    `Player ${input.index}`,
  );
  db.prepare(
    "INSERT INTO player_card(spid, player_id, season) VALUES (?, ?, 'PTG')",
  ).run(spid, playerId);
  db.prepare(
    "INSERT INTO instrument(instrument_id, spid, grade) VALUES (?, ?, 1)",
  ).run(instrumentId, spid);
  db.prepare(
    `INSERT INTO metadata_snapshot(
      metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
      player_name, season_id, season_name, salary, positions_json, ovr,
      stats_json, traits_json, clubs_json, nations_json, team_colors_json,
      completeness
    ) VALUES (?, ?, '2026-09-30T00:00:00.000Z',
      '2026-09-30T00:00:00.000Z', NULL, ?, 863, 'PTG', 20, ?, 120, ?,
      '[]', '[]', '[]', ?, 'FULL')`,
  ).run(
    `meta-${spid}`,
    spid,
    `Player ${input.index}`,
    JSON.stringify([{ name: "RB", ovr: 120, primary: true }]),
    JSON.stringify({ pace: 120, pass: 100 }),
    JSON.stringify([...input.teamColors, "PTG"]),
  );
  db.prepare(
    `INSERT INTO usage_point(
      usage_point_id, subject_type, spid, instrument_id, as_of,
      source_data_date, observation_type, appearances, usage_share,
      position_code, performance_metrics_json, source_snapshot_id
    ) VALUES (?, 'PLAYER_CARD', ?, NULL, '2026-09-30T02:00:00.000Z',
      '2026-09-30', 'DAILY_CHART_CLASS_USAGE', 10, ?, NULL, NULL, ?)`,
  ).run(`usage-${spid}`, spid, input.usageShare, `usage-src-${spid}`);
}

function seedDirectExposure(db: ReturnType<typeof openMarketDatabase>): void {
  db.prepare(
    `INSERT INTO product(
      product_id, name, sale_start, sale_end, price, currency,
      purchase_limit, channel, source_snapshot_id, notes
    ) VALUES ('pack-1', 'pack', '2026-10-01T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z', 20, 'PREMIUM_COIN', 2,
      'SPECIAL_WEB_SHOP', 'source-pack', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO exposure(
      exposure_id, event_id, product_id, instrument_id, exposure_type,
      valid_from, valid_to, source, confidence
    ) VALUES ('exp-1', NULL, 'pack-1', '100:1', 'DIRECT',
      '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z',
      'TEST', 0.9)`,
  ).run();
}

test("builds CORE, META, PACK_EXPOSED, and relation-derived INDIRECT_EXPOSED cohorts", async () => {
  const db = await tempDb();
  try {
    for (let index = 1; index <= 11; index += 1) {
      seedCard(db, {
        index,
        usageShare: index === 1 ? 0.2 : 0.01,
        teamColors:
          index <= 2 ? ["Chelsea"] : [`Unique Team ${index}`],
      });
    }
    seedDirectExposure(db);

    const first = buildMarketStructure(db, catalog(), {
      asOf: "2026-10-01T12:00:00.000Z",
    });
    const second = buildMarketStructure(db, catalog(), {
      asOf: "2026-10-01T12:00:00.000Z",
    });

    assert.deepEqual(first, {
      as_of: "2026-10-01T12:00:00.000Z",
      relations_created: 1,
      relation_snapshots_created: 1,
      cohort_definitions_created: 5,
      cohort_memberships_created: 24,
    });
    assert.deepEqual(second, {
      as_of: "2026-10-01T12:00:00.000Z",
      relations_created: 0,
      relation_snapshots_created: 0,
      cohort_definitions_created: 0,
      cohort_memberships_created: 0,
    });

    const definitions = db
      .prepare(
        `SELECT name, rule_version
         FROM cohort_definition
         ORDER BY name`,
      )
      .all() as Array<{ name: string; rule_version: string }>;
    assert.deepEqual(definitions.map((row) => row.name), [
      "CORE",
      "INDIRECT_EXPOSED",
      "META",
      "PACK_EXPOSED",
      "SAMPLE_MARKET",
    ]);

    const coreCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM cohort_membership
         WHERE cohort_id = 'CORE:test-sample:top-10-with-ties'`,
      )
      .get() as { count: number | bigint };
    assert.equal(Number(coreCount.count), 10);
    const excludedCore = db
      .prepare(
        `SELECT 1 AS found
         FROM cohort_membership
         WHERE cohort_id = 'CORE:test-sample:top-10-with-ties'
           AND instrument_id = '110:1'`,
      )
      .get();
    assert.equal(excludedCore, undefined);

    const meta = db
      .prepare(
        `SELECT instrument_id, valid_from, valid_to, membership_source
         FROM cohort_membership
         WHERE cohort_id = 'META:usage-share-0.05'`,
      )
      .all();
    assert.deepEqual(meta.map((row) => ({ ...row })), [
      {
        instrument_id: "100:1",
        valid_from: "2026-09-30T02:00:00.000Z",
        valid_to: null,
        membership_source: "USAGE_POINT:usage-100",
      },
    ]);

    const indirect = db
      .prepare(
        `SELECT instrument_id, valid_from, valid_to, membership_source, confidence
         FROM cohort_membership
         WHERE cohort_id = 'INDIRECT_EXPOSED'`,
      )
      .get();
    const indirectRow = indirect as {
      instrument_id: string;
      valid_from: string;
      valid_to: string | null;
      membership_source: string;
      confidence: number;
    };
    assert.equal(indirectRow.instrument_id, "101:1");
    assert.equal(indirectRow.valid_from, "2026-10-01T00:00:00.000Z");
    assert.equal(indirectRow.valid_to, "2026-10-02T00:00:00.000Z");
    assert.match(indirectRow.membership_source, /^RELATION_EXPOSURE:exp-1:rel_/);
    assert.equal(indirectRow.confidence, 0.9);
  } finally {
    db.close();
  }
});

test("closes an open META membership when the latest usage observation drops below threshold", async () => {
  const db = await tempDb();
  try {
    for (let index = 1; index <= 11; index += 1) {
      seedCard(db, {
        index,
        usageShare: index === 1 ? 0.2 : 0.01,
        teamColors: [`Unique Team ${index}`],
      });
    }
    buildMarketStructure(db, catalog(), {
      asOf: "2026-10-01T12:00:00.000Z",
    });
    db.prepare(
      `INSERT INTO usage_point(
        usage_point_id, subject_type, spid, instrument_id, as_of,
        source_data_date, observation_type, appearances, usage_share,
        position_code, performance_metrics_json, source_snapshot_id
      ) VALUES ('usage-100-lower', 'PLAYER_CARD', '100', NULL,
        '2026-10-02T00:00:00.000Z', '2026-10-02',
        'DAILY_CHART_CLASS_USAGE', 10, 0.01, NULL, NULL, 'usage-src-100-lower')`,
    ).run();

    buildMarketStructure(db, catalog(), {
      asOf: "2026-10-02T01:00:00.000Z",
    });
    const membership = db
      .prepare(
        `SELECT valid_from, valid_to
         FROM cohort_membership
         WHERE cohort_id = 'META:usage-share-0.05'
           AND instrument_id = '100:1'`,
      )
      .get();
    assert.deepEqual({ ...membership }, {
      valid_from: "2026-09-30T02:00:00.000Z",
      valid_to: "2026-10-02T00:00:00.000Z",
    });
  } finally {
    db.close();
  }
});
