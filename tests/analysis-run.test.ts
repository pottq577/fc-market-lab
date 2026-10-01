import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalJson,
  createAnalysisRun,
  createDatasetSnapshot,
  type AnalysisSeedCatalog,
} from "../src/analysis/run-context.ts";
import {
  countAnalysisDatabase,
  MARKET_SCHEMA_VERSION,
  openMarketDatabase,
} from "../src/db/market-db.ts";

async function tempDb() {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-analysis-db-"));
  return openMarketDatabase(join(directory, "market.db"));
}

const catalog: AnalysisSeedCatalog = {
  catalog_id: "analysis-test",
  seeds: [
    { player_key: "p1", primary_instrument: { spid: "100", grade: 1 } },
    { player_key: "p2", primary_instrument: { spid: "200", grade: 1 } },
  ],
};

function source(
  db: ReturnType<typeof openMarketDatabase>,
  id: string,
  observedAt: string,
): void {
  db.prepare(
    `INSERT INTO source_snapshot(
      source_snapshot_id, source_id, source_type, source_url,
      source_timestamp, observed_at, raw_payload, raw_hash,
      capture_method, collector_version, policy_evidence_id,
      source_ref, parse_status, parse_error
    ) VALUES (?, ?, 'TEST', 'https://example.com', ?, ?, X'00', ?,
      'TEST', 'test-v1', 'test', ?, 'PARSED', NULL)`,
  ).run(id, id, observedAt, observedAt, `sha256:${id}`, id);
}

function seedCard(
  db: ReturnType<typeof openMarketDatabase>,
  input: { playerId: string; spid: string; price: number; usageShare: number },
): void {
  const instrumentId = `${input.spid}:1`;
  db.prepare("INSERT INTO player(player_id, name) VALUES (?, ?)").run(
    input.playerId,
    input.playerId,
  );
  db.prepare(
    "INSERT INTO player_card(spid, player_id, season) VALUES (?, ?, 'PTG')",
  ).run(input.spid, input.playerId);
  db.prepare(
    "INSERT INTO instrument(instrument_id, spid, grade) VALUES (?, ?, 1)",
  ).run(instrumentId, input.spid);
  source(db, `price-${input.spid}`, "2026-10-01T00:00:00.000Z");
  source(db, `meta-${input.spid}`, "2026-10-01T00:00:00.000Z");
  source(db, `usage-${input.spid}`, "2026-10-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO price_point(
      source_snapshot_id, instrument_id, source_timestamp, observed_at,
      value, currency, price_semantics, quality_status
    ) VALUES (?, ?, '2026-09-30T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
      ?, 'BP', 'MARKET_REFERENCE_PRICE', 'VALID')`,
  ).run(`price-${input.spid}`, instrumentId, input.price);
  db.prepare(
    `INSERT INTO metadata_snapshot(
      metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
      player_name, season_id, season_name, salary, positions_json, ovr,
      stats_json, traits_json, clubs_json, nations_json, team_colors_json,
      completeness
    ) VALUES (?, ?, '2026-10-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z',
      NULL, ?, 863, 'PTG', 20, ?, 120, '{}', '[]', '[]', '[]', ?, 'FULL')`,
  ).run(
    `meta-snapshot-${input.spid}`,
    input.spid,
    input.playerId,
    JSON.stringify([{ name: "RB", ovr: 120, primary: true }]),
    JSON.stringify(["Chelsea", "PTG"]),
  );
  db.prepare(
    `INSERT INTO metadata_snapshot_source(metadata_snapshot_id, source_snapshot_id, source_role)
     VALUES (?, ?, 'DETAIL')`,
  ).run(`meta-snapshot-${input.spid}`, `meta-${input.spid}`);
  db.prepare(
    `INSERT INTO usage_point(
      usage_point_id, subject_type, spid, instrument_id, as_of,
      source_data_date, observation_type, appearances, usage_share,
      position_code, performance_metrics_json, source_snapshot_id
    ) VALUES (?, 'PLAYER_CARD', ?, NULL, '2026-10-01T00:00:00.000Z',
      '2026-10-01', 'DAILY_CHART_CLASS_USAGE', 10, ?, NULL, NULL, ?)`,
  ).run(
    `usage-point-${input.spid}`,
    input.spid,
    input.usageShare,
    `usage-${input.spid}`,
  );
  db.prepare(
    `INSERT INTO cohort_membership(
      cohort_id, instrument_id, valid_from, valid_to, membership_source, confidence
    ) VALUES ('SAMPLE_MARKET:analysis-test', ?, '2026-09-29T00:00:00.000Z',
      NULL, 'TEST', 1)`,
  ).run(instrumentId);
}

function seedDerivedStructure(db: ReturnType<typeof openMarketDatabase>): void {
  db.prepare(
    `INSERT INTO card_relation(
      relation_id, source_instrument, target_instrument, same_player,
      same_position, relation_source, valid_from, valid_to
    ) VALUES ('rel-1', '100:1', '200:1', 0, 1,
      'TEAM_COLOR_POSITION_FULL_METADATA', '2026-09-30T00:00:00.000Z', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO relation_snapshot(
      relation_id, as_of, shared_team_colors_json, salary_diff, ovr_diff,
      stat_distance, price_ratio, usage_distance, movement_similarity,
      definition_version
    ) VALUES ('rel-1', '2026-10-01T00:00:00.000Z', '["Chelsea"]', 0, 0,
      0, 1, 0, NULL, 'test-v1')`,
  ).run();
  db.prepare(
    `INSERT INTO cohort_definition(
      cohort_id, name, aggregation_level, rule_version, rule_params_json
    ) VALUES ('META:test', 'META', 'PLAYER', 'test-v1', '{}')`,
  ).run();
  db.prepare(
    `INSERT INTO cohort_membership(
      cohort_id, instrument_id, valid_from, valid_to, membership_source, confidence
    ) VALUES ('META:test', '100:1', '2026-10-01T00:00:00.000Z', NULL, 'TEST', 1)`,
  ).run();
}

test("applies the dataset snapshot and analysis run migration", async () => {
  const db = await tempDb();
  try {
    assert.equal(MARKET_SCHEMA_VERSION, 8);
    const versions = db
      .prepare("SELECT version FROM schema_migration ORDER BY version")
      .all() as Array<{ version: number }>;
    assert.deepEqual(
      versions.map((row) => row.version),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.deepEqual(countAnalysisDatabase(db), {
      dataset_snapshots: 0,
      analysis_runs: 0,
    });
  } finally {
    db.close();
  }
});

test("freezes only inputs available at the analysis cutoff and preserves source lineage", async () => {
  const db = await tempDb();
  try {
    seedCard(db, { playerId: "p1", spid: "100", price: 100, usageShare: 0.2 });
    seedCard(db, { playerId: "p2", spid: "200", price: 120, usageShare: 0.1 });
    seedDerivedStructure(db);
    source(db, "future-price", "2026-10-02T00:00:00.000Z");
    db.prepare(
      `INSERT INTO price_point(
        source_snapshot_id, instrument_id, source_timestamp, observed_at,
        value, currency, price_semantics, quality_status
      ) VALUES ('future-price', '100:1', '2026-10-02T00:00:00.000Z',
        '2026-10-02T00:00:00.000Z', 999, 'BP', 'MARKET_REFERENCE_PRICE', 'VALID')`,
    ).run();

    const first = createDatasetSnapshot(db, catalog, {
      analysisCutoff: "2026-10-01T12:00:00+09:00",
      createdAt: "2026-10-01T12:01:00+09:00",
      schemaVersion: MARKET_SCHEMA_VERSION,
    });
    const second = createDatasetSnapshot(db, catalog, {
      analysisCutoff: "2026-10-01T12:00:00+09:00",
      createdAt: "2026-10-01T12:02:00+09:00",
      schemaVersion: MARKET_SCHEMA_VERSION,
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.dataset_snapshot_id, second.dataset_snapshot_id);
    assert.deepEqual(first.counts, {
      sources: 6,
      price_points: 2,
      metadata_snapshots: 2,
      usage_points: 2,
      relations: 1,
      cohort_memberships: 3,
      events: 0,
      products: 0,
      rewards: 0,
      exposures: 0,
    });
    const future = db
      .prepare(
        `SELECT 1 AS found
         FROM dataset_snapshot_price_point
         WHERE dataset_snapshot_id = ? AND source_snapshot_id = 'future-price'`,
      )
      .get(first.dataset_snapshot_id);
    assert.equal(future, undefined);
    const lineage = db
      .prepare(
        `SELECT source_role, COUNT(*) AS count
         FROM dataset_snapshot_source
         WHERE dataset_snapshot_id = ?
         GROUP BY source_role
         ORDER BY source_role`,
      )
      .all(first.dataset_snapshot_id);
    assert.deepEqual(
      lineage.map((row) => ({ ...row })),
      [
        { source_role: "METADATA", count: 2 },
        { source_role: "PRICE", count: 2 },
        { source_role: "USAGE", count: 2 },
      ],
    );
  } finally {
    db.close();
  }
});

test("creates an idempotent analysis run from canonical parameters and code commit", async () => {
  const db = await tempDb();
  try {
    seedCard(db, { playerId: "p1", spid: "100", price: 100, usageShare: 0.2 });
    seedCard(db, { playerId: "p2", spid: "200", price: 120, usageShare: 0.1 });
    const snapshot = createDatasetSnapshot(db, catalog, {
      analysisCutoff: "2026-10-01T12:00:00+09:00",
      createdAt: "2026-10-01T12:01:00+09:00",
      schemaVersion: MARKET_SCHEMA_VERSION,
    });
    const parameters = {
      sample_market: { min_coverage_ratio: 0.6, min_valid_count: 10 },
      timezone: "Asia/Seoul",
    };
    assert.equal(
      canonicalJson(parameters),
      canonicalJson({
        timezone: "Asia/Seoul",
        sample_market: { min_valid_count: 10, min_coverage_ratio: 0.6 },
      }),
    );
    const first = createAnalysisRun(db, {
      datasetSnapshotId: snapshot.dataset_snapshot_id,
      analysisVersion: "poc-analysis-v1",
      parameters,
      codeCommit: "8b86d82fa49691d4db66eda07338e0307fcec4e3",
      createdAt: "2026-10-01T12:02:00+09:00",
    });
    const second = createAnalysisRun(db, {
      datasetSnapshotId: snapshot.dataset_snapshot_id,
      analysisVersion: "poc-analysis-v1",
      parameters: {
        timezone: "Asia/Seoul",
        sample_market: { min_valid_count: 10, min_coverage_ratio: 0.6 },
      },
      codeCommit: "8b86d82fa49691d4db66eda07338e0307fcec4e3",
      createdAt: "2026-10-01T12:03:00+09:00",
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.analysis_run_id, second.analysis_run_id);
    assert.equal(first.parameter_hash, second.parameter_hash);
    assert.deepEqual(countAnalysisDatabase(db), {
      dataset_snapshots: 1,
      analysis_runs: 1,
    });
  } finally {
    db.close();
  }
});
