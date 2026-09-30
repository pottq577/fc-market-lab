import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { SeedCatalogDocument } from "../catalog/seed-catalog.ts";

export interface NormalizeSeedUsageResult {
  source_snapshot_created: boolean;
  usage_points_created: number;
}

function sha256(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function deterministicId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex");
  return `${prefix}_${digest}`;
}

export function normalizeSeedUsage(
  db: DatabaseSync,
  input: {
    catalog: SeedCatalogDocument;
    catalogRaw: Buffer;
  },
): NormalizeSeedUsageResult {
  const rawHash = sha256(input.catalogRaw);
  const source = input.catalog.selection_source;
  const sourceSnapshotId = deterministicId(
    "src",
    source.source_id,
    source.observed_at,
    rawHash,
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    const sourceInsert = db
      .prepare(
        `INSERT OR IGNORE INTO source_snapshot(
          source_snapshot_id, source_id, source_type, source_url,
          source_timestamp, observed_at, raw_payload, raw_hash,
          capture_method, collector_version, policy_evidence_id,
          source_ref, parse_status, parse_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PARSED', NULL)`,
      )
      .run(
        sourceSnapshotId,
        source.source_id,
        "MANUAL_USAGE_EVIDENCE",
        source.source_url,
        source.data_date,
        source.observed_at,
        input.catalogRaw,
        rawHash,
        source.method,
        "seed-usage-v1",
        "manual-datacenter-observation",
        input.catalog.catalog_id,
      );

    let usagePointsCreated = 0;
    for (const seed of input.catalog.seeds) {
      const card = db
        .prepare("SELECT 1 AS present FROM player_card WHERE spid = ?")
        .get(seed.primary_instrument.spid);
      if (!card) {
        throw new TypeError(
          `player_card ${seed.primary_instrument.spid} is missing; run ingest:price first`,
        );
      }

      const observationType =
        seed.selection_observation.section === "CLASS_USAGE"
          ? "DAILY_CHART_CLASS_USAGE"
          : "DAILY_CHART_POSITION_USAGE";
      const usagePointId = deterministicId(
        "usage",
        input.catalog.catalog_id,
        seed.primary_instrument.spid,
        observationType,
        source.observed_at,
      );
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO usage_point(
            usage_point_id, subject_type, spid, instrument_id, as_of,
            source_data_date, observation_type, appearances, usage_share,
            position_code, performance_metrics_json, source_snapshot_id
          ) VALUES (?, 'PLAYER_CARD', ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
        )
        .run(
          usagePointId,
          seed.primary_instrument.spid,
          source.observed_at,
          source.data_date,
          observationType,
          seed.selection_observation.ranker_squad_count,
          Number(
            (seed.selection_observation.displayed_share_percent / 100).toFixed(6),
          ),
          sourceSnapshotId,
        );
      usagePointsCreated += Number(result.changes);
    }

    db.exec("COMMIT");
    return {
      source_snapshot_created: Number(sourceInsert.changes) === 1,
      usage_points_created: usagePointsCreated,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
