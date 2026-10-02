import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const BENCHMARK_PANEL_VERSION = "market-benchmark-panel-v2";
export const DEFAULT_BENCHMARK_PANEL_SEED = "market-benchmark-v1";
export const DEFAULT_BENCHMARK_PANEL_SIZES = [100, 200, 400, 800] as const;

const PRICE_SOURCE_ID = "fconline-datacenter-price-history";
const OPERATOR_BATCH_CAPTURE_METHOD = "OFFICIAL_WEB_UI_OPERATOR_BATCH";

export type UsageBand =
  | "HIGH_OBSERVED"
  | "MID_OBSERVED"
  | "LOW_OBSERVED"
  | "UNOBSERVED";
export type PriceBand = "P00_50" | "P50_80" | "P80_95" | "P95_100";

export interface DiscoveryStatusForPanel {
  discovery_frame_id: string;
  universe_snapshot_id: string;
  target_size: number;
  attempted_count: number;
  observed_count: number;
  pending_count: number;
  response_coverage: number;
  readiness: "IN_PROGRESS" | "READY_FOR_PANEL" | "INSUFFICIENT_DISCOVERY_COVERAGE";
}

interface FrameRow {
  universe_snapshot_id: string;
  target_size: number | bigint;
  population_count: number | bigint;
  inclusion_probability: number;
  population_weight: number;
}

interface UniverseRow {
  universe_snapshot_id: string;
  as_of: string;
  source_hash: string;
  catalog_player_count: number | bigint;
}

interface CandidateRow {
  sample_rank: number | bigint;
  player_id: string;
  player_name: string;
  spid: string;
  grade: number | bigint;
  instrument_id: string;
  latest_price: number | bigint;
  latest_source_timestamp: string;
  valid_history_count: number | bigint;
}

interface Candidate {
  sample_rank: number;
  player_id: string;
  player_name: string;
  spid: string;
  grade: number;
  instrument_id: string;
  price: number;
  source_timestamp: string;
  history_count: number;
  usage_value: number | null;
  usage_band: UsageBand;
  price_band: PriceBand;
  stratum_id: string;
  selection_hash: string;
  stratum_rank: number;
  admission_rank: number;
}

export interface BenchmarkPanelSummary {
  panel_id: string;
  panel_label: string;
  panel_size: number;
  stratum_count: number;
  represented_population_weight: number;
}

export interface BuildBenchmarkPanelResult {
  panel_family_id: string;
  discovery_frame_id: string;
  universe_snapshot_id: string;
  panel_version: string;
  stratification_basis: "PRICE_ONLY";
  sample_seed: string;
  effective_from: string;
  discovery_target_count: number;
  discovery_observed_count: number;
  discovery_response_coverage: number;
  eligible_responder_count: number;
  usage_observed_count: number;
  usage_observation_coverage: number;
  usage_boundaries: { p33: number | null; p67: number | null };
  price_boundaries: { p50: number; p80: number; p95: number };
  price_band_counts: Record<PriceBand, number>;
  stage1_inclusion_probability: number;
  stage1_population_weight: number;
  nonempty_stratum_count: number;
  panels: BenchmarkPanelSummary[];
  created: boolean;
}

function hash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${hash(...parts)}`;
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

function safePositiveInteger(value: number | bigint, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return parsed;
}

function normalizePanelSizes(values: readonly number[]): number[] {
  if (values.length === 0) throw new TypeError("panelSizes must not be empty");
  const unique = [...new Set(values)];
  if (
    unique.length !== values.length ||
    unique.some((value) => !Number.isInteger(value) || value <= 0)
  ) {
    throw new TypeError("panelSizes must contain unique positive integers");
  }
  return unique.sort((left, right) => left - right);
}

function nearestRank(values: number[], probability: number): number {
  if (values.length === 0) {
    throw new TypeError("quantile values must not be empty");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(probability * sorted.length) - 1);
  return sorted[index]!;
}

function priceBand(price: number, boundaries: { p50: number; p80: number; p95: number }): PriceBand {
  if (price <= boundaries.p50) return "P00_50";
  if (price <= boundaries.p80) return "P50_80";
  if (price <= boundaries.p95) return "P80_95";
  return "P95_100";
}

function usageBand(
  usage: number | null,
  boundaries: { p33: number | null; p67: number | null },
): UsageBand {
  if (usage === null) return "UNOBSERVED";
  if (boundaries.p33 === null || boundaries.p67 === null) {
    return "MID_OBSERVED";
  }
  if (usage <= boundaries.p33) return "LOW_OBSERVED";
  if (usage <= boundaries.p67) return "MID_OBSERVED";
  return "HIGH_OBSERVED";
}

function frameRow(db: DatabaseSync, discoveryFrameId: string): FrameRow {
  const row = db
    .prepare(
      `SELECT universe_snapshot_id, target_size, population_count,
              inclusion_probability, population_weight
       FROM benchmark_discovery_frame
       WHERE discovery_frame_id = ?`,
    )
    .get(discoveryFrameId) as FrameRow | undefined;
  if (!row) throw new TypeError(`unknown discovery frame: ${discoveryFrameId}`);
  return row;
}

function universeRow(db: DatabaseSync, universeSnapshotId: string): UniverseRow {
  const row = db
    .prepare(
      `SELECT universe_snapshot_id, as_of, source_hash, catalog_player_count
       FROM market_universe_snapshot
       WHERE universe_snapshot_id = ?`,
    )
    .get(universeSnapshotId) as UniverseRow | undefined;
  if (!row) throw new TypeError(`unknown universe snapshot: ${universeSnapshotId}`);
  return row;
}

export function resolveBenchmarkPanelUniverseId(
  db: DatabaseSync,
  discoveryFrameId: string,
  requestedUniverseId?: string,
): string {
  const frame = frameRow(db, discoveryFrameId);
  const origin = universeRow(db, frame.universe_snapshot_id);

  if (requestedUniverseId !== undefined) {
    const requested = universeRow(db, requestedUniverseId.trim());
    if (requested.universe_snapshot_id === origin.universe_snapshot_id) {
      throw new TypeError("panel universe must be a refreshed snapshot after discovery");
    }
    if (requested.source_hash !== origin.source_hash) {
      throw new TypeError("panel universe catalog source_hash differs from discovery universe");
    }
    if (Number(requested.catalog_player_count) !== Number(origin.catalog_player_count)) {
      throw new TypeError("panel universe catalog player count differs from discovery universe");
    }
    if (requested.as_of <= origin.as_of) {
      throw new TypeError("panel universe as_of must be after discovery universe as_of");
    }
    return requested.universe_snapshot_id;
  }

  const latest = db
    .prepare(
      `SELECT universe_snapshot_id
       FROM market_universe_snapshot
       WHERE source_hash = ?
         AND catalog_player_count = ?
         AND as_of > ?
       ORDER BY as_of DESC, created_at DESC, universe_snapshot_id DESC
       LIMIT 1`,
    )
    .get(origin.source_hash, origin.catalog_player_count, origin.as_of) as
    | { universe_snapshot_id: string }
    | undefined;
  if (!latest) {
    throw new TypeError(
      "no refreshed compatible universe exists; run benchmark:universe with an as-of after discovery",
    );
  }
  return latest.universe_snapshot_id;
}

function loadCandidates(
  db: DatabaseSync,
  discoveryFrameId: string,
  universeSnapshotId: string,
): CandidateRow[] {
  return db
    .prepare(
      `SELECT bdm.sample_rank, bdm.player_id, bdm.player_name,
              bdm.probe_spid AS spid, bdm.probe_grade AS grade,
              mui.instrument_id, mui.latest_price,
              mui.latest_source_timestamp, mui.valid_history_count
       FROM benchmark_discovery_member bdm
       JOIN market_universe_instrument mui
         ON mui.universe_snapshot_id = ?
        AND mui.spid = bdm.probe_spid
        AND mui.grade = bdm.probe_grade
        AND mui.price_eligible = 1
       WHERE bdm.discovery_frame_id = ?
         AND (
           EXISTS (
             SELECT 1
             FROM benchmark_discovery_outcome bdo
             WHERE bdo.discovery_frame_id = bdm.discovery_frame_id
               AND bdo.sample_rank = bdm.sample_rank
               AND bdo.outcome = 'OBSERVED'
           )
           OR EXISTS (
             SELECT 1
             FROM instrument i
             JOIN source_snapshot ss
               ON ss.source_ref = i.instrument_id
             JOIN price_point pp
               ON pp.source_snapshot_id = ss.source_snapshot_id
              AND pp.instrument_id = i.instrument_id
             WHERE i.spid = bdm.probe_spid
               AND i.grade = bdm.probe_grade
               AND ss.source_id = ?
               AND ss.capture_method = ?
               AND ss.parse_status = 'PARSED'
           )
         )
       ORDER BY bdm.sample_rank`,
    )
    .all(
      universeSnapshotId,
      discoveryFrameId,
      PRICE_SOURCE_ID,
      OPERATOR_BATCH_CAPTURE_METHOD,
    ) as CandidateRow[];
}

function loadPlayerUsage(
  db: DatabaseSync,
  universeSnapshotId: string,
  asOf: string,
): Map<string, number> {
  const rows = db
    .prepare(
      `WITH player_usage AS (
         SELECT muc.player_id, up.usage_share, up.as_of
         FROM usage_point up
         JOIN market_universe_card muc
           ON muc.universe_snapshot_id = ?
          AND muc.spid = up.spid
         WHERE up.subject_type = 'PLAYER_CARD'
           AND up.usage_share IS NOT NULL
           AND up.as_of <= ?
         UNION ALL
         SELECT mui.player_id, up.usage_share, up.as_of
         FROM usage_point up
         JOIN market_universe_instrument mui
           ON mui.universe_snapshot_id = ?
          AND mui.instrument_id = up.instrument_id
         WHERE up.subject_type = 'INSTRUMENT'
           AND up.usage_share IS NOT NULL
           AND up.as_of <= ?
       ), latest_player_usage AS (
         SELECT player_id, MAX(as_of) AS latest_as_of
         FROM player_usage
         GROUP BY player_id
       )
       SELECT pu.player_id, MAX(pu.usage_share) AS usage_value
       FROM player_usage pu
       JOIN latest_player_usage latest
         ON latest.player_id = pu.player_id
        AND latest.latest_as_of = pu.as_of
       GROUP BY pu.player_id
       ORDER BY pu.player_id`,
    )
    .all(
      universeSnapshotId,
      asOf,
      universeSnapshotId,
      asOf,
    ) as Array<{
    player_id: string;
    usage_value: number;
  }>;
  return new Map(rows.map((row) => [row.player_id, Number(row.usage_value)]));
}

function prepareCandidates(
  rows: CandidateRow[],
  usageByPlayer: Map<string, number>,
  familySeed: string,
): {
  candidates: Candidate[];
  priceBoundaries: { p50: number; p80: number; p95: number };
  usageBoundaries: { p33: number | null; p67: number | null };
  usageObservedCount: number;
  priceBandCounts: Record<PriceBand, number>;
} {
  const raw = rows.map((row) => ({
    sample_rank: safePositiveInteger(row.sample_rank, "sample_rank"),
    player_id: row.player_id,
    player_name: row.player_name,
    spid: row.spid,
    grade: safePositiveInteger(row.grade, "grade"),
    instrument_id: row.instrument_id,
    price: safePositiveInteger(row.latest_price, "latest_price"),
    source_timestamp: row.latest_source_timestamp,
    history_count: safePositiveInteger(row.valid_history_count, "valid_history_count"),
    usage_value: usageByPlayer.get(row.player_id) ?? null,
  }));
  const prices = raw.map((row) => row.price);
  const priceBoundaries = {
    p50: nearestRank(prices, 0.5),
    p80: nearestRank(prices, 0.8),
    p95: nearestRank(prices, 0.95),
  };
  const usageValues = raw
    .map((row) => row.usage_value)
    .filter((value): value is number => value !== null);
  const usageBoundaries = usageValues.length === 0
    ? { p33: null, p67: null }
    : {
        p33: nearestRank(usageValues, 1 / 3),
        p67: nearestRank(usageValues, 2 / 3),
      };

  const priceBandCounts: Record<PriceBand, number> = {
    P00_50: 0,
    P50_80: 0,
    P80_95: 0,
    P95_100: 0,
  };
  const candidates: Candidate[] = raw.map((row) => {
    const uBand = usageBand(row.usage_value, usageBoundaries);
    const pBand = priceBand(row.price, priceBoundaries);
    priceBandCounts[pBand] += 1;
    const stratumId = pBand;
    return {
      ...row,
      usage_band: uBand,
      price_band: pBand,
      stratum_id: stratumId,
      selection_hash: hash("panel-member", familySeed, stratumId, row.player_id),
      stratum_rank: 0,
      admission_rank: 0,
    };
  });

  return {
    candidates,
    priceBoundaries,
    usageBoundaries,
    usageObservedCount: usageValues.length,
    priceBandCounts,
  };
}

function admissionSequence(
  candidates: Candidate[],
  minSize: number,
  maxSize: number,
): Candidate[] {
  const byStratum = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const values = byStratum.get(candidate.stratum_id) ?? [];
    values.push(candidate);
    byStratum.set(candidate.stratum_id, values);
  }
  for (const values of byStratum.values()) {
    values.sort(
      (left, right) =>
        left.selection_hash.localeCompare(right.selection_hash) ||
        left.player_id.localeCompare(right.player_id),
    );
    values.forEach((candidate, index) => {
      candidate.stratum_rank = index + 1;
    });
  }

  const stratumIds = [...byStratum.keys()].sort();
  if (stratumIds.length > minSize) {
    throw new TypeError(
      `smallest panel ${minSize} cannot cover ${stratumIds.length} non-empty strata`,
    );
  }

  const selected = new Map<string, number>();
  const sequence: Candidate[] = [];
  for (const stratumId of stratumIds) {
    const first = byStratum.get(stratumId)![0]!;
    sequence.push(first);
    selected.set(stratumId, 1);
  }

  while (sequence.length < maxSize) {
    const available = stratumIds.filter(
      (stratumId) =>
        (selected.get(stratumId) ?? 0) < byStratum.get(stratumId)!.length,
    );
    if (available.length === 0) break;
    available.sort((leftId, rightId) => {
      const leftCount = selected.get(leftId) ?? 0;
      const rightCount = selected.get(rightId) ?? 0;
      const leftPopulation = byStratum.get(leftId)!.length;
      const rightPopulation = byStratum.get(rightId)!.length;
      const leftScore = leftCount / Math.sqrt(leftPopulation);
      const rightScore = rightCount / Math.sqrt(rightPopulation);
      return leftScore - rightScore || leftId.localeCompare(rightId);
    });
    const chosenId = available[0]!;
    const chosenIndex = selected.get(chosenId) ?? 0;
    const candidate = byStratum.get(chosenId)![chosenIndex]!;
    sequence.push(candidate);
    selected.set(chosenId, chosenIndex + 1);
  }

  sequence.forEach((candidate, index) => {
    candidate.admission_rank = index + 1;
  });
  return sequence;
}

function roundProbability(value: number): number {
  return Number(value.toFixed(12));
}

export function buildBenchmarkPanels(
  db: DatabaseSync,
  input: {
    discoveryStatus: DiscoveryStatusForPanel;
    universeSnapshotId: string;
    panelVersion?: string;
    sampleSeed?: string;
    panelSizes?: readonly number[];
    effectiveFrom?: string;
    createdAt?: string;
  },
): BuildBenchmarkPanelResult {
  if (input.discoveryStatus.readiness !== "READY_FOR_PANEL") {
    throw new TypeError(
      `discovery readiness must be READY_FOR_PANEL, got ${input.discoveryStatus.readiness}`,
    );
  }
  if (input.discoveryStatus.pending_count !== 0) {
    throw new TypeError("discovery must have no pending targets before panel creation");
  }

  const discoveryFrameId = input.discoveryStatus.discovery_frame_id;
  const frame = frameRow(db, discoveryFrameId);
  if (frame.universe_snapshot_id !== input.discoveryStatus.universe_snapshot_id) {
    throw new TypeError("discovery status does not match persisted discovery frame");
  }
  const panelSizes = normalizePanelSizes(
    input.panelSizes ?? DEFAULT_BENCHMARK_PANEL_SIZES,
  );
  const maxPanelSize = panelSizes.at(-1)!;
  const panelVersion = input.panelVersion ?? BENCHMARK_PANEL_VERSION;
  const sampleSeed = input.sampleSeed ?? DEFAULT_BENCHMARK_PANEL_SEED;
  if (panelVersion.trim() === "" || sampleSeed.trim() === "") {
    throw new TypeError("panelVersion and sampleSeed must not be empty");
  }

  const originUniverse = universeRow(db, frame.universe_snapshot_id);
  const panelUniverse = universeRow(db, input.universeSnapshotId);
  if (panelUniverse.universe_snapshot_id === originUniverse.universe_snapshot_id) {
    throw new TypeError("panel universe must be refreshed after discovery");
  }
  if (panelUniverse.source_hash !== originUniverse.source_hash) {
    throw new TypeError("panel universe catalog source_hash differs from discovery universe");
  }
  if (
    Number(panelUniverse.catalog_player_count) !==
    Number(originUniverse.catalog_player_count)
  ) {
    throw new TypeError("panel universe catalog population differs from discovery universe");
  }
  if (panelUniverse.as_of <= originUniverse.as_of) {
    throw new TypeError("panel universe as_of must be after discovery universe as_of");
  }

  const effectiveFrom = normalizeTimestamp(
    input.effectiveFrom ?? panelUniverse.as_of,
    "effectiveFrom",
  );
  const createdAt = normalizeTimestamp(
    input.createdAt ?? new Date().toISOString(),
    "createdAt",
  );
  if (effectiveFrom < panelUniverse.as_of) {
    throw new TypeError("effectiveFrom must not be before panel universe as_of");
  }

  const candidateRows = loadCandidates(db, discoveryFrameId, panelUniverse.universe_snapshot_id);
  if (candidateRows.length !== input.discoveryStatus.observed_count) {
    throw new TypeError(
      `refreshed universe resolved ${candidateRows.length} eligible discovery responders, expected ${input.discoveryStatus.observed_count}; rebuild universe with an as-of after discovery and current price evidence`,
    );
  }
  if (candidateRows.length < maxPanelSize) {
    throw new TypeError(
      `eligible discovery responders ${candidateRows.length} are fewer than largest panel ${maxPanelSize}`,
    );
  }

  const usageByPlayer = loadPlayerUsage(
    db,
    panelUniverse.universe_snapshot_id,
    panelUniverse.as_of,
  );
  const selectionSeed = JSON.stringify({
    discovery_frame_id: discoveryFrameId,
    universe_snapshot_id: panelUniverse.universe_snapshot_id,
    panel_version: panelVersion,
    sample_seed: sampleSeed,
  });
  const familyIdentity = JSON.stringify({
    selection_seed: selectionSeed,
    effective_from: effectiveFrom,
    panel_sizes: panelSizes,
  });
  const prepared = prepareCandidates(candidateRows, usageByPlayer, selectionSeed);
  const sequence = admissionSequence(
    prepared.candidates,
    panelSizes[0]!,
    maxPanelSize,
  );
  const nonemptyStrata = new Set(prepared.candidates.map((item) => item.stratum_id));
  const stage1Probability = Number(frame.inclusion_probability);
  const stage1Weight = Number(frame.population_weight);
  const panelFamilyId = deterministicId("panel_family", familyIdentity);

  db.exec("BEGIN IMMEDIATE");
  try {
    const familyInsert = db
      .prepare(
        `INSERT OR IGNORE INTO benchmark_panel_family(
          panel_family_id, discovery_frame_id, universe_snapshot_id,
          panel_version, stratification_basis, sample_seed, effective_from,
          discovery_target_count, discovery_observed_count,
          discovery_response_coverage, eligible_responder_count,
          usage_observed_count, usage_observation_coverage,
          usage_p33, usage_p67,
          price_p50, price_p80, price_p95, price_band_counts_json,
          stage1_inclusion_probability, stage1_population_weight,
          panel_sizes_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        panelFamilyId,
        discoveryFrameId,
        panelUniverse.universe_snapshot_id,
        panelVersion,
        "PRICE_ONLY",
        sampleSeed,
        effectiveFrom,
        Number(frame.target_size),
        input.discoveryStatus.observed_count,
        input.discoveryStatus.response_coverage,
        prepared.candidates.length,
        prepared.usageObservedCount,
        Number((prepared.usageObservedCount / prepared.candidates.length).toFixed(6)),
        prepared.usageBoundaries.p33,
        prepared.usageBoundaries.p67,
        prepared.priceBoundaries.p50,
        prepared.priceBoundaries.p80,
        prepared.priceBoundaries.p95,
        JSON.stringify(prepared.priceBandCounts),
        stage1Probability,
        stage1Weight,
        JSON.stringify(panelSizes),
        createdAt,
      );

    const insertPanel = db.prepare(
      `INSERT OR IGNORE INTO benchmark_panel(
        panel_id, panel_family_id, panel_label, panel_size,
        effective_from, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertStratum = db.prepare(
      `INSERT OR IGNORE INTO benchmark_panel_stratum(
        panel_id, stratum_id, usage_band, price_band,
        discovery_responder_count, sampled_count,
        stage2_inclusion_probability, combined_inclusion_probability,
        population_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertMember = db.prepare(
      `INSERT OR IGNORE INTO benchmark_panel_member(
        panel_id, player_id, player_name, discovery_sample_rank,
        stratum_id, usage_band, price_band,
        anchor_instrument_id, anchor_spid, anchor_grade, anchor_price,
        anchor_source_timestamp, anchor_history_count, usage_value,
        stratum_rank, admission_rank, selection_hash,
        stage1_inclusion_probability, stage2_inclusion_probability,
        combined_inclusion_probability, population_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const responderCountByStratum = new Map<string, number>();
    for (const candidate of prepared.candidates) {
      responderCountByStratum.set(
        candidate.stratum_id,
        (responderCountByStratum.get(candidate.stratum_id) ?? 0) + 1,
      );
    }

    const panels: BenchmarkPanelSummary[] = [];
    for (const panelSize of panelSizes) {
      const panelLabel = `P${panelSize}`;
      const panelId = deterministicId("panel", panelFamilyId, String(panelSize));
      const selected = sequence.slice(0, panelSize);
      if (selected.length !== panelSize) {
        throw new Error(`panel ${panelLabel} resolved to ${selected.length} members`);
      }
      insertPanel.run(
        panelId,
        panelFamilyId,
        panelLabel,
        panelSize,
        effectiveFrom,
        createdAt,
      );

      const sampledByStratum = new Map<string, number>();
      for (const candidate of selected) {
        sampledByStratum.set(
          candidate.stratum_id,
          (sampledByStratum.get(candidate.stratum_id) ?? 0) + 1,
        );
      }

      const weights = new Map<string, {
        stage2: number;
        combined: number;
        weight: number;
      }>();
      for (const [stratumId, sampledCount] of sampledByStratum) {
        const responderCount = responderCountByStratum.get(stratumId)!;
        const stage2 = sampledCount / responderCount;
        const combined = stage1Probability * stage2;
        const weight = 1 / combined;
        weights.set(stratumId, { stage2, combined, weight });
        insertStratum.run(
          panelId,
          stratumId,
          null,
          stratumId as PriceBand,
          responderCount,
          sampledCount,
          roundProbability(stage2),
          roundProbability(combined),
          weight,
        );
      }

      let representedPopulationWeight = 0;
      for (const candidate of selected) {
        const weight = weights.get(candidate.stratum_id)!;
        insertMember.run(
          panelId,
          candidate.player_id,
          candidate.player_name,
          candidate.sample_rank,
          candidate.stratum_id,
          candidate.usage_band,
          candidate.price_band,
          candidate.instrument_id,
          candidate.spid,
          candidate.grade,
          candidate.price,
          candidate.source_timestamp,
          candidate.history_count,
          candidate.usage_value,
          candidate.stratum_rank,
          candidate.admission_rank,
          candidate.selection_hash,
          roundProbability(stage1Probability),
          roundProbability(weight.stage2),
          roundProbability(weight.combined),
          weight.weight,
        );
        representedPopulationWeight += weight.weight;
      }

      const persisted = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM benchmark_panel_member
           WHERE panel_id = ?`,
        )
        .get(panelId) as { count: number | bigint };
      if (Number(persisted.count) !== panelSize) {
        throw new Error(
          `persisted panel ${panelLabel} has ${String(persisted.count)} members, expected ${panelSize}`,
        );
      }
      panels.push({
        panel_id: panelId,
        panel_label: panelLabel,
        panel_size: panelSize,
        stratum_count: sampledByStratum.size,
        represented_population_weight: Number(representedPopulationWeight.toFixed(6)),
      });
    }

    db.exec("COMMIT");
    return {
      panel_family_id: panelFamilyId,
      discovery_frame_id: discoveryFrameId,
      universe_snapshot_id: panelUniverse.universe_snapshot_id,
      panel_version: panelVersion,
      stratification_basis: "PRICE_ONLY",
      sample_seed: sampleSeed,
      effective_from: effectiveFrom,
      discovery_target_count: Number(frame.target_size),
      discovery_observed_count: input.discoveryStatus.observed_count,
      discovery_response_coverage: input.discoveryStatus.response_coverage,
      eligible_responder_count: prepared.candidates.length,
      usage_observed_count: prepared.usageObservedCount,
      usage_observation_coverage: Number((prepared.usageObservedCount / prepared.candidates.length).toFixed(6)),
      usage_boundaries: prepared.usageBoundaries,
      price_boundaries: prepared.priceBoundaries,
      price_band_counts: prepared.priceBandCounts,
      stage1_inclusion_probability: stage1Probability,
      stage1_population_weight: stage1Weight,
      nonempty_stratum_count: nonemptyStrata.size,
      panels,
      created: Number(familyInsert.changes) === 1,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
