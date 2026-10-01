import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface AnalysisSeedCatalog {
  catalog_id: string;
  seeds: Array<{
    player_key: string;
    primary_instrument: {
      spid: string;
      grade: number;
    };
  }>;
}

export interface DatasetSnapshotCounts {
  sources: number;
  price_points: number;
  metadata_snapshots: number;
  usage_points: number;
  relations: number;
  cohort_memberships: number;
  events: number;
  products: number;
  rewards: number;
  exposures: number;
}

export interface DatasetSnapshotResult {
  dataset_snapshot_id: string;
  analysis_cutoff: string;
  catalog_hash: string;
  input_hash: string;
  created: boolean;
  counts: DatasetSnapshotCounts;
}

export interface AnalysisRunResult {
  analysis_run_id: string;
  parameter_hash: string;
  created: boolean;
  status: "READY";
}

type SourceRole = "PRICE" | "METADATA" | "USAGE" | "EVENT" | "PRODUCT";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${field} must include an explicit timezone`);
  }
  return parsed.toISOString();
}

export function canonicalJson(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (Array.isArray(input)) {
      return input.map(normalize);
    }
    if (typeof input === "object" && input !== null) {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean" ||
      (typeof input === "number" && Number.isFinite(input))
    ) {
      return input;
    }
    throw new TypeError("analysis parameters must contain only finite JSON values");
  }
  return JSON.stringify(normalize(value));
}

function sampleInstrumentIds(catalog: AnalysisSeedCatalog): string[] {
  const ids = catalog.seeds.map(
    (seed) => `${seed.primary_instrument.spid}:${seed.primary_instrument.grade}`,
  );
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("analysis catalog contains duplicate primary instruments");
  }
  return ids.sort();
}

function assertSampleCohort(
  db: DatabaseSync,
  catalog: AnalysisSeedCatalog,
  analysisCutoff: string,
  expected: string[],
): void {
  const cohortId = `SAMPLE_MARKET:${catalog.catalog_id}`;
  const rows = db
    .prepare(
      `SELECT instrument_id
       FROM cohort_membership
       WHERE cohort_id = ?
         AND valid_from <= ?
         AND (valid_to IS NULL OR ? < valid_to)
       ORDER BY instrument_id`,
    )
    .all(cohortId, analysisCutoff, analysisCutoff) as Array<{ instrument_id: string }>;
  const actual = rows.map((row) => row.instrument_id);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(
      `SAMPLE_MARKET membership does not match catalog at ${analysisCutoff}; run build:structure first`,
    );
  }
}

function seedPlayerInstrumentIds(db: DatabaseSync, catalog: AnalysisSeedCatalog): Set<string> {
  const players = new Set(catalog.seeds.map((seed) => seed.player_key));
  const rows = db
    .prepare(
      `SELECT i.instrument_id, pc.player_id
       FROM instrument i
       JOIN player_card pc ON pc.spid = i.spid
       ORDER BY i.instrument_id`,
    )
    .all() as Array<{ instrument_id: string; player_id: string }>;
  return new Set(
    rows.filter((row) => players.has(row.player_id)).map((row) => row.instrument_id),
  );
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function resolveLatestAnalysisCutoff(db: DatabaseSync): string {
  const row = db
    .prepare("SELECT MAX(observed_at) AS cutoff FROM source_snapshot")
    .get() as { cutoff: string | null };
  if (!row.cutoff) {
    throw new TypeError("source_snapshot is empty; ingest market data before preparing analysis");
  }
  return normalizeTimestamp(row.cutoff, "analysis cutoff");
}

export function createDatasetSnapshot(
  db: DatabaseSync,
  catalog: AnalysisSeedCatalog,
  input: {
    analysisCutoff: string;
    createdAt?: string;
    schemaVersion: number;
  },
): DatasetSnapshotResult {
  const analysisCutoff = normalizeTimestamp(input.analysisCutoff, "analysisCutoff");
  const createdAt = normalizeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "createdAt",
  );
  const catalogHash = sha256(canonicalJson(catalog));
  const sampleIds = sampleInstrumentIds(catalog);
  if (sampleIds.length === 0) {
    throw new TypeError("analysis catalog must not be empty");
  }
  assertSampleCohort(db, catalog, analysisCutoff, sampleIds);
  const seedInstrumentIds = seedPlayerInstrumentIds(db, catalog);

  const priceRows = db
    .prepare(
      `SELECT pp.source_snapshot_id, pp.instrument_id, pp.source_timestamp
       FROM price_point pp
       JOIN source_snapshot ss ON ss.source_snapshot_id = pp.source_snapshot_id
       WHERE pp.instrument_id IN (${placeholders(sampleIds.length)})
         AND pp.source_timestamp <= ?
         AND pp.observed_at <= ?
         AND ss.observed_at <= ?
       ORDER BY pp.instrument_id, pp.source_timestamp, pp.source_snapshot_id`,
    )
    .all(...sampleIds, analysisCutoff, analysisCutoff, analysisCutoff) as Array<{
      source_snapshot_id: string;
      instrument_id: string;
      source_timestamp: string;
    }>;
  if (priceRows.length === 0) {
    throw new TypeError(`no price points are available at or before ${analysisCutoff}`);
  }

  const metadataRows: Array<{ metadata_snapshot_id: string; spid: string }> = [];
  const metadataSources: Array<{ source_snapshot_id: string; source_role: SourceRole }> = [];
  const usageRows: Array<{ usage_point_id: string; spid: string | null; instrument_id: string | null }> = [];
  const usageSources: Array<{ source_snapshot_id: string; source_role: SourceRole }> = [];
  for (const seed of catalog.seeds) {
    const metadata = db
      .prepare(
        `SELECT metadata_snapshot_id, spid
         FROM metadata_snapshot
         WHERE spid = ?
           AND completeness = 'FULL'
           AND observed_at <= ?
           AND valid_from <= ?
           AND (valid_to IS NULL OR ? < valid_to)
         ORDER BY valid_from DESC, observed_at DESC, metadata_snapshot_id DESC
         LIMIT 1`,
      )
      .get(
        seed.primary_instrument.spid,
        analysisCutoff,
        analysisCutoff,
        analysisCutoff,
      ) as { metadata_snapshot_id: string; spid: string } | undefined;
    if (!metadata) {
      throw new TypeError(
        `FULL metadata for spid=${seed.primary_instrument.spid} is unavailable at ${analysisCutoff}`,
      );
    }
    metadataRows.push(metadata);
    const sources = db
      .prepare(
        `SELECT mss.source_snapshot_id
         FROM metadata_snapshot_source mss
         JOIN source_snapshot ss ON ss.source_snapshot_id = mss.source_snapshot_id
         WHERE mss.metadata_snapshot_id = ?
           AND ss.observed_at <= ?
         ORDER BY mss.source_snapshot_id`,
      )
      .all(metadata.metadata_snapshot_id, analysisCutoff) as Array<{
        source_snapshot_id: string;
      }>;
    if (sources.length === 0) {
      throw new TypeError(
        `metadata snapshot ${metadata.metadata_snapshot_id} has no eligible source provenance`,
      );
    }
    metadataSources.push(
      ...sources.map((source) => ({ ...source, source_role: "METADATA" as const })),
    );

    const usage = db
      .prepare(
        `SELECT up.usage_point_id, up.spid, up.instrument_id, up.source_snapshot_id
         FROM usage_point up
         JOIN source_snapshot ss ON ss.source_snapshot_id = up.source_snapshot_id
         WHERE up.subject_type = 'PLAYER_CARD'
           AND up.spid = ?
           AND up.as_of <= ?
           AND ss.observed_at <= ?
         ORDER BY up.as_of DESC, up.usage_point_id DESC
         LIMIT 1`,
      )
      .get(seed.primary_instrument.spid, analysisCutoff, analysisCutoff) as
      | {
          usage_point_id: string;
          spid: string | null;
          instrument_id: string | null;
          source_snapshot_id: string;
        }
      | undefined;
    if (usage) {
      usageRows.push({
        usage_point_id: usage.usage_point_id,
        spid: usage.spid,
        instrument_id: usage.instrument_id,
      });
      usageSources.push({ source_snapshot_id: usage.source_snapshot_id, source_role: "USAGE" });
    }
  }

  const relationRows = (db
    .prepare(
      `SELECT cr.relation_id, cr.source_instrument, cr.target_instrument,
              MAX(rs.as_of) AS relation_as_of
       FROM card_relation cr
       JOIN relation_snapshot rs ON rs.relation_id = cr.relation_id
       WHERE cr.valid_from <= ?
         AND (cr.valid_to IS NULL OR ? < cr.valid_to)
         AND rs.as_of <= ?
       GROUP BY cr.relation_id, cr.source_instrument, cr.target_instrument
       ORDER BY cr.relation_id`,
    )
    .all(analysisCutoff, analysisCutoff, analysisCutoff) as Array<{
      relation_id: string;
      source_instrument: string;
      target_instrument: string;
      relation_as_of: string;
    }>).filter(
      (row) =>
        seedInstrumentIds.has(row.source_instrument) ||
        seedInstrumentIds.has(row.target_instrument),
    );

  const cohortDefinitionRows = db
    .prepare(
      `SELECT cohort_id, name, aggregation_level, rule_version, rule_params_json
       FROM cohort_definition
       ORDER BY cohort_id`,
    )
    .all() as Array<{
      cohort_id: string;
      name: string;
      aggregation_level: string;
      rule_version: string;
      rule_params_json: string;
    }>;
  const cohortRows = db
    .prepare(
      `SELECT cohort_id, instrument_id, valid_from
       FROM cohort_membership
       WHERE valid_from <= ?
       ORDER BY cohort_id, instrument_id, valid_from`,
    )
    .all(analysisCutoff) as Array<{
      cohort_id: string;
      instrument_id: string;
      valid_from: string;
    }>;

  const eventRows = db
    .prepare(
      `SELECT e.event_id, e.source_snapshot_id
       FROM event e
       JOIN source_snapshot ss ON ss.source_snapshot_id = e.source_snapshot_id
       WHERE ss.observed_at <= ?
       ORDER BY e.event_id`,
    )
    .all(analysisCutoff) as Array<{ event_id: string; source_snapshot_id: string }>;
  const productRows = db
    .prepare(
      `SELECT p.product_id, p.source_snapshot_id
       FROM product p
       JOIN source_snapshot ss ON ss.source_snapshot_id = p.source_snapshot_id
       WHERE ss.observed_at <= ?
       ORDER BY p.product_id`,
    )
    .all(analysisCutoff) as Array<{ product_id: string; source_snapshot_id: string }>;
  const productIds = new Set(productRows.map((row) => row.product_id));
  const eventIds = new Set(eventRows.map((row) => row.event_id));
  const rewardRows = (db
    .prepare("SELECT reward_id, product_id FROM reward ORDER BY reward_id")
    .all() as Array<{ reward_id: string; product_id: string }>).filter((row) =>
      productIds.has(row.product_id),
    );
  const exposureRows = (db
    .prepare(
      `SELECT exposure_id, event_id, product_id, valid_from
       FROM exposure
       WHERE valid_from <= ?
       ORDER BY exposure_id`,
    )
    .all(analysisCutoff) as Array<{
      exposure_id: string;
      event_id: string | null;
      product_id: string | null;
      valid_from: string;
    }>).filter(
      (row) =>
        (row.event_id === null || eventIds.has(row.event_id)) &&
        (row.product_id === null || productIds.has(row.product_id)),
    );

  const sources: Array<{ source_snapshot_id: string; source_role: SourceRole }> = [
    ...priceRows.map((row) => ({
      source_snapshot_id: row.source_snapshot_id,
      source_role: "PRICE" as const,
    })),
    ...metadataSources,
    ...usageSources,
    ...eventRows.map((row) => ({
      source_snapshot_id: row.source_snapshot_id,
      source_role: "EVENT" as const,
    })),
    ...productRows.map((row) => ({
      source_snapshot_id: row.source_snapshot_id,
      source_role: "PRODUCT" as const,
    })),
  ];
  const uniqueSources = [...new Map(
    sources.map((row) => [`${row.source_role}:${row.source_snapshot_id}`, row]),
  ).values()].sort((left, right) =>
    `${left.source_role}:${left.source_snapshot_id}`.localeCompare(
      `${right.source_role}:${right.source_snapshot_id}`,
    ),
  );

  const manifest = {
    version: 1,
    schema_version: input.schemaVersion,
    catalog_id: catalog.catalog_id,
    catalog_hash: catalogHash,
    analysis_cutoff: analysisCutoff,
    sample_instruments: sampleIds,
    source_keys: uniqueSources.map(
      (row) => `${row.source_role}:${row.source_snapshot_id}`,
    ),
    price_point_keys: priceRows.map(
      (row) => `${row.source_snapshot_id}:${row.instrument_id}:${row.source_timestamp}`,
    ),
    metadata_snapshot_ids: metadataRows.map((row) => row.metadata_snapshot_id).sort(),
    usage_point_ids: usageRows.map((row) => row.usage_point_id).sort(),
    relation_keys: relationRows.map(
      (row) => `${row.relation_id}:${row.relation_as_of}`,
    ),
    cohort_definition_keys: cohortDefinitionRows.map(
      (row) => `${row.cohort_id}:${row.name}:${row.aggregation_level}:${row.rule_version}:${row.rule_params_json}`,
    ),
    cohort_membership_keys: cohortRows.map(
      (row) => `${row.cohort_id}:${row.instrument_id}:${row.valid_from}`,
    ),
    event_ids: eventRows.map((row) => row.event_id),
    product_ids: productRows.map((row) => row.product_id),
    reward_ids: rewardRows.map((row) => row.reward_id),
    exposure_ids: exposureRows.map((row) => row.exposure_id),
  };
  const inputHash = sha256(canonicalJson(manifest));
  const datasetSnapshotId = deterministicId("dataset", inputHash);

  db.exec("BEGIN IMMEDIATE");
  try {
    const snapshotInsert = db
      .prepare(
        `INSERT OR IGNORE INTO dataset_snapshot(
          dataset_snapshot_id, catalog_id, analysis_cutoff, created_at,
          schema_version, catalog_hash, input_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        datasetSnapshotId,
        catalog.catalog_id,
        analysisCutoff,
        createdAt,
        input.schemaVersion,
        catalogHash,
        inputHash,
      );

    const sourceInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_source(
        dataset_snapshot_id, source_snapshot_id, source_role
      ) VALUES (?, ?, ?)`,
    );
    for (const row of uniqueSources) {
      sourceInsert.run(datasetSnapshotId, row.source_snapshot_id, row.source_role);
    }

    const priceInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_price_point(
        dataset_snapshot_id, source_snapshot_id, instrument_id, source_timestamp
      ) VALUES (?, ?, ?, ?)`,
    );
    for (const row of priceRows) {
      priceInsert.run(
        datasetSnapshotId,
        row.source_snapshot_id,
        row.instrument_id,
        row.source_timestamp,
      );
    }

    const metadataInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_metadata(
        dataset_snapshot_id, metadata_snapshot_id, spid
      ) VALUES (?, ?, ?)`,
    );
    for (const row of metadataRows) {
      metadataInsert.run(datasetSnapshotId, row.metadata_snapshot_id, row.spid);
    }

    const usageInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_usage(
        dataset_snapshot_id, usage_point_id, spid, instrument_id
      ) VALUES (?, ?, ?, ?)`,
    );
    for (const row of usageRows) {
      usageInsert.run(
        datasetSnapshotId,
        row.usage_point_id,
        row.spid,
        row.instrument_id,
      );
    }

    const relationInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_relation(
        dataset_snapshot_id, relation_id, relation_as_of
      ) VALUES (?, ?, ?)`,
    );
    for (const row of relationRows) {
      relationInsert.run(datasetSnapshotId, row.relation_id, row.relation_as_of);
    }

    const cohortDefinitionInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_cohort_definition(
        dataset_snapshot_id, cohort_id, name, aggregation_level,
        rule_version, rule_params_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const row of cohortDefinitionRows) {
      cohortDefinitionInsert.run(
        datasetSnapshotId,
        row.cohort_id,
        row.name,
        row.aggregation_level,
        row.rule_version,
        row.rule_params_json,
      );
    }

    const cohortInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_cohort_membership(
        dataset_snapshot_id, cohort_id, instrument_id, valid_from
      ) VALUES (?, ?, ?, ?)`,
    );
    for (const row of cohortRows) {
      cohortInsert.run(
        datasetSnapshotId,
        row.cohort_id,
        row.instrument_id,
        row.valid_from,
      );
    }

    const eventInsert = db.prepare(
      "INSERT OR IGNORE INTO dataset_snapshot_event(dataset_snapshot_id, event_id) VALUES (?, ?)",
    );
    for (const row of eventRows) eventInsert.run(datasetSnapshotId, row.event_id);

    const productInsert = db.prepare(
      "INSERT OR IGNORE INTO dataset_snapshot_product(dataset_snapshot_id, product_id) VALUES (?, ?)",
    );
    for (const row of productRows) productInsert.run(datasetSnapshotId, row.product_id);

    const rewardInsert = db.prepare(
      "INSERT OR IGNORE INTO dataset_snapshot_reward(dataset_snapshot_id, reward_id) VALUES (?, ?)",
    );
    for (const row of rewardRows) rewardInsert.run(datasetSnapshotId, row.reward_id);

    const exposureInsert = db.prepare(
      "INSERT OR IGNORE INTO dataset_snapshot_exposure(dataset_snapshot_id, exposure_id) VALUES (?, ?)",
    );
    for (const row of exposureRows) exposureInsert.run(datasetSnapshotId, row.exposure_id);

    db.exec("COMMIT");
    return {
      dataset_snapshot_id: datasetSnapshotId,
      analysis_cutoff: analysisCutoff,
      catalog_hash: catalogHash,
      input_hash: inputHash,
      created: Number(snapshotInsert.changes) === 1,
      counts: {
        sources: uniqueSources.length,
        price_points: priceRows.length,
        metadata_snapshots: metadataRows.length,
        usage_points: usageRows.length,
        relations: relationRows.length,
        cohort_memberships: cohortRows.length,
        events: eventRows.length,
        products: productRows.length,
        rewards: rewardRows.length,
        exposures: exposureRows.length,
      },
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createAnalysisRun(
  db: DatabaseSync,
  input: {
    datasetSnapshotId: string;
    analysisVersion: string;
    parameters: unknown;
    codeCommit: string;
    createdAt?: string;
  },
): AnalysisRunResult {
  if (input.analysisVersion.trim() === "") {
    throw new TypeError("analysisVersion must not be empty");
  }
  if (!/^[0-9a-f]{7,64}$/i.test(input.codeCommit)) {
    throw new TypeError("codeCommit must be a Git commit SHA");
  }
  const snapshot = db
    .prepare("SELECT 1 AS found FROM dataset_snapshot WHERE dataset_snapshot_id = ?")
    .get(input.datasetSnapshotId);
  if (!snapshot) {
    throw new TypeError(`dataset snapshot ${input.datasetSnapshotId} does not exist`);
  }
  const parametersJson = canonicalJson(input.parameters);
  const parameterHash = sha256(parametersJson);
  const identity = canonicalJson({
    dataset_snapshot_id: input.datasetSnapshotId,
    analysis_version: input.analysisVersion,
    parameter_hash: parameterHash,
    code_commit: input.codeCommit.toLowerCase(),
  });
  const analysisRunId = deterministicId("run", identity);
  const createdAt = normalizeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "createdAt",
  );
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO analysis_run(
        analysis_run_id, dataset_snapshot_id, analysis_version,
        parameters_json, parameter_hash, code_commit, created_at, status, result_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'READY', NULL)`,
    )
    .run(
      analysisRunId,
      input.datasetSnapshotId,
      input.analysisVersion,
      parametersJson,
      parameterHash,
      input.codeCommit.toLowerCase(),
      createdAt,
    );
  return {
    analysis_run_id: analysisRunId,
    parameter_hash: parameterHash,
    created: Number(inserted.changes) === 1,
    status: "READY",
  };
}
