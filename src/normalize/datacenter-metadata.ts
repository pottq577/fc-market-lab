import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { SeedCatalogDocument } from "../catalog/seed-catalog.ts";
import type {
  DatacenterMetadataEntry,
  DatacenterMetadataEvidenceDocument,
} from "../evidence/datacenter-metadata.ts";
import type { RawHtmlFile } from "../ingest/raw-html-files.ts";

export interface NormalizeDatacenterMetadataResult {
  source_snapshots_created: number;
  metadata_snapshots_created: number;
  metadata_snapshot_sources_created: number;
  entries_processed: number;
}

function deterministicId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex");
  return `${prefix}_${digest}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function recomputeValidity(db: DatabaseSync, spid: string): void {
  const rows = db
    .prepare(
      `SELECT metadata_snapshot_id, valid_from
       FROM metadata_snapshot
       WHERE spid = ?
       ORDER BY valid_from ASC, metadata_snapshot_id ASC`,
    )
    .all(spid) as Array<{ metadata_snapshot_id: string; valid_from: string }>;

  const update = db.prepare(
    "UPDATE metadata_snapshot SET valid_to = ? WHERE metadata_snapshot_id = ?",
  );
  for (let index = 0; index < rows.length; index += 1) {
    update.run(rows[index + 1]?.valid_from ?? null, rows[index]!.metadata_snapshot_id);
  }
}

function latestIdentity(
  db: DatabaseSync,
  spid: string,
): {
  player_name: string;
  season_id: number;
  season_name: string;
} {
  const row = db
    .prepare(
      `SELECT player_name, season_id, season_name
       FROM metadata_snapshot
       WHERE spid = ?
       ORDER BY observed_at DESC, metadata_snapshot_id DESC
       LIMIT 1`,
    )
    .get(spid) as
    | { player_name: string; season_id: number; season_name: string }
    | undefined;
  if (!row) {
    throw new TypeError(
      `identity metadata for spid=${spid} is missing; run ingest:metadata-usage first`,
    );
  }
  return row;
}

function assertEntryMatchesCatalog(
  catalog: SeedCatalogDocument,
  entry: DatacenterMetadataEntry,
): void {
  const seed = catalog.seeds.find(
    (item) => item.primary_instrument.spid === entry.spid,
  );
  if (!seed) {
    throw new TypeError(`metadata evidence spid=${entry.spid} is not in the seed catalog`);
  }
  if (seed.primary_instrument.grade !== entry.grade) {
    throw new TypeError(`metadata evidence grade mismatch for spid=${entry.spid}`);
  }
  if (seed.player_name !== entry.player_name) {
    throw new TypeError(`metadata evidence player_name mismatch for spid=${entry.spid}`);
  }
}

function insertEntry(
  db: DatabaseSync,
  input: {
    catalog: SeedCatalogDocument;
    document: DatacenterMetadataEvidenceDocument;
    entry: DatacenterMetadataEntry;
    rawFile: RawHtmlFile;
  },
): {
  sourceSnapshotCreated: boolean;
  metadataSnapshotCreated: boolean;
  metadataSnapshotSourceCreated: boolean;
} {
  const { entry, rawFile } = input;
  assertEntryMatchesCatalog(input.catalog, entry);
  if (rawFile.raw_sha256 !== entry.raw_sha256) {
    throw new TypeError(`raw hash mismatch for spid=${entry.spid}`);
  }
  const identity = latestIdentity(db, entry.spid);
  if (identity.player_name !== entry.player_name) {
    throw new TypeError(`identity player_name conflict for spid=${entry.spid}`);
  }

  const sourceSnapshotId = deterministicId(
    "src",
    "fconline-datacenter-player-info",
    entry.spid,
    String(entry.grade),
    entry.observed_at,
    entry.raw_sha256,
  );
  const sourceInserted = db
    .prepare(
      `INSERT OR IGNORE INTO source_snapshot(
        source_snapshot_id, source_id, source_type, source_url,
        source_timestamp, observed_at, raw_payload, raw_hash,
        capture_method, collector_version, policy_evidence_id,
        source_ref, parse_status, parse_error
      ) VALUES (?, 'fconline-datacenter-player-info', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PARSED', NULL)`,
    )
    .run(
      sourceSnapshotId,
      input.document.capture_method,
      entry.source_url,
      entry.observed_at,
      entry.observed_at,
      rawFile.raw,
      entry.raw_sha256,
      input.document.capture_method,
      "datacenter-metadata-v1",
      input.document.capture_method === "OFFICIAL_WEB_UI_PLAYWRIGHT"
        ? "fconline-datacenter-browser-experimental"
        : "fconline-datacenter-manual-only",
      `${entry.spid}:${entry.grade}`,
    );

  const metadataSnapshotId = deterministicId(
    "meta",
    entry.spid,
    entry.observed_at,
    entry.raw_sha256,
    "FULL",
  );
  const metadataInserted = db
    .prepare(
      `INSERT OR IGNORE INTO metadata_snapshot(
        metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
        player_name, season_id, season_name, salary, positions_json, ovr,
        stats_json, traits_json, clubs_json, nations_json, team_colors_json,
        completeness
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FULL')`,
    )
    .run(
      metadataSnapshotId,
      entry.spid,
      entry.observed_at,
      entry.observed_at,
      entry.player_name,
      identity.season_id,
      identity.season_name,
      entry.salary,
      stableJson(entry.positions),
      entry.ovr,
      stableJson(entry.stats),
      stableJson(entry.traits),
      stableJson(entry.clubs),
      stableJson(entry.nations),
      stableJson(entry.team_colors),
    );

  const linkInserted = db
    .prepare(
      `INSERT OR IGNORE INTO metadata_snapshot_source(
        metadata_snapshot_id, source_snapshot_id, source_role
      ) VALUES (?, ?, 'DETAIL')`,
    )
    .run(metadataSnapshotId, sourceSnapshotId);

  recomputeValidity(db, entry.spid);
  return {
    sourceSnapshotCreated: Number(sourceInserted.changes) === 1,
    metadataSnapshotCreated: Number(metadataInserted.changes) === 1,
    metadataSnapshotSourceCreated: Number(linkInserted.changes) === 1,
  };
}

export function normalizeDatacenterMetadata(
  db: DatabaseSync,
  input: {
    catalog: SeedCatalogDocument;
    document: DatacenterMetadataEvidenceDocument;
    rawByHash: Map<string, RawHtmlFile>;
  },
): NormalizeDatacenterMetadataResult {
  if (input.document.catalog_id !== input.catalog.catalog_id) {
    throw new TypeError(
      `metadata evidence catalog_id=${input.document.catalog_id} does not match catalog_id=${input.catalog.catalog_id}`,
    );
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    let sourceSnapshotsCreated = 0;
    let metadataSnapshotsCreated = 0;
    let metadataSnapshotSourcesCreated = 0;

    for (const entry of input.document.entries) {
      const rawFile = input.rawByHash.get(entry.raw_sha256);
      if (!rawFile) {
        throw new TypeError(
          `raw metadata capture ${entry.raw_sha256} for spid=${entry.spid} was not found`,
        );
      }
      const result = insertEntry(db, {
        catalog: input.catalog,
        document: input.document,
        entry,
        rawFile,
      });
      sourceSnapshotsCreated += result.sourceSnapshotCreated ? 1 : 0;
      metadataSnapshotsCreated += result.metadataSnapshotCreated ? 1 : 0;
      metadataSnapshotSourcesCreated += result.metadataSnapshotSourceCreated ? 1 : 0;
    }

    db.exec("COMMIT");
    return {
      source_snapshots_created: sourceSnapshotsCreated,
      metadata_snapshots_created: metadataSnapshotsCreated,
      metadata_snapshot_sources_created: metadataSnapshotSourcesCreated,
      entries_processed: input.document.entries.length,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
