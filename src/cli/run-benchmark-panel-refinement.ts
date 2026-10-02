import type { DatabaseSync } from "node:sqlite";

import {
  parseRefinementPanelSizes,
  summarizePassTail,
  validateRefinementPanelSizes,
} from "../benchmark/panel-refinement.ts";
import { buildBenchmarkPanels } from "../benchmark/panel.ts";
import {
  runBenchmarkMetrics,
} from "../benchmark/metrics.ts";
import { runBenchmarkSignalDiagnostic } from "../benchmark/signal-diagnostic.ts";
import { runBenchmarkSignalCandidates } from "../benchmark/signal-candidates.ts";
import { benchmarkDiscoveryStatus } from "../benchmark/discovery-status.ts";
import { openMarketDatabase } from "../db/market-db.ts";

interface BaselineRow {
  benchmark_signal_candidate_run_id: string;
  benchmark_signal_diagnostic_run_id: string;
  benchmark_metric_run_id: string;
  panel_family_id: string;
  evaluation_version: string;
  mover_winsor_ratio: number;
  minimum_common_valid_days: number | bigint;
  return_median_abs_diff_max: number;
  return_p95_abs_diff_max: number;
  direction_match_ratio_min: number;
  diagnostic_version: string;
  trim_ratio: number;
  zero_dominance_threshold: number;
  metric_version: string;
  analysis_cutoff: string;
  timezone: string;
  price_semantics: string;
  minimum_weighted_coverage: number;
  discovery_frame_id: string;
  universe_snapshot_id: string;
  panel_version: string;
  sample_seed: string;
  effective_from: string;
  panel_sizes_json: string;
}

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function baselineRow(db: DatabaseSync, requested?: string): BaselineRow {
  const select = `SELECT
      bscr.benchmark_signal_candidate_run_id,
      bscr.benchmark_signal_diagnostic_run_id,
      bscr.benchmark_metric_run_id,
      bscr.panel_family_id,
      bscr.evaluation_version,
      bscr.mover_winsor_ratio,
      bscr.minimum_common_valid_days,
      bscr.return_median_abs_diff_max,
      bscr.return_p95_abs_diff_max,
      bscr.direction_match_ratio_min,
      bsdr.diagnostic_version,
      bsdr.trim_ratio,
      bsdr.zero_dominance_threshold,
      bmr.metric_version,
      bmr.analysis_cutoff,
      bmr.timezone,
      bmr.price_semantics,
      bmr.minimum_weighted_coverage,
      bpf.discovery_frame_id,
      bpf.universe_snapshot_id,
      bpf.panel_version,
      bpf.sample_seed,
      bpf.effective_from,
      bpf.panel_sizes_json
    FROM benchmark_signal_candidate_run bscr
    JOIN benchmark_signal_diagnostic_run bsdr
      ON bsdr.benchmark_signal_diagnostic_run_id = bscr.benchmark_signal_diagnostic_run_id
    JOIN benchmark_metric_run bmr
      ON bmr.benchmark_metric_run_id = bscr.benchmark_metric_run_id
    JOIN benchmark_panel_family bpf
      ON bpf.panel_family_id = bscr.panel_family_id
    WHERE bscr.status = 'SUCCEEDED'`;

  if (requested !== undefined) {
    const value = requested.trim();
    if (value === "") throw new TypeError("--candidate-run must not be empty");
    const row = db.prepare(`${select} AND bscr.benchmark_signal_candidate_run_id = ?`)
      .get(value) as BaselineRow | undefined;
    if (!row) throw new TypeError(`unknown signal candidate run: ${value}`);
    return row;
  }

  const row = db.prepare(
    `${select}
       AND bpf.panel_sizes_json = '[100,200,400,800]'
     ORDER BY bscr.created_at DESC, bscr.benchmark_signal_candidate_run_id DESC
     LIMIT 1`,
  ).get() as BaselineRow | undefined;
  if (!row) {
    throw new TypeError(
      "no baseline [100,200,400,800] signal candidate run exists; run benchmark:signal-candidates first",
    );
  }
  return row;
}

function panelIdsBySize(db: DatabaseSync, familyId: string): Map<number, string> {
  const rows = db.prepare(
    `SELECT panel_id, panel_size
     FROM benchmark_panel
     WHERE panel_family_id = ?
     ORDER BY panel_size`,
  ).all(familyId) as Array<{ panel_id: string; panel_size: number | bigint }>;
  return new Map(rows.map((row) => [Number(row.panel_size), row.panel_id]));
}

function membershipSignature(db: DatabaseSync, panelId: string): string {
  const rows = db.prepare(
    `SELECT player_id, admission_rank, selection_hash, stratum_id, anchor_instrument_id
     FROM benchmark_panel_member
     WHERE panel_id = ?
     ORDER BY admission_rank, player_id`,
  ).all(panelId) as Array<{
    player_id: string;
    admission_rank: number | bigint;
    selection_hash: string;
    stratum_id: string;
    anchor_instrument_id: string;
  }>;
  return JSON.stringify(rows.map((row) => ({
    player_id: row.player_id,
    admission_rank: Number(row.admission_rank),
    selection_hash: row.selection_hash,
    stratum_id: row.stratum_id,
    anchor_instrument_id: row.anchor_instrument_id,
  })));
}

function assertSharedMembership(
  db: DatabaseSync,
  baselineFamilyId: string,
  refinementFamilyId: string,
  sharedSizes: readonly number[],
): void {
  const baseline = panelIdsBySize(db, baselineFamilyId);
  const refinement = panelIdsBySize(db, refinementFamilyId);
  for (const size of sharedSizes) {
    const baselinePanel = baseline.get(size);
    const refinementPanel = refinement.get(size);
    if (!baselinePanel || !refinementPanel) {
      throw new TypeError(`shared panel P${size} is missing from baseline or refinement family`);
    }
    if (membershipSignature(db, baselinePanel) !== membershipSignature(db, refinementPanel)) {
      throw new TypeError(
        `refinement P${size} membership differs from baseline; panel-size comparison would be confounded`,
      );
    }
  }
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const requestedBaseline = readOption(args, "candidate-run");
const requestedSizes = parseRefinementPanelSizes(readOption(args, "panel-sizes"));
const createdAt = readOption(args, "created-at");

const db = openMarketDatabase(dbPath);
try {
  const baseline = baselineRow(db, requestedBaseline);
  const baselineSizes = JSON.parse(baseline.panel_sizes_json) as unknown;
  if (
    !Array.isArray(baselineSizes) ||
    baselineSizes.some((value) => !Number.isSafeInteger(value) || Number(value) <= 0)
  ) {
    throw new TypeError(`baseline panel_sizes_json is invalid: ${baseline.panel_sizes_json}`);
  }
  const normalizedBaselineSizes = baselineSizes.map(Number);
  const sharedSizes = validateRefinementPanelSizes(
    requestedSizes,
    normalizedBaselineSizes,
  );

  const discoveryStatus = benchmarkDiscoveryStatus(db, baseline.discovery_frame_id);
  if (discoveryStatus.readiness !== "READY_FOR_PANEL") {
    throw new TypeError(
      `baseline discovery ${baseline.discovery_frame_id} is ${discoveryStatus.readiness}; refinement requires READY_FOR_PANEL`,
    );
  }

  const panel = buildBenchmarkPanels(db, {
    discoveryStatus,
    universeSnapshotId: baseline.universe_snapshot_id,
    panelVersion: baseline.panel_version,
    sampleSeed: baseline.sample_seed,
    panelSizes: requestedSizes,
    effectiveFrom: baseline.effective_from,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });

  assertSharedMembership(
    db,
    baseline.panel_family_id,
    panel.panel_family_id,
    sharedSizes,
  );

  const metric = runBenchmarkMetrics(db, {
    panelFamilyId: panel.panel_family_id,
    analysisCutoff: baseline.analysis_cutoff,
    metricVersion: baseline.metric_version,
    timezone: baseline.timezone,
    priceSemantics: baseline.price_semantics,
    minimumWeightedCoverage: baseline.minimum_weighted_coverage,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });

  const diagnostic = runBenchmarkSignalDiagnostic(db, {
    benchmarkMetricRunId: metric.benchmark_metric_run_id,
    diagnosticVersion: baseline.diagnostic_version,
    trimRatio: baseline.trim_ratio,
    zeroDominanceThreshold: baseline.zero_dominance_threshold,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });

  const candidates = runBenchmarkSignalCandidates(db, {
    benchmarkSignalDiagnosticRunId: diagnostic.benchmark_signal_diagnostic_run_id,
    evaluationVersion: baseline.evaluation_version,
    moverWinsorRatio: baseline.mover_winsor_ratio,
    minimumCommonValidDays: Number(baseline.minimum_common_valid_days),
    returnMedianAbsDiffMax: baseline.return_median_abs_diff_max,
    returnP95AbsDiffMax: baseline.return_p95_abs_diff_max,
    directionMatchRatioMin: baseline.direction_match_ratio_min,
    ...(createdAt !== undefined ? { createdAt } : {}),
  });

  console.log(JSON.stringify({
    status: "READY",
    db_path: dbPath,
    baseline_candidate_run_id: baseline.benchmark_signal_candidate_run_id,
    baseline_panel_family_id: baseline.panel_family_id,
    baseline_panel_sizes: normalizedBaselineSizes,
    refinement_panel_family_id: panel.panel_family_id,
    refinement_panel_sizes: requestedSizes,
    shared_membership_verified_sizes: sharedSizes,
    benchmark_metric_run_id: metric.benchmark_metric_run_id,
    benchmark_signal_diagnostic_run_id: diagnostic.benchmark_signal_diagnostic_run_id,
    benchmark_signal_candidate_run_id: candidates.benchmark_signal_candidate_run_id,
    created: {
      panel_family: panel.created,
      metric_run: metric.created,
      diagnostic_run: diagnostic.created,
      candidate_run: candidates.created,
    },
    candidates: candidates.candidates.map((candidate) => ({
      ...candidate,
      pass_tail: summarizePassTail(candidate.pairs),
    })),
  }, null, 2));
} finally {
  db.close();
}
