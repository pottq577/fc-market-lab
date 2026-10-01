import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  countMarketAnnotationDatabase,
  MARKET_SCHEMA_VERSION,
  openMarketDatabase,
} from "../src/db/market-db.ts";
import { parseMarketAnnotationDocument } from "../src/evidence/market-annotations.ts";
import { normalizeMarketAnnotations } from "../src/normalize/market-annotations.ts";

async function tempDb() {
  const directory = await mkdtemp(join(tmpdir(), "fc-market-annotations-db-"));
  return openMarketDatabase(join(directory, "market.db"));
}

function annotationDocument(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    annotated_at: "2026-10-01T09:00:00+09:00",
    events: [
      {
        event_id: "market-rule-2026-09-10",
        event_type: "MARKET_RULE_CHANGE",
        title: "기준가 변동 규칙 임시 변경",
        announced_at: "2026-09-10T15:00:00+09:00",
        effective_at: "2026-09-10T15:30:00+09:00",
        ended_at: "2026-09-11T00:00:00+09:00",
        first_observed_at: null,
        source_url: "https://fconline.nexon.com/news/notice/view?n4ArticleSN=6264",
        confidence: 1,
        notes: "공식 공지 수동 annotation",
      },
    ],
    products: [
      {
        product_id: "sss-mortar-top-price-730",
        name: "UC, SPT, WG, 26FSL 포함 Top Price 730 선수팩",
        sale_start: "2026-09-17T11:15:00+09:00",
        sale_end: "2026-09-18T00:00:00+09:00",
        price: 20,
        currency: "PREMIUM_COIN",
        purchase_limit: 2,
        channel: "SPECIAL_WEB_SHOP",
        source_url: "https://fconline.nexon.com/news/notice/view?n4ArticleSN=6276",
        notes: "PoC fixture",
        rewards: [
          {
            reward_id: "sss-mortar-top-price-730-pack",
            reward_type: "PLAYER_PACK",
            quantity: 1,
            probability: null,
            class_filter: ["UC", "SPT", "WG", "26FSL"],
            grade_min: 8,
            grade_max: 11,
            ovr_min: 117,
            top_price_n: 730,
          },
        ],
      },
    ],
    exposures: [
      {
        exposure_id: "sss-direct-863239231-g8",
        event_id: null,
        product_id: "sss-mortar-top-price-730",
        instrument_id: "863239231:8",
        exposure_type: "DIRECT",
        valid_from: "2026-09-17T11:15:00+09:00",
        valid_to: "2026-09-18T00:00:00+09:00",
        source: "MANUAL_REWARD_MATCH",
        confidence: 0.9,
      },
    ],
    ...overrides,
  };
}

function seedInstrument(
  db: ReturnType<typeof openMarketDatabase>,
  grade = 8,
  season = "UC",
): void {
  db.prepare("INSERT INTO player(player_id, name) VALUES ('p1', '선수')").run();
  db.prepare(
    "INSERT INTO player_card(spid, player_id, season) VALUES ('863239231', 'p1', ?)",
  ).run(season);
  db.prepare(
    "INSERT INTO instrument(instrument_id, spid, grade) VALUES (?, '863239231', ?)",
  ).run(`863239231:${grade}`, grade);
}

test("applies the market annotation migration", async () => {
  const db = await tempDb();
  try {
    const versions = db
      .prepare("SELECT version FROM schema_migration ORDER BY version")
      .all() as Array<{ version: number }>;
    assert.equal(MARKET_SCHEMA_VERSION, 8);
    assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(countMarketAnnotationDatabase(db), {
      events: 0,
      products: 0,
      rewards: 0,
      exposures: 0,
    });
  } finally {
    db.close();
  }
});

test("parses manual annotations and normalizes timestamps to UTC", () => {
  const document = parseMarketAnnotationDocument(annotationDocument());
  assert.equal(document.annotated_at, "2026-10-01T00:00:00.000Z");
  assert.equal(document.events[0]!.effective_at, "2026-09-10T06:30:00.000Z");
  assert.equal(document.products[0]!.sale_end, "2026-09-17T15:00:00.000Z");
  assert.equal(document.exposures[0]!.confidence, 0.9);
});

test("ingests event, product, reward, and exposure idempotently with provenance", async () => {
  const db = await tempDb();
  try {
    seedInstrument(db);
    const document = parseMarketAnnotationDocument(annotationDocument());
    const first = normalizeMarketAnnotations(db, document);
    const second = normalizeMarketAnnotations(db, document);

    assert.deepEqual(first, {
      source_snapshots_created: 2,
      events_created: 1,
      products_created: 1,
      rewards_created: 1,
      exposures_created: 1,
    });
    assert.deepEqual(second, {
      source_snapshots_created: 0,
      events_created: 0,
      products_created: 0,
      rewards_created: 0,
      exposures_created: 0,
    });
    assert.deepEqual(countMarketAnnotationDatabase(db), {
      events: 1,
      products: 1,
      rewards: 1,
      exposures: 1,
    });

    const event = db
      .prepare(
        `SELECT event_type, effective_at, source_snapshot_id, confidence
         FROM event WHERE event_id = 'market-rule-2026-09-10'`,
      )
      .get() as Record<string, unknown>;
    assert.equal(event.event_type, "MARKET_RULE_CHANGE");
    assert.equal(event.effective_at, "2026-09-10T06:30:00.000Z");
    assert.equal(event.confidence, 1);

    const source = db
      .prepare(
        `SELECT source_type, capture_method, source_url, source_ref
         FROM source_snapshot WHERE source_snapshot_id = ?`,
      )
      .get(event.source_snapshot_id) as Record<string, unknown>;
    assert.deepEqual({ ...source }, {
      source_type: "MANUAL_ANNOTATION",
      capture_method: "MANUAL_ANNOTATION",
      source_url: "https://fconline.nexon.com/news/notice/view?n4ArticleSN=6264",
      source_ref: "event:market-rule-2026-09-10",
    });
  } finally {
    db.close();
  }
});

test("rejects immutable annotation redefinition and rolls the transaction back", async () => {
  const db = await tempDb();
  try {
    seedInstrument(db);
    normalizeMarketAnnotations(db, parseMarketAnnotationDocument(annotationDocument()));
    const changed = annotationDocument({
      events: [
        {
          ...annotationDocument().events[0],
          title: "변경된 제목",
        },
      ],
      products: [],
      exposures: [],
    });
    assert.throws(
      () => normalizeMarketAnnotations(db, parseMarketAnnotationDocument(changed)),
      /event market-rule-2026-09-10 conflicts/,
    );
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM source_snapshot")
      .get() as { count: number | bigint };
    assert.equal(Number(count.count), 2);
  } finally {
    db.close();
  }
});

test("rejects exposure to an unknown instrument", async () => {
  const db = await tempDb();
  try {
    const document = parseMarketAnnotationDocument(annotationDocument());
    assert.throws(
      () => normalizeMarketAnnotations(db, document),
      /references missing instrument 863239231:8/,
    );
    assert.deepEqual(countMarketAnnotationDatabase(db), {
      events: 0,
      products: 0,
      rewards: 0,
      exposures: 0,
    });
    const sources = db
      .prepare("SELECT COUNT(*) AS count FROM source_snapshot")
      .get() as { count: number | bigint };
    assert.equal(Number(sources.count), 0);
  } finally {
    db.close();
  }
});

test("rejects direct product exposure outside the reward class or grade filters", async () => {
  const db = await tempDb();
  try {
    seedInstrument(db, 1, "UC");
    const input = annotationDocument();
    input.exposures[0]!.instrument_id = "863239231:1";
    assert.throws(
      () => normalizeMarketAnnotations(db, parseMarketAnnotationDocument(input)),
      /does not match any player reward class\/grade filter/,
    );
    assert.deepEqual(countMarketAnnotationDatabase(db), {
      events: 0,
      products: 0,
      rewards: 0,
      exposures: 0,
    });
  } finally {
    db.close();
  }
});

test("requires explicit timezone for replay-relevant timestamps", () => {
  const input = annotationDocument();
  input.events[0]!.effective_at = "2026-09-10T15:30:00";
  assert.throws(
    () => parseMarketAnnotationDocument(input),
    /effective_at must include an explicit timezone/,
  );
});
