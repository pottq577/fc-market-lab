import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "./run-context.ts";
import { parseMarketMetricParameters } from "./market-metrics.ts";
const REPLAY_VERSION = "event-replay-v1";
const WINDOW_OFFSETS = [-7, -3, -1, 0, 1, 3, 7] as const;
const REPLAY_METRICS = [
  "RETURN_1D",
  "INDEX",
  "RELATIVE_STRENGTH",
  "BREADTH",
  "IQR",
  "MAD",
] as const;
type AnchorType = "ANNOUNCED" | "EFFECTIVE" | "FIRST_OBSERVED";
type ReplayMetricName = (typeof REPLAY_METRICS)[number];
interface ReplayAnchor {
  event_id: string;
  anchor_type: AnchorType;
  anchor_at: string;
  anchor_date: string;
  details_json: string;
}
interface ReplayMetricRow {
  event_id: string;
  anchor_type: AnchorType;
  offset_days: number;
  metric_date: string;
  scope_id: string;
  metric_name: ReplayMetricName;
  value: number | null;
  status: "OK" | "NO_RESULT";
  reason: string | null;
}
export interface RunEventReplayResult {
  analysis_run_id: string;
  dataset_snapshot_id: string;
  anchors: number;
  metric_rows: number;
  ok_rows: number;
  no_result_rows: number;
  result_hash: string;
  created: boolean;
}
function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function dateInTimezone(timestamp: string, timezone: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`invalid timestamp: ${timestamp}`);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const read = (type: string) => parts.find((part) => part.type === type)?.value;
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!year || !month || !day) {
    throw new TypeError(`cannot format date in ${timezone}`);
  }
  return `${year}-${month}-${day}`;
}
function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`invalid replay date: ${date}`);
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
function eventAnchors(event: {
  event_id: string;
  announced_at: string | null;
  effective_at: string | null;
  first_observed_at: string | null;
}): Array<{ event_id: string; anchor_type: AnchorType; anchor_at: string }> {
  const anchors: Array<{ event_id: string; anchor_type: AnchorType; anchor_at: string }> = [];
  if (event.announced_at) {
    anchors.push({
      event_id: event.event_id,
      anchor_type: "ANNOUNCED",
      anchor_at: event.announced_at,
    });
  }
  if (event.effective_at && event.effective_at !== event.announced_at) {
    anchors.push({
      event_id: event.event_id,
      anchor_type: "EFFECTIVE",
      anchor_at: event.effective_at,
    });
  }
  if (!event.announced_at && !event.effective_at && event.first_observed_at) {
    anchors.push({
      event_id: event.event_id,
      anchor_type: "FIRST_OBSERVED",
      anchor_at: event.first_observed_at,
    });
  }
  return anchors;
}
function replayContext(
  db: DatabaseSync,
  datasetSnapshotId: string,
  anchorAt: string,
): Record<string, unknown> {
  const relationRows = db.prepare(
    `SELECT relation_id, MAX(relation_as_of) AS relation_as_of
     FROM dataset_snapshot_relation_history
     WHERE dataset_snapshot_id = ?
       AND relation_as_of <= ?
       AND relation_valid_from <= ?
       AND (relation_valid_to IS NULL OR ? < relation_valid_to)
     GROUP BY relation_id
     ORDER BY relation_id`,
  ).all(datasetSnapshotId, anchorAt, anchorAt, anchorAt) as Array<{
    relation_id: string;
    relation_as_of: string;
  }>;
  const cohortRows = db.prepare(
    `SELECT dscm.cohort_id, dscm.instrument_id, dscm.valid_from
     FROM dataset_snapshot_cohort_membership dscm
     JOIN dataset_snapshot_cohort_definition dscd
       ON dscd.dataset_snapshot_id = dscm.dataset_snapshot_id
      AND dscd.cohort_id = dscm.cohort_id
     WHERE dscm.dataset_snapshot_id = ?
       AND (
         dscd.name IN ('SAMPLE_MARKET', 'CORE')
         OR (
           dscm.valid_from <= ?
           AND (dscm.valid_to IS NULL OR ? < dscm.valid_to)
         )
       )
     ORDER BY dscm.cohort_id, dscm.instrument_id, dscm.valid_from`,
  ).all(datasetSnapshotId, anchorAt, anchorAt) as Array<{
    cohort_id: string;
    instrument_id: string;
    valid_from: string;
  }>;
  const usageRows = db.prepare(
    `SELECT dsuh.usage_point_id, dsuh.spid, dsuh.instrument_id, dsuh.usage_as_of
     FROM dataset_snapshot_usage_history dsuh
     WHERE dsuh.dataset_snapshot_id = ?
       AND dsuh.usage_as_of <= ?
     ORDER BY COALESCE(dsuh.spid, dsuh.instrument_id),
              dsuh.usage_as_of DESC,
              dsuh.usage_point_id DESC`,
  ).all(datasetSnapshotId, anchorAt) as Array<{
    usage_point_id: string;
    spid: string | null;
    instrument_id: string | null;
    usage_as_of: string;
  }>;
  const latestUsage = new Map<string, typeof usageRows[number]>();
  for (const row of usageRows) {
    const key = row.spid ? `SPID:${row.spid}` : `INSTRUMENT:${row.instrument_id}`;
    if (!latestUsage.has(key)) latestUsage.set(key, row);
  }
  return {
    relation_keys: relationRows.map(
      (row) => `${row.relation_id}:${row.relation_as_of}`,
    ),
    cohort_membership_keys: cohortRows.map(
      (row) => `${row.cohort_id}:${row.instrument_id}:${row.valid_from}`,
    ),
    usage_point_ids: [...latestUsage.values()]
      .map((row) => row.usage_point_id)
      .sort(),
  };
}
function replayMetricRows(
  db: DatabaseSync,
  input: {
    analysisRunId: string;
    datasetSnapshotId: string;
    anchor: ReplayAnchor;
    analysisCutoffDate: string;
  },
): ReplayMetricRow[] {
  const scopes = db.prepare(
    `SELECT cohort_id
     FROM dataset_snapshot_cohort_definition
     WHERE dataset_snapshot_id = ?
     ORDER BY cohort_id`,
  ).all(input.datasetSnapshotId) as Array<{ cohort_id: string }>;
  const selectMetric = db.prepare(
    `SELECT value, status
     FROM analysis_metric
     WHERE analysis_run_id = ?
       AND metric_date = ?
       AND scope_type = 'COHORT'
       AND scope_id = ?
       AND metric_name = ?`,
  );
  const rows: ReplayMetricRow[] = [];
  for (const offset of WINDOW_OFFSETS) {
    const metricDate = addDays(input.anchor.anchor_date, offset);
    for (const scope of scopes) {
      for (const metricName of REPLAY_METRICS) {
        if (metricDate > input.analysisCutoffDate) {
          rows.push({
            event_id: input.anchor.event_id,
            anchor_type: input.anchor.anchor_type,
            offset_days: offset,
            metric_date: metricDate,
            scope_id: scope.cohort_id,
            metric_name: metricName,
            value: null,
            status: "NO_RESULT",
            reason: "ANALYSIS_CUTOFF",
          });
          continue;
        }
        const metric = selectMetric.get(
          input.analysisRunId,
          metricDate,
          scope.cohort_id,
          metricName,
        ) as { value: number | null; status: string } | undefined;
        if (!metric) {
          rows.push({
            event_id: input.anchor.event_id,
            anchor_type: input.anchor.anchor_type,
            offset_days: offset,
            metric_date: metricDate,
            scope_id: scope.cohort_id,
            metric_name: metricName,
            value: null,
            status: "NO_RESULT",
            reason: "METRIC_UNAVAILABLE",
          });
          continue;
        }
        if (metric.status !== "OK" || metric.value === null) {
          rows.push({
            event_id: input.anchor.event_id,
            anchor_type: input.anchor.anchor_type,
            offset_days: offset,
            metric_date: metricDate,
            scope_id: scope.cohort_id,
            metric_name: metricName,
            value: null,
            status: "NO_RESULT",
            reason: "SOURCE_METRIC_NO_RESULT",
          });
          continue;
        }
        rows.push({
          event_id: input.anchor.event_id,
          anchor_type: input.anchor.anchor_type,
          offset_days: offset,
          metric_date: metricDate,
          scope_id: scope.cohort_id,
          metric_name: metricName,
          value: metric.value,
          status: "OK",
          reason: null,
        });
      }
    }
  }
  return rows;
}
export function runEventReplay(
  db: DatabaseSync,
  analysisRunId: string,
): RunEventReplayResult {
  const run = db.prepare(
    `SELECT ar.dataset_snapshot_id, ar.parameters_json, ar.status,
            ar.result_hash AS metric_result_hash,
            ds.analysis_cutoff, ds.schema_version
     FROM analysis_run ar
     JOIN dataset_snapshot ds ON ds.dataset_snapshot_id = ar.dataset_snapshot_id
     WHERE ar.analysis_run_id = ?`,
  ).get(analysisRunId) as {
    dataset_snapshot_id: string;
    parameters_json: string;
    status: string;
    metric_result_hash: string | null;
    analysis_cutoff: string;
    schema_version: number;
  } | undefined;
  if (!run) throw new TypeError(`analysis run ${analysisRunId} does not exist`);
  if (run.schema_version < 7) {
    throw new TypeError(
      "analysis run uses a pre-replay dataset snapshot; run prepare:analysis and run:metrics again",
    );
  }
  if (run.status !== "SUCCEEDED" || !run.metric_result_hash) {
    throw new TypeError("analysis metrics must succeed before event replay");
  }
  const parameters = parseMarketMetricParameters(
    JSON.parse(run.parameters_json) as unknown,
  );
  const analysisCutoffDate = dateInTimezone(
    run.analysis_cutoff,
    parameters.timezone,
  );
  const existing = db.prepare(
    `SELECT replay_version, result_hash
     FROM event_replay_run
     WHERE analysis_run_id = ?`,
  ).get(analysisRunId) as
    | { replay_version: string; result_hash: string }
    | undefined;
  const events = db.prepare(
    `SELECT e.event_id, e.announced_at, e.effective_at, e.first_observed_at
     FROM dataset_snapshot_event dse
     JOIN event e ON e.event_id = dse.event_id
     WHERE dse.dataset_snapshot_id = ?
     ORDER BY e.event_id`,
  ).all(run.dataset_snapshot_id) as Array<{
    event_id: string;
    announced_at: string | null;
    effective_at: string | null;
    first_observed_at: string | null;
  }>;
  const anchors: ReplayAnchor[] = [];
  const metricRows: ReplayMetricRow[] = [];
  for (const event of events) {
    for (const rawAnchor of eventAnchors(event)) {
      if (rawAnchor.anchor_at > run.analysis_cutoff) continue;
      const anchor: ReplayAnchor = {
        ...rawAnchor,
        anchor_date: dateInTimezone(rawAnchor.anchor_at, parameters.timezone),
        details_json: canonicalJson(
          replayContext(db, run.dataset_snapshot_id, rawAnchor.anchor_at),
        ),
      };
      anchors.push(anchor);
      metricRows.push(...replayMetricRows(db, {
        analysisRunId,
        datasetSnapshotId: run.dataset_snapshot_id,
        anchor,
        analysisCutoffDate,
      }));
    }
  }
  const manifest = {
    replay_version: REPLAY_VERSION,
    analysis_run_id: analysisRunId,
    metric_result_hash: run.metric_result_hash,
    anchors: anchors.map((anchor) => ({
      event_id: anchor.event_id,
      anchor_type: anchor.anchor_type,
      anchor_at: anchor.anchor_at,
      anchor_date: anchor.anchor_date,
      details_json: anchor.details_json,
    })),
    metrics: metricRows,
  };
  const resultHash = sha256(canonicalJson(manifest));
  if (existing) {
    if (
      existing.replay_version !== REPLAY_VERSION ||
      existing.result_hash !== resultHash
    ) {
      throw new TypeError(
        `event replay ${analysisRunId} conflicts with an existing result`,
      );
    }
    return {
      analysis_run_id: analysisRunId,
      dataset_snapshot_id: run.dataset_snapshot_id,
      anchors: anchors.length,
      metric_rows: metricRows.length,
      ok_rows: metricRows.filter((row) => row.status === "OK").length,
      no_result_rows: metricRows.filter((row) => row.status === "NO_RESULT").length,
      result_hash: resultHash,
      created: false,
    };
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const anchorInsert = db.prepare(
      `INSERT INTO event_replay_anchor(
        analysis_run_id, event_id, anchor_type, anchor_at, anchor_date, details_json
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const anchor of anchors) {
      anchorInsert.run(
        analysisRunId,
        anchor.event_id,
        anchor.anchor_type,
        anchor.anchor_at,
        anchor.anchor_date,
        anchor.details_json,
      );
    }
    const metricInsert = db.prepare(
      `INSERT INTO event_replay_metric(
        analysis_run_id, event_id, anchor_type, offset_days, metric_date,
        scope_id, metric_name, value, status, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of metricRows) {
      metricInsert.run(
        analysisRunId,
        row.event_id,
        row.anchor_type,
        row.offset_days,
        row.metric_date,
        row.scope_id,
        row.metric_name,
        row.value,
        row.status,
        row.reason,
      );
    }
    db.prepare(
      `INSERT INTO event_replay_run(
        analysis_run_id, replay_version, created_at, status, result_hash
      ) VALUES (?, ?, ?, 'SUCCEEDED', ?)`,
    ).run(analysisRunId, REPLAY_VERSION, new Date().toISOString(), resultHash);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return {
    analysis_run_id: analysisRunId,
    dataset_snapshot_id: run.dataset_snapshot_id,
    anchors: anchors.length,
    metric_rows: metricRows.length,
    ok_rows: metricRows.filter((row) => row.status === "OK").length,
    no_result_rows: metricRows.filter((row) => row.status === "NO_RESULT").length,
    result_hash: resultHash,
    created: true,
  };
}
