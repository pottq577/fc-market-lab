import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const BENCHMARK_ANALYSIS_VERSION = "market-benchmark-v1";
export const BENCHMARK_DATASET_CATALOG_ID = "MARKET_BENCHMARK_V1";

interface ConvergenceRunRow {
  benchmark_convergence_run_id: string;
  benchmark_uncertainty_run_id: string;
  benchmark_metric_run_id: string;
  panel_family_id: string;
  benchmark_status: "STABLE" | "UNSTABLE";
  selected_panel_id: string | null;
  input_hash: string;
  result_hash: string;
}

interface MetricRunRow {
  benchmark_metric_run_id: string;
  analysis_cutoff: string;
  input_hash: string;
  result_hash: string;
}

interface PanelFamilyRow {
  panel_family_id: string;
  universe_snapshot_id: string;
  panel_version: string;
  sample_seed: string;
  effective_from: string;
}

interface UniverseRow {
  universe_snapshot_id: string;
  source_hash: string;
}

interface PanelRow {
  panel_id: string;
  panel_label: string;
  panel_size: number | bigint;
}

interface FrozenPriceRow {
  source_snapshot_id: string;
  instrument_id: string;
  source_timestamp: string;
}

export interface PublishBenchmarkResult {
  dataset_snapshot_id: string;
  analysis_run_id: string;
  benchmark_convergence_run_id: string;
  benchmark_metric_run_id: string;
  panel_family_id: string;
  universe_snapshot_id: string;
  display_panel_id: string;
  display_panel_label: string;
  display_panel_size: number;
  display_role: "SELECTED_PRODUCTION" | "DIAGNOSTIC_LARGEST";
  benchmark_status: "STABLE" | "UNSTABLE";
  frozen_price_points: number;
  frozen_sources: number;
  dataset_created: boolean;
  analysis_run_created: boolean;
  publication_created: boolean;
}

function canonicalJson(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === "object") {
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
    throw new TypeError("benchmark publication payload must contain finite JSON values");
  }
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeTimestamp(value: string, field: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${field} must include an explicit timezone`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`${field} must be an ISO-8601-compatible timestamp`);
  }
  return parsed.toISOString();
}

function normalizeCommit(value: string): string {
  const commit = value.trim().toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(commit)) {
    throw new TypeError("codeCommit must be a Git commit SHA");
  }
  return commit;
}

export function resolveBenchmarkConvergenceRunId(
  db: DatabaseSync,
  requested?: string,
): string {
  if (requested !== undefined) {
    const value = requested.trim();
    if (value === "") throw new TypeError("benchmarkConvergenceRunId must not be empty");
    const found = db.prepare(
      `SELECT benchmark_convergence_run_id
       FROM benchmark_convergence_run
       WHERE benchmark_convergence_run_id = ? AND status = 'SUCCEEDED'`,
    ).get(value) as { benchmark_convergence_run_id: string } | undefined;
    if (!found) throw new TypeError(`unknown benchmark convergence run: ${value}`);
    return found.benchmark_convergence_run_id;
  }
  const latest = db.prepare(
    `SELECT benchmark_convergence_run_id
     FROM benchmark_convergence_run
     WHERE status = 'SUCCEEDED'
     ORDER BY created_at DESC, benchmark_convergence_run_id DESC
     LIMIT 1`,
  ).get() as { benchmark_convergence_run_id: string } | undefined;
  if (!latest) throw new TypeError("no successful benchmark convergence run exists");
  return latest.benchmark_convergence_run_id;
}

function convergenceRun(db: DatabaseSync, runId: string): ConvergenceRunRow {
  const row = db.prepare(
    `SELECT benchmark_convergence_run_id, benchmark_uncertainty_run_id,
            benchmark_metric_run_id, panel_family_id, benchmark_status,
            selected_panel_id, input_hash, result_hash
     FROM benchmark_convergence_run
     WHERE benchmark_convergence_run_id = ? AND status = 'SUCCEEDED'`,
  ).get(runId) as ConvergenceRunRow | undefined;
  if (!row) throw new TypeError(`unknown benchmark convergence run: ${runId}`);
  return row;
}

function metricRun(db: DatabaseSync, runId: string): MetricRunRow {
  const row = db.prepare(
    `SELECT benchmark_metric_run_id, analysis_cutoff, input_hash, result_hash
     FROM benchmark_metric_run
     WHERE benchmark_metric_run_id = ? AND status = 'SUCCEEDED'`,
  ).get(runId) as MetricRunRow | undefined;
  if (!row) throw new TypeError(`unknown benchmark metric run: ${runId}`);
  return row;
}

function panelFamily(db: DatabaseSync, familyId: string): PanelFamilyRow {
  const row = db.prepare(
    `SELECT panel_family_id, universe_snapshot_id, panel_version,
            sample_seed, effective_from
     FROM benchmark_panel_family
     WHERE panel_family_id = ?`,
  ).get(familyId) as PanelFamilyRow | undefined;
  if (!row) throw new TypeError(`unknown benchmark panel family: ${familyId}`);
  return row;
}

function universe(db: DatabaseSync, universeSnapshotId: string): UniverseRow {
  const row = db.prepare(
    `SELECT universe_snapshot_id, source_hash
     FROM market_universe_snapshot
     WHERE universe_snapshot_id = ?`,
  ).get(universeSnapshotId) as UniverseRow | undefined;
  if (!row) throw new TypeError(`unknown market universe snapshot: ${universeSnapshotId}`);
  return row;
}

function displayPanel(
  db: DatabaseSync,
  convergence: ConvergenceRunRow,
): { panel: PanelRow; role: "SELECTED_PRODUCTION" | "DIAGNOSTIC_LARGEST" } {
  if (convergence.selected_panel_id !== null) {
    const selected = db.prepare(
      `SELECT panel_id, panel_label, panel_size
       FROM benchmark_panel
       WHERE panel_family_id = ? AND panel_id = ?`,
    ).get(convergence.panel_family_id, convergence.selected_panel_id) as PanelRow | undefined;
    if (!selected) {
      throw new TypeError(`selected benchmark panel ${convergence.selected_panel_id} is unavailable`);
    }
    return { panel: selected, role: "SELECTED_PRODUCTION" };
  }
  const largest = db.prepare(
    `SELECT panel_id, panel_label, panel_size
     FROM benchmark_panel
     WHERE panel_family_id = ?
     ORDER BY panel_size DESC, panel_id DESC
     LIMIT 1`,
  ).get(convergence.panel_family_id) as PanelRow | undefined;
  if (!largest) throw new TypeError(`panel family ${convergence.panel_family_id} has no panels`);
  return { panel: largest, role: "DIAGNOSTIC_LARGEST" };
}

export function publishBenchmarkRun(
  db: DatabaseSync,
  input: {
    benchmarkConvergenceRunId: string;
    codeCommit: string;
    schemaVersion: number;
    createdAt?: string;
  },
): PublishBenchmarkResult {
  const convergence = convergenceRun(db, input.benchmarkConvergenceRunId.trim());
  const metric = metricRun(db, convergence.benchmark_metric_run_id);
  const family = panelFamily(db, convergence.panel_family_id);
  const universeRow = universe(db, family.universe_snapshot_id);
  const display = displayPanel(db, convergence);
  const codeCommit = normalizeCommit(input.codeCommit);
  const createdAt = normalizeTimestamp(input.createdAt ?? new Date().toISOString(), "createdAt");
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion <= 0) {
    throw new TypeError("schemaVersion must be a positive safe integer");
  }

  const frozenPrices = db.prepare(
    `SELECT source_snapshot_id, instrument_id, source_timestamp
     FROM benchmark_metric_input_price
     WHERE benchmark_metric_run_id = ?
     ORDER BY instrument_id, source_timestamp, source_snapshot_id`,
  ).all(metric.benchmark_metric_run_id) as FrozenPriceRow[];
  if (frozenPrices.length === 0) {
    throw new TypeError(`benchmark metric run ${metric.benchmark_metric_run_id} has no frozen prices`);
  }

  const universeSources = db.prepare(
    `SELECT source_snapshot_id
     FROM market_universe_source
     WHERE universe_snapshot_id = ?
     ORDER BY source_snapshot_id`,
  ).all(family.universe_snapshot_id) as Array<{ source_snapshot_id: string }>;
  if (universeSources.length === 0) {
    throw new TypeError(`universe ${family.universe_snapshot_id} has no source provenance`);
  }

  const panelMembers = db.prepare(
    `SELECT bp.panel_id, bp.panel_size, bpm.player_id, bpm.anchor_instrument_id,
            bpm.stratum_id, bpm.population_weight, bpm.admission_rank
     FROM benchmark_panel bp
     JOIN benchmark_panel_member bpm ON bpm.panel_id = bp.panel_id
     WHERE bp.panel_family_id = ?
     ORDER BY bp.panel_size, bpm.admission_rank, bpm.player_id`,
  ).all(family.panel_family_id).map((row) => ({ ...row }));
  if (panelMembers.length === 0) {
    throw new TypeError(`panel family ${family.panel_family_id} has no members`);
  }

  const catalogHash = sha256(canonicalJson({
    panel_family_id: family.panel_family_id,
    universe_snapshot_id: family.universe_snapshot_id,
    universe_source_hash: universeRow.source_hash,
    panel_version: family.panel_version,
    sample_seed: family.sample_seed,
    panel_members: panelMembers,
  }));
  const sourceKeys = [
    ...new Set([
      ...frozenPrices.map((row) => `BENCHMARK_PRICE:${row.source_snapshot_id}`),
      ...universeSources.map((row) => `BENCHMARK_UNIVERSE:${row.source_snapshot_id}`),
    ]),
  ].sort();
  const manifest = {
    version: 1,
    schema_version: input.schemaVersion,
    analysis_cutoff: metric.analysis_cutoff,
    catalog_id: BENCHMARK_DATASET_CATALOG_ID,
    catalog_hash: catalogHash,
    benchmark_convergence_run_id: convergence.benchmark_convergence_run_id,
    benchmark_convergence_input_hash: convergence.input_hash,
    benchmark_convergence_result_hash: convergence.result_hash,
    benchmark_metric_run_id: metric.benchmark_metric_run_id,
    benchmark_metric_input_hash: metric.input_hash,
    benchmark_metric_result_hash: metric.result_hash,
    panel_family_id: family.panel_family_id,
    universe_snapshot_id: family.universe_snapshot_id,
    display_panel_id: display.panel.panel_id,
    display_role: display.role,
    source_keys: sourceKeys,
    price_point_keys: frozenPrices.map(
      (row) => `${row.source_snapshot_id}:${row.instrument_id}:${row.source_timestamp}`,
    ),
  };
  const inputHash = sha256(canonicalJson(manifest));
  const datasetSnapshotId = deterministicId("dataset", inputHash);

  const parameters = {
    benchmark_convergence_run_id: convergence.benchmark_convergence_run_id,
    benchmark_uncertainty_run_id: convergence.benchmark_uncertainty_run_id,
    benchmark_metric_run_id: metric.benchmark_metric_run_id,
    panel_family_id: family.panel_family_id,
    universe_snapshot_id: family.universe_snapshot_id,
    display_panel_id: display.panel.panel_id,
    display_role: display.role,
    benchmark_status: convergence.benchmark_status,
  };
  const parametersJson = canonicalJson(parameters);
  const parameterHash = sha256(parametersJson);
  const analysisIdentity = canonicalJson({
    dataset_snapshot_id: datasetSnapshotId,
    analysis_version: BENCHMARK_ANALYSIS_VERSION,
    parameter_hash: parameterHash,
    code_commit: codeCommit,
  });
  const analysisRunId = deterministicId("run", analysisIdentity);

  db.exec("BEGIN IMMEDIATE");
  try {
    const snapshotInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot(
        dataset_snapshot_id, catalog_id, analysis_cutoff, created_at,
        schema_version, catalog_hash, input_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      datasetSnapshotId,
      BENCHMARK_DATASET_CATALOG_ID,
      metric.analysis_cutoff,
      createdAt,
      input.schemaVersion,
      catalogHash,
      inputHash,
    );
    const snapshot = db.prepare(
      `SELECT catalog_id, analysis_cutoff, schema_version, catalog_hash, input_hash
       FROM dataset_snapshot WHERE dataset_snapshot_id = ?`,
    ).get(datasetSnapshotId) as {
      catalog_id: string;
      analysis_cutoff: string;
      schema_version: number | bigint;
      catalog_hash: string;
      input_hash: string;
    };
    if (
      snapshot.catalog_id !== BENCHMARK_DATASET_CATALOG_ID ||
      snapshot.analysis_cutoff !== metric.analysis_cutoff ||
      Number(snapshot.schema_version) !== input.schemaVersion ||
      snapshot.catalog_hash !== catalogHash ||
      snapshot.input_hash !== inputHash
    ) {
      throw new TypeError(`benchmark dataset snapshot identity conflict for ${datasetSnapshotId}`);
    }

    const sourceInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_source(
        dataset_snapshot_id, source_snapshot_id, source_role
      ) VALUES (?, ?, ?)`,
    );
    const priceSourceIds = [...new Set(frozenPrices.map((row) => row.source_snapshot_id))].sort();
    for (const sourceId of priceSourceIds) {
      sourceInsert.run(datasetSnapshotId, sourceId, "BENCHMARK_PRICE");
    }
    for (const row of universeSources) {
      sourceInsert.run(datasetSnapshotId, row.source_snapshot_id, "BENCHMARK_UNIVERSE");
    }

    const priceInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_price_point(
        dataset_snapshot_id, source_snapshot_id, instrument_id, source_timestamp
      ) VALUES (?, ?, ?, ?)`,
    );
    for (const row of frozenPrices) {
      priceInsert.run(
        datasetSnapshotId,
        row.source_snapshot_id,
        row.instrument_id,
        row.source_timestamp,
      );
    }

    const runInsert = db.prepare(
      `INSERT OR IGNORE INTO analysis_run(
        analysis_run_id, dataset_snapshot_id, analysis_version,
        parameters_json, parameter_hash, code_commit, created_at,
        status, result_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCEEDED', ?)`,
    ).run(
      analysisRunId,
      datasetSnapshotId,
      BENCHMARK_ANALYSIS_VERSION,
      parametersJson,
      parameterHash,
      codeCommit,
      createdAt,
      convergence.result_hash,
    );
    const run = db.prepare(
      `SELECT dataset_snapshot_id, analysis_version, parameter_hash,
              code_commit, status, result_hash
       FROM analysis_run WHERE analysis_run_id = ?`,
    ).get(analysisRunId) as {
      dataset_snapshot_id: string;
      analysis_version: string;
      parameter_hash: string;
      code_commit: string;
      status: string;
      result_hash: string | null;
    };
    if (
      run.dataset_snapshot_id !== datasetSnapshotId ||
      run.analysis_version !== BENCHMARK_ANALYSIS_VERSION ||
      run.parameter_hash !== parameterHash ||
      run.code_commit !== codeCommit ||
      run.status !== "SUCCEEDED" ||
      run.result_hash !== convergence.result_hash
    ) {
      throw new TypeError(`benchmark analysis run identity conflict for ${analysisRunId}`);
    }

    const publicationInsert = db.prepare(
      `INSERT OR IGNORE INTO dataset_snapshot_benchmark(
        dataset_snapshot_id,
        benchmark_convergence_run_id, benchmark_uncertainty_run_id,
        benchmark_metric_run_id, panel_family_id, universe_snapshot_id,
        display_panel_id, display_role, benchmark_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      datasetSnapshotId,
      convergence.benchmark_convergence_run_id,
      convergence.benchmark_uncertainty_run_id,
      metric.benchmark_metric_run_id,
      family.panel_family_id,
      family.universe_snapshot_id,
      display.panel.panel_id,
      display.role,
      convergence.benchmark_status,
      createdAt,
    );
    const publication = db.prepare(
      `SELECT benchmark_convergence_run_id,
              benchmark_metric_run_id, panel_family_id, universe_snapshot_id,
              display_panel_id, display_role, benchmark_status
       FROM dataset_snapshot_benchmark
       WHERE dataset_snapshot_id = ?`,
    ).get(datasetSnapshotId) as {
      benchmark_convergence_run_id: string;
      benchmark_metric_run_id: string;
      panel_family_id: string;
      universe_snapshot_id: string;
      display_panel_id: string;
      display_role: string;
      benchmark_status: string;
    };
    if (
      publication.benchmark_convergence_run_id !== convergence.benchmark_convergence_run_id ||
      publication.benchmark_metric_run_id !== metric.benchmark_metric_run_id ||
      publication.panel_family_id !== family.panel_family_id ||
      publication.universe_snapshot_id !== family.universe_snapshot_id ||
      publication.display_panel_id !== display.panel.panel_id ||
      publication.display_role !== display.role ||
      publication.benchmark_status !== convergence.benchmark_status
    ) {
      throw new TypeError(`benchmark publication identity conflict for ${datasetSnapshotId}`);
    }

    const persistedPriceCount = db.prepare(
      `SELECT COUNT(*) AS count
       FROM dataset_snapshot_price_point
       WHERE dataset_snapshot_id = ?`,
    ).get(datasetSnapshotId) as { count: number | bigint };
    if (Number(persistedPriceCount.count) !== frozenPrices.length) {
      throw new Error(
        `benchmark dataset ${datasetSnapshotId} persisted ${String(persistedPriceCount.count)} price rows, expected ${frozenPrices.length}`,
      );
    }

    db.exec("COMMIT");
    return {
      dataset_snapshot_id: datasetSnapshotId,
      analysis_run_id: analysisRunId,
      benchmark_convergence_run_id: convergence.benchmark_convergence_run_id,
      benchmark_metric_run_id: metric.benchmark_metric_run_id,
      panel_family_id: family.panel_family_id,
      universe_snapshot_id: family.universe_snapshot_id,
      display_panel_id: display.panel.panel_id,
      display_panel_label: display.panel.panel_label,
      display_panel_size: Number(display.panel.panel_size),
      display_role: display.role,
      benchmark_status: convergence.benchmark_status,
      frozen_price_points: frozenPrices.length,
      frozen_sources: sourceKeys.length,
      dataset_created: Number(snapshotInsert.changes) === 1,
      analysis_run_created: Number(runInsert.changes) === 1,
      publication_created: Number(publicationInsert.changes) === 1,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
