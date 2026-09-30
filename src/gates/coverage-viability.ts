import type {
  SeedCatalogDocument,
  SeedPlayer,
  SeedPrimaryInstrument,
} from "../catalog/seed-catalog.ts";
import type {
  ClassMarketAvailability,
  ClassMarketAvailabilityDocument,
} from "../evidence/class-market-availability.ts";
import { findClassMarketAvailability } from "../evidence/class-market-availability.ts";

export const GATE_0B_MIN_HISTORY_SPAN_DAYS = 180;
export const GATE_0B_TARGET_HISTORY_SPAN_DAYS = 364;
export const GATE_0B_MIN_COVERAGE_RATIO = 0.9;

export type Gate0BInstrumentStatus =
  | "PASS"
  | "MISSING_EVIDENCE"
  | "INSUFFICIENT_SPAN"
  | "INSUFFICIENT_COVERAGE"
  | "UNSUPPORTED_GRANULARITY";
export type Gate0BHistoryQualification = "MIN_HISTORY" | "FULL_LIFETIME";
export type Gate0BStatus = "READY" | "BLOCKED";

export interface CoverageSnapshot {
  spid: string;
  grade: number;
  class_code?: string;
  observed_at: string;
  raw_sha256?: string;
  point_count: number;
  first_source_date?: string;
  last_source_date?: string;
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
  history_qualification?: Gate0BHistoryQualification;
  class_code?: string;
  snapshot_observed_at?: string;
  raw_sha256?: string;
  point_count?: number;
  first_source_date?: string;
  last_source_date?: string;
  observed_span_days?: number;
  expected_observations?: number;
  coverage_ratio?: number;
  market_available_on?: string;
  lifetime_expected_observations?: number;
  lifetime_coverage_ratio?: number;
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
    young_instrument_policy: "FULL_LIFETIME";
  };
  instruments: Gate0BInstrumentResult[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

function dateSpanDays(start: string, end: string): number | null {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return null;
  }
  return (endMs - startMs) / DAY_MS;
}

function lifetimeQualification(
  snapshot: CoverageSnapshot,
  availability: ClassMarketAvailability | undefined,
  cadenceDays: number,
): {
  blockers: string[];
  expectedObservations?: number;
  coverageRatio?: number;
  marketAvailableOn?: string;
} {
  if (!availability) {
    return {
      blockers: [
        `history span ${snapshot.observed_span_days}d < ${GATE_0B_MIN_HISTORY_SPAN_DAYS}d and no official market-availability evidence is registered`,
      ],
    };
  }

  if (
    snapshot.class_code !== undefined &&
    snapshot.class_code !== availability.class_code
  ) {
    return {
      blockers: [
        `snapshot class_code=${snapshot.class_code} does not match availability class_code=${availability.class_code}`,
      ],
      marketAvailableOn: availability.market_available_on,
    };
  }

  if (!snapshot.first_source_date || !snapshot.last_source_date) {
    return {
      blockers: [
        "full-lifetime qualification requires first_source_date and last_source_date",
      ],
      marketAvailableOn: availability.market_available_on,
    };
  }

  if (snapshot.first_source_date < availability.market_available_on) {
    return {
      blockers: [
        `first source date ${snapshot.first_source_date} predates official market availability ${availability.market_available_on}`,
      ],
      marketAvailableOn: availability.market_available_on,
    };
  }

  const lifetimeSpanDays = dateSpanDays(
    availability.market_available_on,
    snapshot.last_source_date,
  );
  if (lifetimeSpanDays === null) {
    return {
      blockers: ["market availability and source dates do not form a valid range"],
      marketAvailableOn: availability.market_available_on,
    };
  }

  const expectedObservations = Math.floor(lifetimeSpanDays / cadenceDays) + 1;
  const coverageRatio = snapshot.point_count / expectedObservations;
  const blockers: string[] = [];

  if (coverageRatio < GATE_0B_MIN_COVERAGE_RATIO) {
    blockers.push(
      `full-lifetime coverage ${coverageRatio.toFixed(4)} < ${GATE_0B_MIN_COVERAGE_RATIO.toFixed(4)}`,
    );
  }

  return {
    blockers,
    expectedObservations,
    coverageRatio,
    marketAvailableOn: availability.market_available_on,
  };
}

function evaluateInstrument(
  seed: SeedPlayer,
  snapshot: CoverageSnapshot | undefined,
  availabilityDocument: ClassMarketAvailabilityDocument | undefined,
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
      class_code: snapshot.class_code,
      snapshot_observed_at: snapshot.observed_at,
      raw_sha256: snapshot.raw_sha256,
      point_count: snapshot.point_count,
      first_source_date: snapshot.first_source_date,
      last_source_date: snapshot.last_source_date,
      observed_span_days: snapshot.observed_span_days,
      source_path: snapshot.source_path,
    };
  }

  const expectedObservations =
    Math.floor(snapshot.observed_span_days / cadenceDays) + 1;
  const coverageRatio = snapshot.point_count / expectedObservations;
  const common = {
    ...base,
    class_code: snapshot.class_code,
    snapshot_observed_at: snapshot.observed_at,
    raw_sha256: snapshot.raw_sha256,
    point_count: snapshot.point_count,
    first_source_date: snapshot.first_source_date,
    last_source_date: snapshot.last_source_date,
    observed_span_days: snapshot.observed_span_days,
    expected_observations: expectedObservations,
    coverage_ratio: Number(coverageRatio.toFixed(6)),
    target_history_reached:
      snapshot.observed_span_days >= GATE_0B_TARGET_HISTORY_SPAN_DAYS,
    source_path: snapshot.source_path,
  };

  if (coverageRatio < GATE_0B_MIN_COVERAGE_RATIO) {
    return {
      ...common,
      status: "INSUFFICIENT_COVERAGE",
      blockers: [
        `coverage ${coverageRatio.toFixed(4)} < ${GATE_0B_MIN_COVERAGE_RATIO.toFixed(4)}`,
      ],
    };
  }

  if (snapshot.observed_span_days >= GATE_0B_MIN_HISTORY_SPAN_DAYS) {
    return {
      ...common,
      status: "PASS",
      blockers: [],
      history_qualification: "MIN_HISTORY",
    };
  }

  const availability = availabilityDocument
    ? findClassMarketAvailability(availabilityDocument, snapshot.spid)
    : undefined;
  const lifetime = lifetimeQualification(snapshot, availability, cadenceDays);
  if (lifetime.blockers.length > 0) {
    return {
      ...common,
      status:
        lifetime.coverageRatio !== undefined &&
        lifetime.coverageRatio < GATE_0B_MIN_COVERAGE_RATIO
          ? "INSUFFICIENT_COVERAGE"
          : "INSUFFICIENT_SPAN",
      blockers: lifetime.blockers,
      market_available_on: lifetime.marketAvailableOn,
      lifetime_expected_observations: lifetime.expectedObservations,
      lifetime_coverage_ratio:
        lifetime.coverageRatio === undefined
          ? undefined
          : Number(lifetime.coverageRatio.toFixed(6)),
    };
  }

  return {
    ...common,
    status: "PASS",
    blockers: [],
    history_qualification: "FULL_LIFETIME",
    market_available_on: lifetime.marketAvailableOn,
    lifetime_expected_observations: lifetime.expectedObservations,
    lifetime_coverage_ratio:
      lifetime.coverageRatio === undefined
        ? undefined
        : Number(lifetime.coverageRatio.toFixed(6)),
  };
}

export function evaluateGate0B(
  catalog: SeedCatalogDocument,
  snapshots: CoverageSnapshot[],
  availabilityDocument?: ClassMarketAvailabilityDocument,
): Gate0BSummary {
  const latest = latestSnapshots(snapshots);
  const instruments = catalog.seeds.map((seed) =>
    evaluateInstrument(
      seed,
      latest.get(instrumentKey(seed.primary_instrument)),
      availabilityDocument,
    ),
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
      young_instrument_policy: "FULL_LIFETIME",
    },
    instruments,
  };
}
