import { readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";

import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import { parseClassMarketAvailabilityDocument } from "../evidence/class-market-availability.ts";
import { parseGate0BCoverageEvidenceDocument } from "../evidence/coverage-snapshots.ts";
import { evaluateGate0B } from "../gates/coverage-viability.ts";
import {
  evaluateGate0A,
  parseSourceViabilityDocument,
} from "../gates/source-viability.ts";

import {
  summarizeAcceptance,
  type AcceptanceCriterionResult,
  type PocAcceptanceResult,
} from "./summary.ts";

export interface PocAcceptanceInput {
  analysisRunId: string;
  sourceViabilityPath: string;
  catalogPath: string;
  coverageEvidencePath: string;
  classAvailabilityPath: string;
  packagePath: string;
  analysisModelPath: string;
  checkedAt?: string;
}

function criterion(
  id: AcceptanceCriterionResult["id"],
  title: string,
  pass: boolean,
  evidence: Record<string, unknown>,
  blockers: string[] = [],
): AcceptanceCriterionResult {
  return {
    id,
    title,
    status: pass ? "PASS" : "FAIL",
    evidence,
    blockers: pass ? [] : blockers,
  };
}

function count(
  db: DatabaseSync,
  sql: string,
  ...params: Array<string | number | null>
): number {
  const row = db.prepare(sql).get(...params) as
    | { count: number | bigint }
    | undefined;
  return Number(row?.count ?? 0);
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function requiredCohortStatus(
  db: DatabaseSync,
  analysisRunId: string,
  datasetSnapshotId: string,
): {
  evidence: Record<string, unknown>;
  pass: boolean;
  blockers: string[];
} {
  const required = ["SAMPLE_MARKET", "CORE", "PACK_EXPOSED", "PREMIUM_SCARCE"];
  const definitions = db.prepare(
    `SELECT cohort_id, name
     FROM dataset_snapshot_cohort_definition
     WHERE dataset_snapshot_id = ?`,
  ).all(datasetSnapshotId) as Array<{ cohort_id: string; name: string }>;
  const byName = new Map(definitions.map((row) => [row.name, row.cohort_id]));
  const details: Record<string, unknown> = {};
  const blockers: string[] = [];

  for (const name of required) {
    const cohortId = byName.get(name);
    if (!cohortId) {
      details[name] = { defined: false, index_ok: 0, relative_strength_ok: 0 };
      blockers.push(`${name} cohort is not defined in the dataset snapshot`);
      continue;
    }
    const indexOk = count(
      db,
      `SELECT COUNT(*) AS count
       FROM analysis_metric
       WHERE analysis_run_id = ?
         AND scope_type = 'COHORT'
         AND scope_id = ?
         AND metric_name = 'INDEX'
         AND status = 'OK'`,
      analysisRunId,
      cohortId,
    );
    const relativeOk = name === "SAMPLE_MARKET"
      ? indexOk
      : count(
          db,
          `SELECT COUNT(*) AS count
           FROM analysis_metric
           WHERE analysis_run_id = ?
             AND scope_type = 'COHORT'
             AND scope_id = ?
             AND metric_name = 'RELATIVE_STRENGTH'
             AND status = 'OK'`,
          analysisRunId,
          cohortId,
        );
    details[name] = {
      defined: true,
      cohort_id: cohortId,
      index_ok: indexOk,
      relative_strength_ok: relativeOk,
    };
    if (indexOk === 0) blockers.push(`${name} has no sufficient INDEX result`);
    if (name !== "SAMPLE_MARKET" && relativeOk === 0) {
      blockers.push(`${name} has no sufficient RELATIVE_STRENGTH result`);
    }
  }

  return { evidence: details, pass: blockers.length === 0, blockers };
}

export async function runPocAcceptance(
  db: DatabaseSync,
  input: PocAcceptanceInput,
): Promise<PocAcceptanceResult> {
  const run = db.prepare(
    `SELECT ar.dataset_snapshot_id, ar.parameters_json, ar.status,
            ds.analysis_cutoff, ds.schema_version
     FROM analysis_run ar
     JOIN dataset_snapshot ds ON ds.dataset_snapshot_id = ar.dataset_snapshot_id
     WHERE ar.analysis_run_id = ?`,
  ).get(input.analysisRunId) as {
    dataset_snapshot_id: string;
    parameters_json: string;
    status: string;
    analysis_cutoff: string;
    schema_version: number;
  } | undefined;
  if (!run) throw new TypeError(`analysis run ${input.analysisRunId} does not exist`);
  if (run.schema_version < 8) {
    throw new TypeError("acceptance requires a schema v8 or newer dataset snapshot");
  }

  const [sourceRaw, catalogRaw, coverageRaw, availabilityRaw, packageText, analysisModel] =
    await Promise.all([
      readJson(input.sourceViabilityPath),
      readJson(input.catalogPath),
      readJson(input.coverageEvidencePath),
      readJson(input.classAvailabilityPath),
      readFile(input.packagePath, "utf8"),
      readFile(input.analysisModelPath, "utf8"),
    ]);

  const sourceDocument = parseSourceViabilityDocument(sourceRaw);
  const gate0A = evaluateGate0A(sourceDocument);
  const datacenterSource = sourceDocument.evidence.find(
    (item) => item.source_id === "fconline-datacenter-price-history",
  );
  const datacenterGate = gate0A.sources.find(
    (item) => item.source_id === "fconline-datacenter-price-history",
  );

  const catalog = parseSeedCatalogDocument(catalogRaw);
  const coverage = parseGate0BCoverageEvidenceDocument(coverageRaw);
  const availability = parseClassMarketAvailabilityDocument(availabilityRaw);
  const gate0B = evaluateGate0B(catalog, coverage.snapshots, availability);
  const datasetSnapshotId = run.dataset_snapshot_id;
  const criteria: AcceptanceCriterionResult[] = [];

  const gate0AReady = Boolean(
    datacenterSource &&
      datacenterGate &&
      (datacenterGate.status === "READY_MANUAL" || datacenterGate.status === "READY_AUTOMATION") &&
      datacenterSource.source_url !== "UNKNOWN" &&
      datacenterSource.policy_url !== "UNKNOWN" &&
      datacenterSource.access_method !== "UNKNOWN" &&
      datacenterSource.price_semantics !== "UNKNOWN" &&
      datacenterSource.automation_decision !== "UNKNOWN",
  );
  criteria.push(criterion(
    "AC-001",
    "Gate 0A source viability evidence is complete",
    gate0AReady,
    {
      gate_status: gate0A.status,
      source_status: datacenterGate?.status ?? null,
      policy_checked_at: datacenterSource?.policy_checked_at ?? null,
      access_method: datacenterSource?.access_method ?? null,
      price_semantics: datacenterSource?.price_semantics ?? null,
      automation_decision: datacenterSource?.automation_decision ?? null,
    },
    ["official Data Center price-history source is not acceptance-ready"],
  ));

  criteria.push(criterion(
    "AC-002",
    "Frozen seed catalog contains 20–30 justified primary instruments",
    catalog.seeds.length >= 20 && catalog.seeds.length <= 30 &&
      catalog.seeds.every((seed) => seed.selection_reason.trim() !== ""),
    {
      catalog_id: catalog.catalog_id,
      status: catalog.status,
      seed_players: catalog.seeds.length,
      primary_instruments: catalog.seeds.length,
    },
    ["seed catalog must contain 20–30 players with selection rationale"],
  ));

  criteria.push(criterion(
    "AC-003",
    "Gate 0B primary-instrument coverage is READY",
    gate0B.status === "READY",
    {
      status: gate0B.status,
      passed: gate0B.passed,
      failed: gate0B.failed,
      total: gate0B.total,
      thresholds: gate0B.thresholds,
    },
    gate0B.instruments
      .filter((item) => item.status !== "PASS")
      .map((item) => `${item.player_key}: ${item.blockers.join(", ")}`),
  ));

  const priceInstruments = count(
    db,
    `SELECT COUNT(DISTINCT instrument_id) AS count
     FROM dataset_snapshot_price_point
     WHERE dataset_snapshot_id = ?`,
    datasetSnapshotId,
  );
  const metadataSpids = count(
    db,
    `SELECT COUNT(DISTINCT spid) AS count
     FROM dataset_snapshot_metadata
     WHERE dataset_snapshot_id = ?`,
    datasetSnapshotId,
  );
  const priceSources = count(
    db,
    `SELECT COUNT(*) AS count FROM dataset_snapshot_source
     WHERE dataset_snapshot_id = ? AND source_role = 'PRICE'`,
    datasetSnapshotId,
  );
  const metadataSources = count(
    db,
    `SELECT COUNT(*) AS count FROM dataset_snapshot_source
     WHERE dataset_snapshot_id = ? AND source_role = 'METADATA'`,
    datasetSnapshotId,
  );
  const identityPass = priceInstruments >= catalog.seeds.length &&
    metadataSpids >= catalog.seeds.length && priceSources > 0 && metadataSources > 0;
  criteria.push(criterion(
    "AC-004",
    "Price and metadata identities are linked with source provenance",
    identityPass,
    { price_instruments: priceInstruments, metadata_spids: metadataSpids, price_sources: priceSources, metadata_sources: metadataSources },
    ["price/metadata coverage or source provenance is incomplete for the frozen sample"],
  ));

  const usageSeeds = count(
    db,
    `SELECT COUNT(DISTINCT spid) AS count
     FROM dataset_snapshot_usage
     WHERE dataset_snapshot_id = ? AND spid IS NOT NULL`,
    datasetSnapshotId,
  );
  const usageSubjects = count(
    db,
    `SELECT COUNT(DISTINCT COALESCE(spid, instrument_id)) AS count
     FROM dataset_snapshot_usage
     WHERE dataset_snapshot_id = ?`,
    datasetSnapshotId,
  );
  criteria.push(criterion(
    "AC-005",
    "Usage observations cover at least 5 seed players and 10 card/instrument subjects",
    usageSeeds >= 5 && usageSubjects >= 10,
    { usage_seed_players: usageSeeds, usage_subjects: usageSubjects },
    ["usage coverage is below the PoC minimum"],
  ));

  const samePlayerRelations = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_relation dsr
     JOIN card_relation cr ON cr.relation_id = dsr.relation_id
     WHERE dsr.dataset_snapshot_id = ? AND cr.same_player = 1`,
    datasetSnapshotId,
  );
  const substituteRelations = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_relation dsr
     JOIN card_relation cr ON cr.relation_id = dsr.relation_id
     JOIN relation_snapshot rs
       ON rs.relation_id = dsr.relation_id AND rs.as_of = dsr.relation_as_of
     WHERE dsr.dataset_snapshot_id = ?
       AND cr.same_position = 1
       AND rs.shared_team_colors_json <> '[]'`,
    datasetSnapshotId,
  );
  const timedMemberships = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_cohort_membership
     WHERE dataset_snapshot_id = ? AND valid_from IS NOT NULL`,
    datasetSnapshotId,
  );
  criteria.push(criterion(
    "AC-006",
    "Same-player relations, team-color substitutes, and timed cohort membership are queryable",
    samePlayerRelations > 0 && substituteRelations > 0 && timedMemberships > 0,
    { same_player_relations: samePlayerRelations, substitute_relations: substituteRelations, timed_memberships: timedMemberships },
    [
      ...(samePlayerRelations === 0 ? ["no same-player relation exists in the accepted dataset"] : []),
      ...(substituteRelations === 0 ? ["no team-color substitute relation exists in the accepted dataset"] : []),
      ...(timedMemberships === 0 ? ["no time-valid cohort membership exists"] : []),
    ],
  ));

  const cohortStatus = requiredCohortStatus(db, input.analysisRunId, datasetSnapshotId);
  criteria.push(criterion(
    "AC-007",
    "Required market cohorts produce sufficient index and relative-strength results",
    cohortStatus.pass,
    cohortStatus.evidence,
    cohortStatus.blockers,
  ));

  const sampleCohort = db.prepare(
    `SELECT cohort_id FROM dataset_snapshot_cohort_definition
     WHERE dataset_snapshot_id = ? AND name = 'SAMPLE_MARKET'`,
  ).get(datasetSnapshotId) as { cohort_id: string } | undefined;
  const lockerAnchor = count(
    db,
    `SELECT COUNT(*) AS count FROM event_replay_anchor
     WHERE analysis_run_id = ?
       AND event_id = 'locker-room-talk-11-2026-09-28'
       AND anchor_type = 'ANNOUNCED'`,
    input.analysisRunId,
  );
  const lockerComparisonRows = count(
    db,
    `SELECT COUNT(*) AS count FROM event_replay_metric
     WHERE analysis_run_id = ?
       AND event_id = 'locker-room-talk-11-2026-09-28'
       AND anchor_type = 'ANNOUNCED'
       AND status = 'OK'
       AND scope_id <> ?`,
    input.analysisRunId,
    sampleCohort?.cohort_id ?? "__missing__",
  );
  criteria.push(criterion(
    "AC-008",
    "Locker Room Talk 11 replay contains announced-at windows and comparison results",
    lockerAnchor > 0 && lockerComparisonRows > 0,
    { announced_anchor: lockerAnchor, comparison_ok_rows: lockerComparisonRows },
    ["Locker Room Talk 11 announced-at replay or comparison result is missing"],
  ));

  const sssDirect = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_exposure dse
     JOIN exposure e ON e.exposure_id = dse.exposure_id
     WHERE dse.dataset_snapshot_id = ?
       AND e.exposure_type = 'DIRECT'
       AND (e.event_id LIKE 'sss-mortar%' OR e.product_id LIKE 'sss-mortar%')`,
    datasetSnapshotId,
  );
  const sssComparison = count(
    db,
    `SELECT COUNT(*) AS count
     FROM event_replay_metric erm
     JOIN dataset_snapshot_cohort_definition dscd
       ON dscd.dataset_snapshot_id = ? AND dscd.cohort_id = erm.scope_id
     WHERE erm.analysis_run_id = ?
       AND erm.event_id LIKE 'sss-mortar%'
       AND dscd.name = 'CORE'
       AND erm.status = 'OK'`,
    datasetSnapshotId,
    input.analysisRunId,
  );
  const sssShock = count(
    db,
    `SELECT COUNT(*) AS count FROM shock_score
     WHERE analysis_run_id = ? AND metric_date BETWEEN '2026-09-10' AND '2026-09-24'`,
    input.analysisRunId,
  );
  const sssFollowup = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_event
     WHERE dataset_snapshot_id = ?
       AND event_id = 'sss-mortar-early-sale-end-2026-09-18'`,
    datasetSnapshotId,
  );
  criteria.push(criterion(
    "AC-009",
    "SSS incident replay links direct exposure, comparison cohort, Shock evaluation, and follow-up event",
    sssDirect > 0 && sssComparison > 0 && sssShock > 0 && sssFollowup > 0,
    { direct_exposures: sssDirect, comparison_ok_rows: sssComparison, nearby_shock_scores: sssShock, followup_events: sssFollowup },
    [
      ...(sssDirect === 0 ? ["SSS direct exposure is absent from the accepted dataset"] : []),
      ...(sssComparison === 0 ? ["SSS CORE comparison replay has no sufficient result"] : []),
      ...(sssShock === 0 ? ["Shock detector did not evaluate the SSS timeline"] : []),
      ...(sssFollowup === 0 ? ["SSS follow-up event is missing"] : []),
    ],
  ));

  const parameters = JSON.parse(run.parameters_json) as Record<string, unknown>;
  const regimes = Array.isArray(parameters.regimes) ? parameters.regimes as Array<Record<string, unknown>> : [];
  const configuredRegime = regimes.find(
    (item) => item.event_id === "market-rule-26tots-11-2026-09-10",
  );
  const regimeScopedInstruments = count(
    db,
    `SELECT COUNT(DISTINCT dspp.instrument_id) AS count
     FROM dataset_snapshot_price_point dspp
     JOIN instrument i ON i.instrument_id = dspp.instrument_id
     JOIN player_card pc ON pc.spid = i.spid
     WHERE dspp.dataset_snapshot_id = ? AND pc.season = '26TOTS' AND i.grade = 11`,
    datasetSnapshotId,
  );
  const blockedRegimeReturns = count(
    db,
    `SELECT COUNT(*) AS count FROM analysis_metric
     WHERE analysis_run_id = ?
       AND scope_type = 'INSTRUMENT'
       AND metric_name = 'RETURN_1D'
       AND status = 'NO_RESULT'
       AND details_json LIKE '%REGIME_BOUNDARY:%'`,
    input.analysisRunId,
  );
  criteria.push(criterion(
    "AC-010",
    "Registered market-rule Regime blocks default returns across its boundary",
    Boolean(configuredRegime) && regimeScopedInstruments > 0 && blockedRegimeReturns > 0,
    { configured: Boolean(configuredRegime), scoped_instruments: regimeScopedInstruments, blocked_returns: blockedRegimeReturns },
    [
      ...(!configuredRegime ? ["26TOTS 11강 Regime is not configured"] : []),
      ...(regimeScopedInstruments === 0 ? ["accepted dataset contains no 26TOTS 11강 instrument to exercise the Regime"] : []),
      ...(blockedRegimeReturns === 0 ? ["no default return is recorded as blocked by a Regime boundary"] : []),
    ],
  ));

  const derivedRows = count(
    db,
    `SELECT COUNT(*) AS count FROM analysis_metric WHERE analysis_run_id = ?`,
    input.analysisRunId,
  );
  const snapshotSourceRows = count(
    db,
    `SELECT COUNT(*) AS count FROM dataset_snapshot_source WHERE dataset_snapshot_id = ?`,
    datasetSnapshotId,
  );
  const traceableSourceRows = count(
    db,
    `SELECT COUNT(*) AS count
     FROM dataset_snapshot_source dss
     JOIN source_snapshot ss ON ss.source_snapshot_id = dss.source_snapshot_id
     WHERE dss.dataset_snapshot_id = ?`,
    datasetSnapshotId,
  );
  criteria.push(criterion(
    "AC-011",
    "Derived rows trace through analysis run and dataset snapshot to source snapshots",
    derivedRows > 0 && snapshotSourceRows > 0 && traceableSourceRows === snapshotSourceRows,
    { derived_rows: derivedRows, snapshot_source_rows: snapshotSourceRows, traceable_source_rows: traceableSourceRows },
    ["analysis_run -> dataset_snapshot -> source_snapshot lineage is incomplete"],
  ));

  const sufficiencyNoResult = count(
    db,
    `SELECT COUNT(*) AS count FROM analysis_metric
     WHERE analysis_run_id = ?
       AND status = 'NO_RESULT'
       AND details_json LIKE '%min_valid_count%'`,
    input.analysisRunId,
  );
  criteria.push(criterion(
    "AC-012",
    "Metric sufficiency failures produce NO_RESULT instead of zero",
    sufficiencyNoResult > 0,
    { sufficiency_no_result_rows: sufficiencyNoResult },
    ["no sufficiency-driven NO_RESULT metric was found"],
  ));

  const cutoffReasonRows = count(
    db,
    `SELECT COUNT(*) AS count FROM event_replay_metric
     WHERE analysis_run_id = ? AND reason = 'ANALYSIS_CUTOFF'`,
    input.analysisRunId,
  );
  const futureUsage = count(
    db,
    `SELECT COUNT(*) AS count FROM dataset_snapshot_usage_history
     WHERE dataset_snapshot_id = ? AND usage_as_of > ?`,
    datasetSnapshotId,
    run.analysis_cutoff,
  );
  const futureRelations = count(
    db,
    `SELECT COUNT(*) AS count FROM dataset_snapshot_relation_history
     WHERE dataset_snapshot_id = ? AND relation_as_of > ?`,
    datasetSnapshotId,
    run.analysis_cutoff,
  );
  const futureMemberships = count(
    db,
    `SELECT COUNT(*) AS count FROM dataset_snapshot_cohort_membership
     WHERE dataset_snapshot_id = ? AND valid_from > ?`,
    datasetSnapshotId,
    run.analysis_cutoff,
  );
  criteria.push(criterion(
    "AC-013",
    "Replay excludes usage, relation, and cohort state beyond the analysis cutoff",
    cutoffReasonRows > 0 && futureUsage === 0 && futureRelations === 0 && futureMemberships === 0,
    { analysis_cutoff: run.analysis_cutoff, cutoff_result_rows: cutoffReasonRows, future_usage_rows: futureUsage, future_relation_rows: futureRelations, future_membership_rows: futureMemberships },
    ["replay cutoff evidence is missing or snapshot contains post-cutoff state"],
  ));

  const packageJson = JSON.parse(packageText) as Record<string, unknown>;
  const scriptsText = JSON.stringify(packageJson.scripts ?? {}).toLowerCase();
  const dependencyNames = Object.keys({
    ...((packageJson.dependencies ?? {}) as Record<string, unknown>),
    ...((packageJson.devDependencies ?? {}) as Record<string, unknown>),
  }).map((name) => name.toLowerCase());
  const noPythonRuntime = !scriptsText.includes("python") && !scriptsText.includes(".py");
  const noGenAiSdk = !dependencyNames.some((name) =>
    ["openai", "anthropic", "@google/generative-ai", "@google/genai"].includes(name)
  );
  const resultLayers = ["사실:", "계산:", "해석:", "가설:"].every((token) => analysisModel.includes(token));
  criteria.push(criterion(
    "AC-014",
    "Core analysis is reproducible without Python or generative-AI calls and preserves result layers",
    noPythonRuntime && noGenAiSdk && resultLayers,
    { no_python_runtime: noPythonRuntime, no_genai_sdk: noGenAiSdk, result_layers_documented: resultLayers },
    ["runtime dependency or documented result-layer separation does not meet the PoC contract"],
  ));

  if (criteria.length !== 14) {
    throw new Error(`acceptance implementation must emit 14 criteria, got ${criteria.length}`);
  }
  return summarizeAcceptance(
    input.analysisRunId,
    datasetSnapshotId,
    criteria,
    input.checkedAt ?? new Date().toISOString(),
  );
}
