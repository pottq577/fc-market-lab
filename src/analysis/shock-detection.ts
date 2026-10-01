import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { median } from "./market-metrics.ts";

interface ShockParameters {
  baseline_window: number;
  min_baseline_count: number;
  robust_z_threshold: number;
}

interface ShockScoreRow {
  metric_date: string;
  scope_id: string;
  value: number | null;
  robust_z: number | null;
  status: "OK" | "NO_RESULT";
  baseline_count: number;
  baseline_median: number | null;
  baseline_mad: number | null;
  reason: string | null;
  is_candidate: boolean;
}

export interface RunShockDetectionResult {
  analysis_run_id: string;
  score_rows: number;
  ok_rows: number;
  no_result_rows: number;
  candidate_rows: number;
  result_hash: string;
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseShockParameters(value: unknown): ShockParameters {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("analysis parameters must be an object");
  }
  const block = (value as Record<string, unknown>).shock_detection;
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    throw new TypeError("analysis parameters.shock_detection must be an object");
  }
  const record = block as Record<string, unknown>;
  const baselineWindow = record.baseline_window;
  const minBaselineCount = record.min_baseline_count;
  const threshold = record.robust_z_threshold;
  if (!Number.isInteger(baselineWindow) || Number(baselineWindow) < 1) {
    throw new TypeError("shock_detection.baseline_window must be a positive integer");
  }
  if (
    !Number.isInteger(minBaselineCount) ||
    Number(minBaselineCount) < 1 ||
    Number(minBaselineCount) > Number(baselineWindow)
  ) {
    throw new TypeError(
      "shock_detection.min_baseline_count must be between 1 and baseline_window",
    );
  }
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) {
    throw new TypeError("shock_detection.robust_z_threshold must be positive");
  }
  return {
    baseline_window: Number(baselineWindow),
    min_baseline_count: Number(minBaselineCount),
    robust_z_threshold: threshold,
  };
}

function scoreSeries(
  rows: Array<{ metric_date: string; value: number | null; status: string }>,
  parameters: ShockParameters,
): ShockScoreRow[] {
  const history: number[] = [];
  return rows.map((row) => {
    const baseline = history.slice(-parameters.baseline_window);
    let score: ShockScoreRow;
    if (row.status !== "OK" || row.value === null) {
      score = {
        metric_date: row.metric_date,
        scope_id: "",
        value: row.value,
        robust_z: null,
        status: "NO_RESULT",
        baseline_count: baseline.length,
        baseline_median: null,
        baseline_mad: null,
        reason: "SOURCE_METRIC_NO_RESULT",
        is_candidate: false,
      };
    } else if (baseline.length < parameters.min_baseline_count) {
      score = {
        metric_date: row.metric_date,
        scope_id: "",
        value: row.value,
        robust_z: null,
        status: "NO_RESULT",
        baseline_count: baseline.length,
        baseline_median: baseline.length === 0 ? null : round(median(baseline)),
        baseline_mad: null,
        reason: "INSUFFICIENT_BASELINE",
        is_candidate: false,
      };
    } else {
      const center = median(baseline);
      const mad = median(baseline.map((value) => Math.abs(value - center)));
      if (mad === 0) {
        score = {
          metric_date: row.metric_date,
          scope_id: "",
          value: row.value,
          robust_z: null,
          status: "NO_RESULT",
          baseline_count: baseline.length,
          baseline_median: round(center),
          baseline_mad: 0,
          reason: "ZERO_MAD",
          is_candidate: false,
        };
      } else {
        const robustZ = round((0.6745 * (row.value - center)) / mad);
        score = {
          metric_date: row.metric_date,
          scope_id: "",
          value: row.value,
          robust_z: robustZ,
          status: "OK",
          baseline_count: baseline.length,
          baseline_median: round(center),
          baseline_mad: round(mad),
          reason: null,
          is_candidate: Math.abs(robustZ) >= parameters.robust_z_threshold,
        };
      }
    }
    if (row.status === "OK" && row.value !== null) history.push(row.value);
    return score;
  });
}

export function runShockDetection(
  db: DatabaseSync,
  analysisRunId: string,
): RunShockDetectionResult {
  const run = db.prepare(
    `SELECT ar.parameters_json, ds.schema_version
     FROM analysis_run ar
     JOIN dataset_snapshot ds ON ds.dataset_snapshot_id = ar.dataset_snapshot_id
     WHERE ar.analysis_run_id = ?`,
  ).get(analysisRunId) as { parameters_json: string; schema_version: number } | undefined;
  if (!run) throw new TypeError(`analysis run ${analysisRunId} does not exist`);
  if (run.schema_version < 8) {
    throw new TypeError(
      "analysis run uses a pre-shock/regime dataset snapshot; run prepare:analysis again",
    );
  }
  const parameters = parseShockParameters(JSON.parse(run.parameters_json) as unknown);
  const sourceRows = db.prepare(
    `SELECT metric_date, scope_id, value, status
     FROM analysis_metric
     WHERE analysis_run_id = ?
       AND scope_type = 'COHORT'
       AND metric_name = 'RETURN_1D'
     ORDER BY scope_id, metric_date`,
  ).all(analysisRunId) as Array<{
    metric_date: string;
    scope_id: string;
    value: number | null;
    status: string;
  }>;
  if (sourceRows.length === 0) {
    throw new TypeError("cohort RETURN_1D metrics are missing; run run:metrics first");
  }

  const byScope = new Map<string, typeof sourceRows>();
  for (const row of sourceRows) {
    const rows = byScope.get(row.scope_id) ?? [];
    rows.push(row);
    byScope.set(row.scope_id, rows);
  }

  const scores: ShockScoreRow[] = [];
  for (const [scopeId, rows] of byScope) {
    scores.push(
      ...scoreSeries(rows, parameters).map((row) => ({ ...row, scope_id: scopeId })),
    );
  }
  scores.sort((left, right) =>
    `${left.metric_date}\0${left.scope_id}`.localeCompare(
      `${right.metric_date}\0${right.scope_id}`,
    ),
  );
  const resultHash = sha256(canonicalJson(scores));

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM shock_candidate WHERE analysis_run_id = ?").run(analysisRunId);
    db.prepare("DELETE FROM shock_score WHERE analysis_run_id = ?").run(analysisRunId);
    const scoreInsert = db.prepare(
      `INSERT INTO shock_score(
        analysis_run_id, metric_date, scope_id, metric_name, value, robust_z,
        status, baseline_count, baseline_median, baseline_mad, reason,
        is_candidate, details_json
      ) VALUES (?, ?, ?, 'RETURN_1D', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const candidateInsert = db.prepare(
      `INSERT INTO shock_candidate(
        shock_candidate_id, analysis_run_id, metric_date, scope_id,
        metric_name, value, robust_z, severity, detector_version
      ) VALUES (?, ?, ?, ?, 'RETURN_1D', ?, ?, ?, 'robust-z-v1')`,
    );
    for (const row of scores) {
      scoreInsert.run(
        analysisRunId,
        row.metric_date,
        row.scope_id,
        row.value,
        row.robust_z,
        row.status,
        row.baseline_count,
        row.baseline_median,
        row.baseline_mad,
        row.reason,
        row.is_candidate ? 1 : 0,
        canonicalJson({
          baseline_window: parameters.baseline_window,
          min_baseline_count: parameters.min_baseline_count,
          robust_z_threshold: parameters.robust_z_threshold,
        }),
      );
      if (row.is_candidate) {
        const id = createHash("sha256")
          .update(`${analysisRunId}\0${row.scope_id}\0${row.metric_date}\0RETURN_1D`)
          .digest("hex");
        candidateInsert.run(
          `shock_${id}`,
          analysisRunId,
          row.metric_date,
          row.scope_id,
          row.value,
          row.robust_z,
          Math.abs(row.robust_z!),
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    analysis_run_id: analysisRunId,
    score_rows: scores.length,
    ok_rows: scores.filter((row) => row.status === "OK").length,
    no_result_rows: scores.filter((row) => row.status === "NO_RESULT").length,
    candidate_rows: scores.filter((row) => row.is_candidate).length,
    result_hash: resultHash,
  };
}
