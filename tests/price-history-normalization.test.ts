import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { countPriceDatabase, openMarketDatabase } from "../src/db/market-db.ts";
import { indexRawPriceFilesByHash } from "../src/ingest/raw-price-files.ts";
import { normalizePriceHistorySnapshot } from "../src/normalize/price-history.ts";

const raw = Buffer.from(`
<script>
var json1 = {
  "time": ["9.28", "9.29",],
  "value": ["1000000", "1100000",],
}
</script>
`);
const rawHash = `sha256:${createHash("sha256").update(raw).digest("hex")}`;

const seed = {
  player_key: "test-player",
  player_name: "테스트 선수",
  primary_instrument: { spid: "863000001", grade: 1 },
  selection_observation: {
    section: "CLASS_USAGE" as const,
    ranker_squad_count: 1,
    displayed_share_percent: 1,
  },
  selection_reason: "fixture",
};

const expected = {
  spid: "863000001",
  grade: 1,
  class_code: "PTG",
  observed_at: "2026-09-30T05:00:00.000Z",
  raw_sha256: rawHash,
  point_count: 2,
  first_source_date: "2026-09-28",
  last_source_date: "2026-09-29",
  observed_span_days: 1,
  native_granularity: "P1D",
};

async function tempDb() {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-db-"));
  return openMarketDatabase(join(directory, "market.db"), {
    migrationPath: "db/migrations/001_price_history.sql",
  });
}

test("normalizes one raw price snapshot with full provenance", async () => {
  const db = await tempDb();
  try {
    const result = normalizePriceHistorySnapshot(db, {
      seed,
      expected,
      raw,
      source_id: "fconline-datacenter-price-history",
      capture_method: "OFFICIAL_WEB_UI_MANUAL_CAPTURE",
    });

    assert.equal(result.source_snapshot_created, true);
    assert.equal(result.price_points_inserted, 2);
    assert.deepEqual(countPriceDatabase(db), {
      players: 1,
      player_cards: 1,
      instruments: 1,
      source_snapshots: 1,
      price_points: 2,
    });

    const snapshot = db
      .prepare(
        `SELECT raw_payload, raw_hash, parse_status, source_ref
         FROM source_snapshot WHERE source_snapshot_id = ?`,
      )
      .get(result.source_snapshot_id) as
      | {
          raw_payload: Uint8Array;
          raw_hash: string;
          parse_status: string;
          source_ref: string;
        }
      | undefined;
    assert.ok(snapshot);
    assert.equal(
      Buffer.from(snapshot.raw_payload).toString("utf8"),
      raw.toString("utf8"),
    );
    assert.equal(snapshot.raw_hash, rawHash);
    assert.equal(snapshot.parse_status, "PARSED");
    assert.equal(snapshot.source_ref, "863000001:1");

    const points = db
      .prepare(
        `SELECT source_timestamp, value, currency, price_semantics, quality_status
         FROM price_point ORDER BY source_timestamp`,
      )
      .all()
      .map((point) => ({ ...point }));
    assert.deepEqual(points, [
      {
        source_timestamp: "2026-09-28T00:00:00.000Z",
        value: 1000000,
        currency: "BP",
        price_semantics: "MARKET_REFERENCE_PRICE",
        quality_status: "VALID",
      },
      {
        source_timestamp: "2026-09-29T00:00:00.000Z",
        value: 1100000,
        currency: "BP",
        price_semantics: "MARKET_REFERENCE_PRICE",
        quality_status: "VALID",
      },
    ]);
  } finally {
    db.close();
  }
});

test("re-ingesting the same raw snapshot is idempotent", async () => {
  const db = await tempDb();
  try {
    const first = normalizePriceHistorySnapshot(db, {
      seed,
      expected,
      raw,
      source_id: "fconline-datacenter-price-history",
      capture_method: "OFFICIAL_WEB_UI_MANUAL_CAPTURE",
    });
    const second = normalizePriceHistorySnapshot(db, {
      seed,
      expected,
      raw,
      source_id: "fconline-datacenter-price-history",
      capture_method: "OFFICIAL_WEB_UI_MANUAL_CAPTURE",
    });

    assert.equal(first.source_snapshot_created, true);
    assert.equal(second.source_snapshot_created, false);
    assert.equal(second.price_points_inserted, 0);
    assert.deepEqual(countPriceDatabase(db), {
      players: 1,
      player_cards: 1,
      instruments: 1,
      source_snapshots: 1,
      price_points: 2,
    });
  } finally {
    db.close();
  }
});

test("rejects raw data that does not match committed Gate 0B evidence", async () => {
  const db = await tempDb();
  try {
    assert.throws(
      () =>
        normalizePriceHistorySnapshot(db, {
          seed,
          expected: { ...expected, raw_sha256: `sha256:${"0".repeat(64)}` },
          raw,
          source_id: "fconline-datacenter-price-history",
          capture_method: "OFFICIAL_WEB_UI_MANUAL_CAPTURE",
        }),
      /raw hash mismatch/,
    );
    assert.deepEqual(countPriceDatabase(db), {
      players: 0,
      player_cards: 0,
      instruments: 0,
      source_snapshots: 0,
      price_points: 0,
    });
  } finally {
    db.close();
  }
});

test("indexes raw captures by SHA-256 instead of relying on filenames", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-raw-"));
  const nested = join(directory, "2026-09-30");
  await mkdir(nested, { recursive: true });
  const path = join(nested, "arbitrary-name.html");
  await writeFile(path, raw);

  const index = await indexRawPriceFilesByHash(directory);
  assert.equal(index.get(rawHash)?.path, path);
  assert.equal(index.get(rawHash)?.raw_sha256, rawHash);
});
