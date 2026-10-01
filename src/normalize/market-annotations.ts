import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  ExposureAnnotation,
  MarketAnnotationDocument,
  MarketEventAnnotation,
  ProductAnnotation,
  ProductRewardAnnotation,
} from "../evidence/market-annotations.ts";

export interface NormalizeMarketAnnotationsResult {
  source_snapshots_created: number;
  events_created: number;
  products_created: number;
  rewards_created: number;
  exposures_created: number;
}

function sha256(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

function sameScalar(actual: unknown, expected: unknown): boolean {
  if (actual === expected) {
    return true;
  }
  return typeof actual === "bigint" && typeof expected === "number"
    ? Number(actual) === expected
    : false;
}

function assertImmutableRow(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
  context: string,
): void {
  if (!actual) {
    throw new Error(`${context} was not persisted`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!sameScalar(actual[key], value)) {
      throw new TypeError(`${context} conflicts with the existing ${key}`);
    }
  }
}

function insertAnnotationSource(
  db: DatabaseSync,
  input: {
    sourceId: string;
    sourceRef: string;
    sourceUrl: string;
    sourceTimestamp: string;
    observedAt: string;
    payload: unknown;
  },
): { sourceSnapshotId: string; created: boolean } {
  const raw = Buffer.from(`${JSON.stringify(input.payload, null, 2)}\n`, "utf8");
  const rawHash = sha256(raw);
  const sourceSnapshotId = deterministicId(
    "src",
    input.sourceId,
    input.sourceRef,
    input.observedAt,
    rawHash,
  );
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO source_snapshot(
        source_snapshot_id, source_id, source_type, source_url,
        source_timestamp, observed_at, raw_payload, raw_hash,
        capture_method, collector_version, policy_evidence_id,
        source_ref, parse_status, parse_error
      ) VALUES (?, ?, 'MANUAL_ANNOTATION', ?, ?, ?, ?, ?,
        'MANUAL_ANNOTATION', 'market-annotations-v1',
        'human-reviewed-official-source', ?, 'PARSED', NULL)`,
    )
    .run(
      sourceSnapshotId,
      input.sourceId,
      input.sourceUrl,
      input.sourceTimestamp,
      input.observedAt,
      raw,
      rawHash,
      input.sourceRef,
    );
  return {
    sourceSnapshotId,
    created: Number(inserted.changes) === 1,
  };
}

function insertEvent(
  db: DatabaseSync,
  event: MarketEventAnnotation,
  annotatedAt: string,
): { sourceCreated: boolean; rowCreated: boolean } {
  const source = insertAnnotationSource(db, {
    sourceId: "manual-market-event",
    sourceRef: `event:${event.event_id}`,
    sourceUrl: event.source_url,
    sourceTimestamp: event.announced_at ?? event.effective_at ?? event.first_observed_at!,
    observedAt: annotatedAt,
    payload: event,
  });
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO event(
        event_id, event_type, title, announced_at, effective_at, ended_at,
        first_observed_at, source_snapshot_id, confidence, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.event_id,
      event.event_type,
      event.title,
      event.announced_at,
      event.effective_at,
      event.ended_at,
      event.first_observed_at,
      source.sourceSnapshotId,
      event.confidence,
      event.notes,
    );
  const expected = {
    event_type: event.event_type,
    title: event.title,
    announced_at: event.announced_at,
    effective_at: event.effective_at,
    ended_at: event.ended_at,
    first_observed_at: event.first_observed_at,
    source_snapshot_id: source.sourceSnapshotId,
    confidence: event.confidence,
    notes: event.notes,
  };
  const actual = db
    .prepare(
      `SELECT event_type, title, announced_at, effective_at, ended_at,
              first_observed_at, source_snapshot_id, confidence, notes
       FROM event WHERE event_id = ?`,
    )
    .get(event.event_id) as Record<string, unknown> | undefined;
  assertImmutableRow(actual, expected, `event ${event.event_id}`);
  return {
    sourceCreated: source.created,
    rowCreated: Number(inserted.changes) === 1,
  };
}

function insertProduct(
  db: DatabaseSync,
  product: ProductAnnotation,
  annotatedAt: string,
): { sourceCreated: boolean; rowCreated: boolean } {
  const source = insertAnnotationSource(db, {
    sourceId: "manual-market-product",
    sourceRef: `product:${product.product_id}`,
    sourceUrl: product.source_url,
    sourceTimestamp: product.sale_start,
    observedAt: annotatedAt,
    payload: product,
  });
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO product(
        product_id, name, sale_start, sale_end, price, currency,
        purchase_limit, channel, source_snapshot_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      product.product_id,
      product.name,
      product.sale_start,
      product.sale_end,
      product.price,
      product.currency,
      product.purchase_limit,
      product.channel,
      source.sourceSnapshotId,
      product.notes,
    );
  const expected = {
    name: product.name,
    sale_start: product.sale_start,
    sale_end: product.sale_end,
    price: product.price,
    currency: product.currency,
    purchase_limit: product.purchase_limit,
    channel: product.channel,
    source_snapshot_id: source.sourceSnapshotId,
    notes: product.notes,
  };
  const actual = db
    .prepare(
      `SELECT name, sale_start, sale_end, price, currency, purchase_limit,
              channel, source_snapshot_id, notes
       FROM product WHERE product_id = ?`,
    )
    .get(product.product_id) as Record<string, unknown> | undefined;
  assertImmutableRow(actual, expected, `product ${product.product_id}`);
  return {
    sourceCreated: source.created,
    rowCreated: Number(inserted.changes) === 1,
  };
}

function insertReward(
  db: DatabaseSync,
  productId: string,
  reward: ProductRewardAnnotation,
): boolean {
  const classFilterJson = reward.class_filter.length > 0
    ? JSON.stringify(reward.class_filter)
    : null;
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO reward(
        reward_id, product_id, reward_type, quantity, probability,
        class_filter_json, grade_min, grade_max, ovr_min, top_price_n
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      reward.reward_id,
      productId,
      reward.reward_type,
      reward.quantity,
      reward.probability,
      classFilterJson,
      reward.grade_min,
      reward.grade_max,
      reward.ovr_min,
      reward.top_price_n,
    );
  const expected = {
    product_id: productId,
    reward_type: reward.reward_type,
    quantity: reward.quantity,
    probability: reward.probability,
    class_filter_json: classFilterJson,
    grade_min: reward.grade_min,
    grade_max: reward.grade_max,
    ovr_min: reward.ovr_min,
    top_price_n: reward.top_price_n,
  };
  const actual = db
    .prepare(
      `SELECT product_id, reward_type, quantity, probability,
              class_filter_json, grade_min, grade_max, ovr_min, top_price_n
       FROM reward WHERE reward_id = ?`,
    )
    .get(reward.reward_id) as Record<string, unknown> | undefined;
  assertImmutableRow(actual, expected, `reward ${reward.reward_id}`);
  return Number(inserted.changes) === 1;
}

function assertReferenceExists(
  db: DatabaseSync,
  table: "event" | "product" | "instrument",
  column: string,
  value: string,
  context: string,
): void {
  const row = db.prepare(`SELECT 1 AS found FROM ${table} WHERE ${column} = ?`).get(value);
  if (!row) {
    throw new TypeError(`${context} references missing ${table} ${value}`);
  }
}

function insertExposure(db: DatabaseSync, exposure: ExposureAnnotation): boolean {
  assertReferenceExists(
    db,
    "instrument",
    "instrument_id",
    exposure.instrument_id,
    `exposure ${exposure.exposure_id}`,
  );
  if (exposure.event_id) {
    assertReferenceExists(
      db,
      "event",
      "event_id",
      exposure.event_id,
      `exposure ${exposure.exposure_id}`,
    );
  }
  if (exposure.product_id) {
    assertReferenceExists(
      db,
      "product",
      "product_id",
      exposure.product_id,
      `exposure ${exposure.exposure_id}`,
    );
  }

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO exposure(
        exposure_id, event_id, product_id, instrument_id, exposure_type,
        valid_from, valid_to, source, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      exposure.exposure_id,
      exposure.event_id,
      exposure.product_id,
      exposure.instrument_id,
      exposure.exposure_type,
      exposure.valid_from,
      exposure.valid_to,
      exposure.source,
      exposure.confidence,
    );
  const expected = {
    event_id: exposure.event_id,
    product_id: exposure.product_id,
    instrument_id: exposure.instrument_id,
    exposure_type: exposure.exposure_type,
    valid_from: exposure.valid_from,
    valid_to: exposure.valid_to,
    source: exposure.source,
    confidence: exposure.confidence,
  };
  const actual = db
    .prepare(
      `SELECT event_id, product_id, instrument_id, exposure_type,
              valid_from, valid_to, source, confidence
       FROM exposure WHERE exposure_id = ?`,
    )
    .get(exposure.exposure_id) as Record<string, unknown> | undefined;
  assertImmutableRow(actual, expected, `exposure ${exposure.exposure_id}`);
  return Number(inserted.changes) === 1;
}

export function normalizeMarketAnnotations(
  db: DatabaseSync,
  document: MarketAnnotationDocument,
): NormalizeMarketAnnotationsResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    let sourceSnapshotsCreated = 0;
    let eventsCreated = 0;
    let productsCreated = 0;
    let rewardsCreated = 0;
    let exposuresCreated = 0;

    for (const event of document.events) {
      const result = insertEvent(db, event, document.annotated_at);
      sourceSnapshotsCreated += result.sourceCreated ? 1 : 0;
      eventsCreated += result.rowCreated ? 1 : 0;
    }
    for (const product of document.products) {
      const result = insertProduct(db, product, document.annotated_at);
      sourceSnapshotsCreated += result.sourceCreated ? 1 : 0;
      productsCreated += result.rowCreated ? 1 : 0;
      for (const reward of product.rewards) {
        rewardsCreated += insertReward(db, product.product_id, reward) ? 1 : 0;
      }
    }
    for (const exposure of document.exposures) {
      exposuresCreated += insertExposure(db, exposure) ? 1 : 0;
    }

    db.exec("COMMIT");
    return {
      source_snapshots_created: sourceSnapshotsCreated,
      events_created: eventsCreated,
      products_created: productsCreated,
      rewards_created: rewardsCreated,
      exposures_created: exposuresCreated,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
