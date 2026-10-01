import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildMarketUniverseSnapshot } from "../src/benchmark/universe.ts";
import {
  OPENAPI_METADATA_URLS,
  type OpenApiMetadataArtifact,
} from "../src/collect/openapi-metadata.ts";
import { openMarketDatabase } from "../src/db/market-db.ts";

const observedAt = "2026-10-01T06:00:00.000Z";
const spidRaw = Buffer.from(JSON.stringify([
  { id: 851000001, name: "선수 A" },
  { id: 863000001, name: "선수 A" },
  { id: 863000002, name: "선수 B" },
  { id: 863000003, name: "선수 C" },
]));
const seasonRaw = Buffer.from(JSON.stringify([
  { seasonId: 851, className: "26TOTS" },
  { seasonId: 863, className: "PTG" },
]));
const positionRaw = Buffer.from("[]");

const artifacts: OpenApiMetadataArtifact[] = [
  {
    kind: "spid",
    source_url: OPENAPI_METADATA_URLS.spid,
    observed_at: observedAt,
    raw: spidRaw,
  },
  {
    kind: "season",
    source_url: OPENAPI_METADATA_URLS.season,
    observed_at: observedAt,
    raw: seasonRaw,
  },
  {
    kind: "position",
    source_url: OPENAPI_METADATA_URLS.position,
    observed_at: observedAt,
    raw: positionRaw,
  },
];

function sha256(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function metadataSource(
  db: DatabaseSync,
  kind: "spid" | "season",
  raw: Buffer,
): void {
  db.prepare(
    `INSERT INTO source_snapshot(
      source_snapshot_id, source_id, source_type, source_url,
      source_timestamp, observed_at, raw_payload, raw_hash,
      capture_method, collector_version, policy_evidence_id,
      source_ref, parse_status, parse_error
    ) VALUES (?, ?, 'OPEN_API_STATIC_METADATA', ?, ?, ?, ?, ?,
      'OFFICIAL_OPEN_API_STATIC', 'openapi-metadata-v1',
      'nexon-open-api-current-terms', ?, 'PARSED', NULL)`,
  ).run(
    `meta-${kind}`,
    `nexon-open-api-${kind}-metadata`,
    OPENAPI_METADATA_URLS[kind],
    observedAt,
    observedAt,
    raw,
    sha256(raw),
    kind,
  );
}

function priceSource(db: DatabaseSync, id: string, instrumentId: string): void {
  db.prepare(
    `INSERT INTO source_snapshot(
      source_snapshot_id, source_id, source_type, source_url,
      source_timestamp, observed_at, raw_payload, raw_hash,
      capture_method, collector_version, policy_evidence_id,
      source_ref, parse_status, parse_error
    ) VALUES (?, 'test-price', 'PRICE_HISTORY', 'https://example.com',
      '2026-10-01T00:00:00.000Z', ?, X'00', ?,
      'TEST', 'test-v1', 'test', ?, 'PARSED', NULL)`,
  ).run(id, observedAt, `sha256:${id}`, instrumentId);
}

function pricePoint(
  db: DatabaseSync,
  input: {
    sourceId: string;
    instrumentId: string;
    sourceTimestamp: string;
    value: number;
  },
): void {
  db.prepare(
    `INSERT INTO price_point(
      source_snapshot_id, instrument_id, source_timestamp, observed_at,
      value, currency, price_semantics, quality_status
    ) VALUES (?, ?, ?, ?, ?, 'BP', 'MARKET_REFERENCE_PRICE', 'VALID')`,
  ).run(
    input.sourceId,
    input.instrumentId,
    input.sourceTimestamp,
    observedAt,
    input.value,
  );
}

function fixtureDb(): DatabaseSync {
  const db = openMarketDatabase(":memory:");
  metadataSource(db, "spid", spidRaw);
  metadataSource(db, "season", seasonRaw);

  for (const [instrumentId, spid, grade] of [
    ["851000001:1", "851000001", 1],
    ["863000001:1", "863000001", 1],
    ["863000002:1", "863000002", 1],
    ["999999999:1", "999999999", 1],
  ] as const) {
    db.prepare(
      "INSERT INTO instrument(instrument_id, spid, grade) VALUES (?, ?, ?)",
    ).run(instrumentId, spid, grade);
    priceSource(db, `price-${instrumentId}`, instrumentId);
  }

  pricePoint(db, {
    sourceId: "price-851000001:1",
    instrumentId: "851000001:1",
    sourceTimestamp: "2026-09-28T00:00:00.000Z",
    value: 100,
  });
  pricePoint(db, {
    sourceId: "price-851000001:1",
    instrumentId: "851000001:1",
    sourceTimestamp: "2026-09-29T00:00:00.000Z",
    value: 110,
  });
  pricePoint(db, {
    sourceId: "price-851000001:1",
    instrumentId: "851000001:1",
    sourceTimestamp: "2026-09-30T00:00:00.000Z",
    value: 120,
  });
  pricePoint(db, {
    sourceId: "price-863000001:1",
    instrumentId: "863000001:1",
    sourceTimestamp: "2026-09-29T00:00:00.000Z",
    value: 200,
  });
  pricePoint(db, {
    sourceId: "price-863000001:1",
    instrumentId: "863000001:1",
    sourceTimestamp: "2026-09-30T00:00:00.000Z",
    value: 210,
  });
  pricePoint(db, {
    sourceId: "price-863000002:1",
    instrumentId: "863000002:1",
    sourceTimestamp: "2026-09-10T00:00:00.000Z",
    value: 300,
  });
  pricePoint(db, {
    sourceId: "price-999999999:1",
    instrumentId: "999999999:1",
    sourceTimestamp: "2026-09-30T00:00:00.000Z",
    value: 400,
  });
  return db;
}

test("builds a deterministic player universe from official PID identity", () => {
  const db = fixtureDb();
  try {
    const first = buildMarketUniverseSnapshot(db, {
      artifacts,
      asOf: observedAt,
      createdAt: "2026-10-01T06:01:00.000Z",
      priceMaxAgeDays: 7,
    });
    const second = buildMarketUniverseSnapshot(db, {
      artifacts,
      asOf: observedAt,
      createdAt: "2026-10-01T06:02:00.000Z",
      priceMaxAgeDays: 7,
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.universe_snapshot_id, first.universe_snapshot_id);
    assert.equal(first.catalog_player_count, 3);
    assert.equal(first.catalog_card_count, 4);
    assert.equal(first.observed_instrument_count, 3);
    assert.equal(first.price_eligible_player_count, 1);
    assert.equal(first.price_eligible_instrument_count, 2);

    const members = db
      .prepare(
        `SELECT player_id, player_name, catalog_card_count,
                observed_instrument_count, eligible_instrument_count,
                price_eligible, anchor_instrument_id, anchor_price,
                anchor_history_count
         FROM market_universe_member
         WHERE universe_snapshot_id = ?
         ORDER BY player_id`,
      )
      .all(first.universe_snapshot_id)
      .map((row) => ({ ...row }));
    assert.deepEqual(members, [
      {
        player_id: "pid:000001",
        player_name: "선수 A",
        catalog_card_count: 2,
        observed_instrument_count: 2,
        eligible_instrument_count: 2,
        price_eligible: 1,
        anchor_instrument_id: "851000001:1",
        anchor_price: 120,
        anchor_history_count: 3,
      },
      {
        player_id: "pid:000002",
        player_name: "선수 B",
        catalog_card_count: 1,
        observed_instrument_count: 1,
        eligible_instrument_count: 0,
        price_eligible: 0,
        anchor_instrument_id: null,
        anchor_price: null,
        anchor_history_count: null,
      },
      {
        player_id: "pid:000003",
        player_name: "선수 C",
        catalog_card_count: 1,
        observed_instrument_count: 0,
        eligible_instrument_count: 0,
        price_eligible: 0,
        anchor_instrument_id: null,
        anchor_price: null,
        anchor_history_count: null,
      },
    ]);

    const cards = db
      .prepare(
        `SELECT player_id, spid, season_id, season_name
         FROM market_universe_card
         WHERE universe_snapshot_id = ?
         ORDER BY spid`,
      )
      .all(first.universe_snapshot_id)
      .map((row) => ({ ...row }));
    assert.deepEqual(cards, [
      { player_id: "pid:000001", spid: "851000001", season_id: 851, season_name: "26TOTS" },
      { player_id: "pid:000001", spid: "863000001", season_id: 863, season_name: "PTG" },
      { player_id: "pid:000002", spid: "863000002", season_id: 863, season_name: "PTG" },
      { player_id: "pid:000003", spid: "863000003", season_id: 863, season_name: "PTG" },
    ]);

    const instruments = db
      .prepare(
        `SELECT instrument_id, player_id, price_eligible
         FROM market_universe_instrument
         WHERE universe_snapshot_id = ?
         ORDER BY instrument_id`,
      )
      .all(first.universe_snapshot_id)
      .map((row) => ({ ...row }));
    assert.deepEqual(instruments, [
      { instrument_id: "851000001:1", player_id: "pid:000001", price_eligible: 1 },
      { instrument_id: "863000001:1", player_id: "pid:000001", price_eligible: 1 },
      { instrument_id: "863000002:1", player_id: "pid:000002", price_eligible: 0 },
    ]);

    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM player").get()!.count,
      0,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM player_card").get()!.count,
      0,
    );
  } finally {
    db.close();
  }
});

test("rejects metadata without persisted source provenance", () => {
  const db = openMarketDatabase(":memory:");
  try {
    assert.throws(
      () =>
        buildMarketUniverseSnapshot(db, {
          artifacts,
          asOf: observedAt,
          createdAt: "2026-10-01T06:01:00.000Z",
        }),
      /source snapshot is unavailable/,
    );
  } finally {
    db.close();
  }
});

test("rejects future metadata when building a historical universe", () => {
  const db = fixtureDb();
  try {
    assert.throws(
      () =>
        buildMarketUniverseSnapshot(db, {
          artifacts,
          asOf: "2026-09-30T00:00:00.000Z",
          createdAt: "2026-10-01T06:01:00.000Z",
        }),
      /metadata observed_at must not be after/,
    );
  } finally {
    db.close();
  }
});
