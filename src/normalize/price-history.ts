import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { SeedPlayer } from "../catalog/seed-catalog.ts";
import {
  buildDatacenterPriceCaptureEvidence,
  parseDatacenterPriceGraph,
} from "../evidence/datacenter-price-history.ts";
import type { CoverageSnapshot } from "../gates/coverage-viability.ts";

export interface NormalizePriceHistoryInput {
  seed: SeedPlayer;
  expected: CoverageSnapshot;
  raw: Buffer;
  source_id: string;
  capture_method: string;
}

const NORMALIZER_VERSION = "datacenter-price-history-v1";

export interface NormalizePriceHistoryResult {
  source_snapshot_id: string;
  instrument_id: string;
  source_snapshot_created: boolean;
  price_points_inserted: number;
  point_count: number;
}

function sourceDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function sourceSnapshotId(input: {
  source_id: string;
  instrument_id: string;
  observed_at: string;
  raw_sha256: string;
}): string {
  const digest = createHash("sha256")
    .update(input.source_id)
    .update("\0")
    .update(input.instrument_id)
    .update("\0")
    .update(input.observed_at)
    .update("\0")
    .update(input.raw_sha256)
    .digest("hex");
  return `src_${digest}`;
}

function assertExpectedSnapshot(
  seed: SeedPlayer,
  expected: CoverageSnapshot,
): void {
  if (
    expected.spid !== seed.primary_instrument.spid ||
    expected.grade !== seed.primary_instrument.grade
  ) {
    throw new TypeError(
      `coverage snapshot ${expected.spid}:${expected.grade} does not match seed primary instrument ` +
        `${seed.primary_instrument.spid}:${seed.primary_instrument.grade}`,
    );
  }
  if (!expected.raw_sha256) {
    throw new TypeError("coverage snapshot must include raw_sha256");
  }
  if (!expected.class_code) {
    throw new TypeError("coverage snapshot must include class_code");
  }
}

export function normalizePriceHistorySnapshot(
  db: DatabaseSync,
  input: NormalizePriceHistoryInput,
): NormalizePriceHistoryResult {
  assertExpectedSnapshot(input.seed, input.expected);

  const rawText = input.raw.toString("utf8");
  const byteHash =
    `sha256:${createHash("sha256").update(input.raw).digest("hex")}`;
  if (byteHash !== input.expected.raw_sha256) {
    throw new TypeError(
      `raw hash mismatch for ${input.seed.primary_instrument.spid}:${input.seed.primary_instrument.grade}: ` +
        `${byteHash} != ${input.expected.raw_sha256}`,
    );
  }

  const evidence = buildDatacenterPriceCaptureEvidence({
    raw: rawText,
    spid: input.seed.primary_instrument.spid,
    grade: input.seed.primary_instrument.grade,
    observed_at: input.expected.observed_at,
  });
  const points = parseDatacenterPriceGraph(rawText, input.expected.observed_at);

  if (evidence.raw_sha256 !== byteHash) {
    throw new TypeError(
      `decoded raw hash ${evidence.raw_sha256} does not match byte hash ${byteHash}`,
    );
  }
  if (evidence.point_count !== input.expected.point_count) {
    throw new TypeError(
      `point_count ${evidence.point_count} != expected ${input.expected.point_count}`,
    );
  }
  if (evidence.first_source_date !== input.expected.first_source_date) {
    throw new TypeError(
      `first_source_date ${evidence.first_source_date} != expected ${input.expected.first_source_date}`,
    );
  }
  if (evidence.last_source_date !== input.expected.last_source_date) {
    throw new TypeError(
      `last_source_date ${evidence.last_source_date} != expected ${input.expected.last_source_date}`,
    );
  }
  if (evidence.native_granularity !== input.expected.native_granularity) {
    throw new TypeError(
      `native_granularity ${evidence.native_granularity} != expected ${input.expected.native_granularity}`,
    );
  }
  if (evidence.observed_span_days !== input.expected.observed_span_days) {
    throw new TypeError(
      `observed_span_days ${evidence.observed_span_days} != expected ${input.expected.observed_span_days}`,
    );
  }

  const instrumentId =
    `${input.seed.primary_instrument.spid}:${input.seed.primary_instrument.grade}`;
  const snapshotId = sourceSnapshotId({
    source_id: input.source_id,
    instrument_id: instrumentId,
    observed_at: input.expected.observed_at,
    raw_sha256: byteHash,
  });
  const sourceUrl =
    `https://fconline.nexon.com/DataCenter/PlayerInfo?spid=${input.seed.primary_instrument.spid}` +
    `&n1Strong=${input.seed.primary_instrument.grade}`;
  const lastPoint = points.at(-1);
  if (!lastPoint) {
    throw new TypeError("price history must contain at least one point");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO player(player_id, name) VALUES (?, ?)
       ON CONFLICT(player_id) DO UPDATE SET name = excluded.name`,
    ).run(input.seed.player_key, input.seed.player_name);

    db.prepare(
      `INSERT OR IGNORE INTO player_card(spid, player_id, season) VALUES (?, ?, ?)`,
    ).run(
      input.seed.primary_instrument.spid,
      input.seed.player_key,
      input.expected.class_code,
    );
    const playerCard = db
      .prepare("SELECT player_id, season FROM player_card WHERE spid = ?")
      .get(input.seed.primary_instrument.spid) as
      | { player_id: string; season: string }
      | undefined;
    if (
      playerCard?.player_id !== input.seed.player_key ||
      playerCard.season !== input.expected.class_code
    ) {
      throw new Error(
        `player_card identity conflict for spid=${input.seed.primary_instrument.spid}`,
      );
    }

    db.prepare(
      `INSERT OR IGNORE INTO instrument(instrument_id, spid, grade) VALUES (?, ?, ?)`,
    ).run(
      instrumentId,
      input.seed.primary_instrument.spid,
      input.seed.primary_instrument.grade,
    );
    const instrument = db
      .prepare("SELECT spid, grade FROM instrument WHERE instrument_id = ?")
      .get(instrumentId) as { spid: string; grade: number } | undefined;
    if (
      instrument?.spid !== input.seed.primary_instrument.spid ||
      instrument.grade !== input.seed.primary_instrument.grade
    ) {
      throw new Error(`instrument identity conflict for ${instrumentId}`);
    }

    const snapshotInsert = db.prepare(
      `INSERT OR IGNORE INTO source_snapshot(
         source_snapshot_id,
         source_id,
         source_type,
         source_url,
         source_timestamp,
         observed_at,
         raw_payload,
         raw_hash,
         capture_method,
         collector_version,
         policy_evidence_id,
         source_ref,
         parse_status,
         parse_error
       ) VALUES (?, ?, 'PRICE_HISTORY', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PARSED', NULL)`,
    ).run(
      snapshotId,
      input.source_id,
      sourceUrl,
      new Date(lastPoint.source_timestamp_ms).toISOString(),
      input.expected.observed_at,
      input.raw,
      byteHash,
      input.capture_method,
      NORMALIZER_VERSION,
      input.source_id,
      instrumentId,
    );

    const persistedSnapshot = db
      .prepare(
        `SELECT raw_hash, observed_at, source_ref, capture_method, collector_version
         FROM source_snapshot WHERE source_snapshot_id = ?`,
      )
      .get(snapshotId) as
      | {
          raw_hash: string;
          observed_at: string;
          source_ref: string;
          capture_method: string;
          collector_version: string;
        }
      | undefined;
    if (
      persistedSnapshot?.raw_hash !== byteHash ||
      persistedSnapshot.observed_at !== input.expected.observed_at ||
      persistedSnapshot.source_ref !== instrumentId ||
      persistedSnapshot.capture_method !== input.capture_method ||
      persistedSnapshot.collector_version !== NORMALIZER_VERSION
    ) {
      throw new Error(`source_snapshot identity conflict for ${snapshotId}`);
    }

    const insertPoint = db.prepare(
      `INSERT OR IGNORE INTO price_point(
         source_snapshot_id,
         instrument_id,
         source_timestamp,
         observed_at,
         value,
         currency,
         price_semantics,
         quality_status
       ) VALUES (?, ?, ?, ?, ?, 'BP', 'MARKET_REFERENCE_PRICE', 'VALID')`,
    );

    let pricePointsInserted = 0;
    for (const point of points) {
      const sourceTimestamp = new Date(point.source_timestamp_ms).toISOString();
      const result = insertPoint.run(
        snapshotId,
        instrumentId,
        sourceTimestamp,
        input.expected.observed_at,
        point.value,
      );
      pricePointsInserted += Number(result.changes);
      if (Number(result.changes) === 0) {
        const existing = db
          .prepare(
            `SELECT instrument_id, observed_at, value, currency, price_semantics, quality_status
             FROM price_point
             WHERE source_snapshot_id = ? AND source_timestamp = ?`,
          )
          .get(snapshotId, sourceTimestamp) as
          | {
              instrument_id: string;
              observed_at: string;
              value: number;
              currency: string;
              price_semantics: string;
              quality_status: string;
            }
          | undefined;
        if (
          existing?.instrument_id !== instrumentId ||
          existing.observed_at !== input.expected.observed_at ||
          existing.value !== point.value ||
          existing.currency !== "BP" ||
          existing.price_semantics !== "MARKET_REFERENCE_PRICE" ||
          existing.quality_status !== "VALID"
        ) {
          throw new Error(
            `price_point normalization conflict for ${snapshotId} at ${sourceTimestamp}`,
          );
        }
      }
    }

    const persistedCount = db
      .prepare(
        "SELECT COUNT(*) AS count FROM price_point WHERE source_snapshot_id = ?",
      )
      .get(snapshotId) as { count: number | bigint } | undefined;
    if (Number(persistedCount?.count ?? 0) !== points.length) {
      throw new Error(
        `persisted price point count ${Number(persistedCount?.count ?? 0)} != parsed ${points.length}`,
      );
    }

    const firstPoint = points[0];
    if (
      !firstPoint ||
      sourceDate(firstPoint.source_timestamp_ms) !==
        input.expected.first_source_date
    ) {
      throw new Error(
        "persisted input does not start at expected first_source_date",
      );
    }

    db.exec("COMMIT");
    return {
      source_snapshot_id: snapshotId,
      instrument_id: instrumentId,
      source_snapshot_created: Number(snapshotInsert.changes) === 1,
      price_points_inserted: pricePointsInserted,
      point_count: points.length,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
