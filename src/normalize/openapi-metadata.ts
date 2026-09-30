import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { SeedCatalogDocument } from "../catalog/seed-catalog.ts";
import type {
  OpenApiMetadataArtifact,
  OpenApiMetadataKind,
} from "../collect/openapi-metadata.ts";

interface SpidEntry {
  id: number;
  name: string;
}

interface SeasonEntry {
  seasonId: number;
  className: string;
  seasonImg?: string;
}

interface PositionEntry {
  spposition: number;
  desc: string;
}

export interface ParsedOpenApiMetadata {
  spids: SpidEntry[];
  seasons: SeasonEntry[];
  positions: PositionEntry[];
}

export interface NormalizeOpenApiMetadataResult {
  source_snapshots_created: number;
  metadata_snapshots_created: number;
  metadata_snapshot_sources_created: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonArray(raw: Buffer, label: string): unknown[] {
  const value = JSON.parse(raw.toString("utf8")) as unknown;
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} metadata must be a JSON array`);
  }
  return value;
}

function parseSpids(raw: Buffer): SpidEntry[] {
  return parseJsonArray(raw, "spid").map((item, index) => {
    if (!isRecord(item) || !Number.isInteger(item.id)) {
      throw new TypeError(`spid[${index}].id must be an integer`);
    }
    if (typeof item.name !== "string" || item.name.trim() === "") {
      throw new TypeError(`spid[${index}].name must be a non-empty string`);
    }
    return { id: item.id as number, name: item.name.trim() };
  });
}

function parseSeasons(raw: Buffer): SeasonEntry[] {
  return parseJsonArray(raw, "season").map((item, index) => {
    if (!isRecord(item) || !Number.isInteger(item.seasonId)) {
      throw new TypeError(`season[${index}].seasonId must be an integer`);
    }
    if (typeof item.className !== "string" || item.className.trim() === "") {
      throw new TypeError(`season[${index}].className must be a non-empty string`);
    }
    return {
      seasonId: item.seasonId as number,
      className: item.className.trim(),
      seasonImg:
        typeof item.seasonImg === "string" ? item.seasonImg.trim() : undefined,
    };
  });
}

function parsePositions(raw: Buffer): PositionEntry[] {
  return parseJsonArray(raw, "position").map((item, index) => {
    if (!isRecord(item) || !Number.isInteger(item.spposition)) {
      throw new TypeError(`position[${index}].spposition must be an integer`);
    }
    if (typeof item.desc !== "string" || item.desc.trim() === "") {
      throw new TypeError(`position[${index}].desc must be a non-empty string`);
    }
    return { spposition: item.spposition as number, desc: item.desc.trim() };
  });
}

export function parseOpenApiMetadataArtifacts(
  artifacts: OpenApiMetadataArtifact[],
): ParsedOpenApiMetadata {
  const byKind = new Map<OpenApiMetadataKind, OpenApiMetadataArtifact>();
  for (const artifact of artifacts) {
    if (byKind.has(artifact.kind)) {
      throw new TypeError(`duplicate Open API metadata artifact: ${artifact.kind}`);
    }
    byKind.set(artifact.kind, artifact);
  }

  const spid = byKind.get("spid");
  const season = byKind.get("season");
  const position = byKind.get("position");
  if (!spid || !season || !position) {
    throw new TypeError("spid, season, and position metadata artifacts are required");
  }

  return {
    spids: parseSpids(spid.raw),
    seasons: parseSeasons(season.raw),
    positions: parsePositions(position.raw),
  };
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

function sourceSnapshotId(artifact: OpenApiMetadataArtifact): string {
  return deterministicId(
    "src",
    "nexon-open-api-static-metadata",
    artifact.kind,
    artifact.observed_at,
    sha256(artifact.raw),
  );
}

function insertSourceSnapshot(
  db: DatabaseSync,
  artifact: OpenApiMetadataArtifact,
): { id: string; created: boolean } {
  const id = sourceSnapshotId(artifact);
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO source_snapshot(
        source_snapshot_id, source_id, source_type, source_url,
        source_timestamp, observed_at, raw_payload, raw_hash,
        capture_method, collector_version, policy_evidence_id,
        source_ref, parse_status, parse_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PARSED', NULL)`,
    )
    .run(
      id,
      `nexon-open-api-${artifact.kind}-metadata`,
      "OPEN_API_STATIC_METADATA",
      artifact.source_url,
      artifact.observed_at,
      artifact.observed_at,
      artifact.raw,
      sha256(artifact.raw),
      "OFFICIAL_OPEN_API_STATIC",
      "openapi-metadata-v1",
      "nexon-open-api-current-terms",
      artifact.kind,
    );
  return { id, created: Number(result.changes) === 1 };
}

export function normalizeOpenApiMetadata(
  db: DatabaseSync,
  input: {
    catalog: SeedCatalogDocument;
    artifacts: OpenApiMetadataArtifact[];
  },
): NormalizeOpenApiMetadataResult {
  const parsed = parseOpenApiMetadataArtifacts(input.artifacts);
  const byKind = new Map(input.artifacts.map((artifact) => [artifact.kind, artifact]));
  const spidArtifact = byKind.get("spid")!;
  const seasonArtifact = byKind.get("season")!;
  const spidById = new Map(parsed.spids.map((entry) => [entry.id, entry]));
  const seasonById = new Map(parsed.seasons.map((entry) => [entry.seasonId, entry]));

  db.exec("BEGIN IMMEDIATE");
  try {
    const sourceResults = input.artifacts.map((artifact) =>
      insertSourceSnapshot(db, artifact),
    );
    const sourceIds = new Map(
      input.artifacts.map((artifact, index) => [artifact.kind, sourceResults[index]!.id]),
    );

    let metadataSnapshotsCreated = 0;
    let metadataSnapshotSourcesCreated = 0;

    for (const seed of input.catalog.seeds) {
      const spidNumber = Number(seed.primary_instrument.spid);
      const spidEntry = spidById.get(spidNumber);
      if (!spidEntry) {
        throw new TypeError(`Open API spid metadata is missing ${spidNumber}`);
      }
      const seasonId = Number(seed.primary_instrument.spid.slice(0, 3));
      const seasonEntry = seasonById.get(seasonId);
      if (!seasonEntry) {
        throw new TypeError(`Open API season metadata is missing seasonId=${seasonId}`);
      }
      const card = db
        .prepare("SELECT player_id FROM player_card WHERE spid = ?")
        .get(seed.primary_instrument.spid) as { player_id: string } | undefined;
      if (!card) {
        throw new TypeError(
          `player_card ${seed.primary_instrument.spid} is missing; run ingest:price first`,
        );
      }
      if (card.player_id !== seed.player_key) {
        throw new TypeError(
          `player_card identity conflict for spid=${seed.primary_instrument.spid}`,
        );
      }

      const metadataSnapshotId = deterministicId(
        "meta",
        seed.primary_instrument.spid,
        spidArtifact.observed_at,
        sha256(spidArtifact.raw),
        sha256(seasonArtifact.raw),
      );
      const inserted = db
        .prepare(
          `INSERT OR IGNORE INTO metadata_snapshot(
            metadata_snapshot_id, spid, observed_at, valid_from, valid_to,
            player_name, season_id, season_name, salary, positions_json, ovr,
            stats_json, traits_json, clubs_json, nations_json, team_colors_json,
            completeness
          ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'IDENTITY_ONLY')`,
        )
        .run(
          metadataSnapshotId,
          seed.primary_instrument.spid,
          spidArtifact.observed_at,
          spidArtifact.observed_at,
          spidEntry.name,
          seasonId,
          seasonEntry.className,
        );
      metadataSnapshotsCreated += Number(inserted.changes);

      for (const [role, kind] of [
        ["SPID_META", "spid"],
        ["SEASON_META", "season"],
      ] as const) {
        const linked = db
          .prepare(
            `INSERT OR IGNORE INTO metadata_snapshot_source(
              metadata_snapshot_id, source_snapshot_id, source_role
            ) VALUES (?, ?, ?)`,
          )
          .run(metadataSnapshotId, sourceIds.get(kind)!, role);
        metadataSnapshotSourcesCreated += Number(linked.changes);
      }
    }

    db.exec("COMMIT");
    return {
      source_snapshots_created: sourceResults.filter((result) => result.created).length,
      metadata_snapshots_created: metadataSnapshotsCreated,
      metadata_snapshot_sources_created: metadataSnapshotSourcesCreated,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
