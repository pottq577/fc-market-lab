import type {
  SeedCatalogDocument,
  SeedPlayer,
  SeedPrimaryInstrument,
} from "../catalog/seed-catalog.ts";

export const GATE_0B_MIN_HISTORY_SPAN_DAYS = 180;
export const GATE_0B_TARGET_HISTORY_SPAN_DAYS = 364;
export const GATE_0B_MIN_COVERAGE_RATIO = 0.9;

export type Gate0BInstrumentStatus =
  | "PASS"
  | "MISSING_EVIDENCE"
  | "INSUFFICIENT_SPAN"
  | "INSUFFICIENT_COVERAGE"
  | "UNSUPPORTED_GRANULARITY";
export type Gate0BStatus = "READY" | "BLOCKED";

export interface CoverageSnapshot {
  spid: string;
  grade: number;
  observed_at: string;
  point_count: number;
  observed_span_days: number;
  native_granularity: string;
  source_path?: string;
}

export interface Gate0BInstrumentResult {
  player_key: string;
  player_name: string;
  primary_instrument: SeedPrimaryInstrument;
  status: Gate0BInstrumentStatus;
  blockers: string[];
  snapshot_observed_at?: string;
  point_count?: number;
  observed_span_days?: number;
  expected_observations?: number;
  coverage_ratio?: number;
  target_history_reached?: boolean;
  source_path?: string;
}

export interface Gate0BSummary {
  status: Gate0BStatus;
  catalog_id: string;
  total: number;
  passed: number;
  failed: number;
  thresholds: {
    min_history_span_days: number;
    target_history_span_days: number;
    min_coverage_ratio: number;
  };
  instruments: Gate0BInstrumentResult[];
}

function instrumentKey(instrument: SeedPrimaryInstrument): string {
  return `${instrument.spid}:${instrument.grade}`;
}

function parseNativeDays(granularity: string): number | null {
  const match = /^P(\d+)D$/.exec(granularity);
  if (!match) {
    return null;
  }
  const days = Number(match[1]);
  return Number.isInteger(days) && days > 0 ? days : null;
}

function latestSnapshots(
  snapshots: CoverageSnapshot[],
): Map<string, CoverageSnapshot> {
  const latest = new Map<string, CoverageSnapshot>();
  for (const snapshot of snapshots) {
    const key = instrumentKey(snapshot);
    const current = latest.get(key);
    if (
      !current ||
      Date.parse(snapshot.observed_at) > Date.parse(current.observed_at)
    ) {
      latest.set(key, snapshot);
    }
  }
  return latest;
}

function evaluateInstrument(
  seed: SeedPlayer,
  snapshot: CoverageSnapshot | undefined,
): Gate0BInstrumentResult {
  const base = {
    player_key: seed.player_key,
    player_name: seed.player_name,
    primary_instrument: seed.primary_instrument,
  };

  if (!snapshot) {
    return {
      ...base,
      status: "MISSING_EVIDENCE",
      blockers: ["no parsed price-history snapshot found for primary instrument"],
    };
  }

  const cadenceDays = parseNativeDays(snapshot.native_granularity);
  if (cadenceDays === null) {
    return {
      ...base,
      status: "UNSUPPORTED_GRANULARITY",
      blockers: [
        `native_granularity=${snapshot.native_granularity} is not a day-based cadence`,
      ],
      snapshot_observed_at: snapshot.observed_at,
      point_count: snapshot.point_count,
      observed_span_days: snapshot.observed_span_days,
      source_path: snapshot.source_path,
    };
  }

  const expectedObservations =
    Math.floor(snapshot.observed_span_days / cadenceDays) + 1;
  const coverageRatio = snapshot.point_count / expectedObservations;
  const blockers: string[] = [];

  if (snapshot.observed_span_days < GATE_0B_MIN_HISTORY_SPAN_DAYS) {
    blockers.push(
      `history span ${snapshot.observed_span_days}d < ${GATE_0B_MIN_HISTORY_SPAN_DAYS}d`,
    );
  }
  if (coverageRatio < GATE_0B_MIN_COVERAGE_RATIO) {
    blockers.push(
      `coverage ${coverageRatio.toFixed(4)} < ${GATE_0B_MIN_COVERAGE_RATIO.toFixed(4)}`,
    );
  }

  let status: Gate0BInstrumentStatus = "PASS";
  if (blockers.length > 0) {
    status = snapshot.observed_span_days < GATE_0B_MIN_HISTORY_SPAN_DAYS
      ? "INSUFFICIENT_SPAN"
      : "INSUFFICIENT_COVERAGE";
  }

  return {
    ...base,
    status,
    blockers,
    snapshot_observed_at: snapshot.observed_at,
    point_count: snapshot.point_count,
    observed_span_days: snapshot.observed_span_days,
    expected_observations: expectedObservations,
    coverage_ratio: Number(coverageRatio.toFixed(6)),
    target_history_reached:
      snapshot.observed_span_days >= GATE_0B_TARGET_HISTORY_SPAN_DAYS,
    source_path: snapshot.source_path,
  };
}

export function evaluateGate0B(
  catalog: SeedCatalogDocument,
  snapshots: CoverageSnapshot[],
): Gate0BSummary {
  const latest = latestSnapshots(snapshots);
  const instruments = catalog.seeds.map((seed) =>
    evaluateInstrument(seed, latest.get(instrumentKey(seed.primary_instrument))),
  );
  const passed = instruments.filter((item) => item.status === "PASS").length;

  return {
    status: passed === instruments.length ? "READY" : "BLOCKED",
    catalog_id: catalog.catalog_id,
    total: instruments.length,
    passed,
    failed: instruments.length - passed,
    thresholds: {
      min_history_span_days: GATE_0B_MIN_HISTORY_SPAN_DAYS,
      target_history_span_days: GATE_0B_TARGET_HISTORY_SPAN_DAYS,
      min_coverage_ratio: GATE_0B_MIN_COVERAGE_RATIO,
    },
    instruments,
  };
}
