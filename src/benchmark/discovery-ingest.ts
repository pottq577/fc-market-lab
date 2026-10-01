import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";

import type { SeedPlayer } from "../catalog/seed-catalog.ts";
import { buildDatacenterPriceCaptureEvidence } from "../evidence/datacenter-price-history.ts";
import { normalizePriceHistorySnapshot } from "../normalize/price-history.ts";
import type { BenchmarkDiscoveryBatchDocument } from "./discovery-collection.ts";

export interface IngestBenchmarkDiscoveryResult {
  discovery_frame_id: string;
  batch_id: string;
  collected_results: number;
  failed_results: number;
  halted_results: number;
  source_snapshots_created: number;
  price_points_inserted: number;
  instruments_processed: number;
}

interface DiscoveryMemberRow {
  sample_rank: number | bigint;
  player_id: string;
  player_name: string;
  probe_spid: string;
  probe_season_name: string;
  probe_grade: number | bigint;
}

function sha256(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function seedFor(
  member: DiscoveryMemberRow,
  storagePlayerId: string,
): SeedPlayer {
  return {
    player_key: storagePlayerId,
    player_name: member.player_name,
    primary_instrument: {
      spid: member.probe_spid,
      grade: Number(member.probe_grade),
    },
    selection_observation: {
      section: "CLASS_USAGE",
      ranker_squad_count: 1,
      displayed_share_percent: 1,
    },
    selection_reason: "benchmark discovery probe",
  };
}

export async function ingestBenchmarkDiscoveryBatch(
  db: DatabaseSync,
  batch: BenchmarkDiscoveryBatchDocument,
  input: {
    readRaw?: (path: string) => Promise<Buffer>;
  } = {},
): Promise<IngestBenchmarkDiscoveryResult> {
  const frame = db
    .prepare(
      `SELECT universe_snapshot_id
       FROM benchmark_discovery_frame
       WHERE discovery_frame_id = ?`,
    )
    .get(batch.discovery_frame_id) as
    | { universe_snapshot_id: string }
    | undefined;
  if (!frame) {
    throw new TypeError(`unknown discovery frame: ${batch.discovery_frame_id}`);
  }
  if (frame.universe_snapshot_id !== batch.universe_snapshot_id) {
    throw new TypeError(
      `batch universe ${batch.universe_snapshot_id} does not match discovery frame ${frame.universe_snapshot_id}`,
    );
  }

  const readRaw = input.readRaw ?? ((path: string) => readFile(path));
  let sourceSnapshotsCreated = 0;
  let pricePointsInserted = 0;
  let instrumentsProcessed = 0;
  let collectedResults = 0;
  let failedResults = 0;
  let haltedResults = 0;

  for (const result of batch.results) {
    if (result.status === "FAILED") {
      failedResults += 1;
      continue;
    }
    if (result.status === "HALTED") {
      haltedResults += 1;
      continue;
    }
    collectedResults += 1;

    const member = db
      .prepare(
        `SELECT sample_rank, player_id, player_name,
                probe_spid, probe_season_name, probe_grade
         FROM benchmark_discovery_member
         WHERE discovery_frame_id = ? AND sample_rank = ?`,
      )
      .get(batch.discovery_frame_id, result.sample_rank) as
      | DiscoveryMemberRow
      | undefined;
    if (!member) {
      throw new TypeError(
        `discovery member rank ${result.sample_rank} is missing from ${batch.discovery_frame_id}`,
      );
    }
    if (
      member.player_id !== result.player_id ||
      member.player_name !== result.player_name ||
      member.probe_spid !== result.spid ||
      Number(member.probe_grade) !== result.grade
    ) {
      throw new TypeError(
        `batch result rank ${result.sample_rank} does not match frozen discovery member`,
      );
    }
    if (
      result.raw_path === null ||
      result.raw_sha256 === null ||
      result.observed_at === null
    ) {
      throw new TypeError(
        `COLLECTED result rank ${result.sample_rank} is missing raw provenance`,
      );
    }

    const raw = await readRaw(result.raw_path);
    const rawHash = sha256(raw);
    if (rawHash !== result.raw_sha256) {
      throw new TypeError(
        `raw hash mismatch for discovery rank ${result.sample_rank}: ${rawHash} != ${result.raw_sha256}`,
      );
    }
    const evidence = buildDatacenterPriceCaptureEvidence({
      raw: raw.toString("utf8"),
      spid: result.spid,
      grade: result.grade,
      observed_at: result.observed_at,
    });
    if (
      evidence.raw_sha256 !== result.raw_sha256 ||
      evidence.point_count !== result.point_count
    ) {
      throw new TypeError(
        `parsed evidence does not match collection manifest for discovery rank ${result.sample_rank}`,
      );
    }

    const existingCard = db
      .prepare(
        `SELECT player_id, season
         FROM player_card
         WHERE spid = ?`,
      )
      .get(result.spid) as
      | { player_id: string; season: string }
      | undefined;
    if (
      existingCard &&
      existingCard.season !== member.probe_season_name
    ) {
      throw new TypeError(
        `existing player_card ${result.spid} season=${existingCard.season} conflicts with discovery season=${member.probe_season_name}`,
      );
    }
    const storagePlayerId = existingCard?.player_id ?? member.player_id;
    const normalized = normalizePriceHistorySnapshot(db, {
      seed: seedFor(member, storagePlayerId),
      expected: {
        spid: result.spid,
        grade: result.grade,
        class_code: member.probe_season_name,
        observed_at: result.observed_at,
        raw_sha256: result.raw_sha256,
        point_count: evidence.point_count,
        first_source_date: evidence.first_source_date,
        last_source_date: evidence.last_source_date,
        observed_span_days: evidence.observed_span_days,
        native_granularity: evidence.native_granularity,
      },
      raw,
      source_id: batch.source_id,
      capture_method: "OFFICIAL_WEB_UI_OPERATOR_BATCH",
    });
    sourceSnapshotsCreated += normalized.source_snapshot_created ? 1 : 0;
    pricePointsInserted += normalized.price_points_inserted;
    instrumentsProcessed += 1;
  }

  return {
    discovery_frame_id: batch.discovery_frame_id,
    batch_id: batch.batch_id,
    collected_results: collectedResults,
    failed_results: failedResults,
    halted_results: haltedResults,
    source_snapshots_created: sourceSnapshotsCreated,
    price_points_inserted: pricePointsInserted,
    instruments_processed: instrumentsProcessed,
  };
}
