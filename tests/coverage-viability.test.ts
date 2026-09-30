import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseSeedCatalogDocument } from "../src/catalog/seed-catalog.ts";
import { parseClassMarketAvailabilityDocument } from "../src/evidence/class-market-availability.ts";
import {
  evaluateGate0B,
  type CoverageSnapshot,
} from "../src/gates/coverage-viability.ts";

async function readCatalog() {
  return parseSeedCatalogDocument(
    JSON.parse(await readFile("data/catalog/seed-catalog.json", "utf8")),
  );
}

async function readAvailability() {
  return parseClassMarketAvailabilityDocument(
    JSON.parse(
      await readFile("data/evidence/class-market-availability.json", "utf8"),
    ),
  );
}

function completeSnapshots(
  catalog: Awaited<ReturnType<typeof readCatalog>>,
): CoverageSnapshot[] {
  return catalog.seeds.map((seed) => ({
    ...seed.primary_instrument,
    observed_at: "2026-09-30T04:33:18.051Z",
    point_count: 365,
    first_source_date: "2025-09-30",
    last_source_date: "2026-09-29",
    observed_span_days: 364,
    native_granularity: "P1D",
  }));
}

test("Gate 0B passes when every primary instrument meets span and coverage thresholds", async () => {
  const catalog = await readCatalog();
  const summary = evaluateGate0B(catalog, completeSnapshots(catalog));

  assert.equal(summary.status, "READY");
  assert.equal(summary.passed, 20);
  assert.equal(summary.failed, 0);
  assert.equal(summary.instruments[0]?.coverage_ratio, 1);
  assert.equal(summary.instruments[0]?.history_qualification, "MIN_HISTORY");
  assert.equal(summary.instruments[0]?.target_history_reached, true);
});

test("Gate 0B blocks a young primary instrument without market-availability evidence", async () => {
  const catalog = await readCatalog();
  const snapshots = completeSnapshots(catalog);
  snapshots[0] = {
    ...snapshots[0]!,
    point_count: 125,
    first_source_date: "2026-05-28",
    last_source_date: "2026-09-29",
    observed_span_days: 124,
  };

  const summary = evaluateGate0B(catalog, snapshots);

  assert.equal(summary.status, "BLOCKED");
  assert.equal(summary.failed, 1);
  assert.equal(summary.instruments[0]?.status, "INSUFFICIENT_SPAN");
  assert.equal(summary.instruments[0]?.coverage_ratio, 1);
});

test("Gate 0B accepts a young primary instrument with complete lifetime coverage", async () => {
  const catalog = await readCatalog();
  const availability = await readAvailability();
  const snapshots = completeSnapshots(catalog);
  snapshots[0] = {
    ...snapshots[0]!,
    class_code: "PTG",
    point_count: 125,
    first_source_date: "2026-05-28",
    last_source_date: "2026-09-29",
    observed_span_days: 124,
  };

  const summary = evaluateGate0B(catalog, snapshots, availability);

  assert.equal(summary.status, "READY");
  assert.equal(summary.instruments[0]?.status, "PASS");
  assert.equal(summary.instruments[0]?.history_qualification, "FULL_LIFETIME");
  assert.equal(summary.instruments[0]?.market_available_on, "2026-05-28");
  assert.equal(summary.instruments[0]?.lifetime_coverage_ratio, 1);
});

test("Gate 0B blocks incomplete full-lifetime coverage for a young instrument", async () => {
  const catalog = await readCatalog();
  const availability = await readAvailability();
  const snapshots = completeSnapshots(catalog);
  snapshots[0] = {
    ...snapshots[0]!,
    class_code: "PTG",
    point_count: 110,
    first_source_date: "2026-06-12",
    last_source_date: "2026-09-29",
    observed_span_days: 109,
  };

  const summary = evaluateGate0B(catalog, snapshots, availability);

  assert.equal(summary.status, "BLOCKED");
  assert.equal(summary.instruments[0]?.status, "INSUFFICIENT_COVERAGE");
  assert.equal(summary.instruments[0]?.coverage_ratio, 1);
  assert.equal(summary.instruments[0]?.lifetime_coverage_ratio, 0.88);
});

test("Gate 0B blocks incomplete native coverage", async () => {
  const catalog = await readCatalog();
  const snapshots = completeSnapshots(catalog);
  snapshots[0] = { ...snapshots[0]!, point_count: 300 };

  const summary = evaluateGate0B(catalog, snapshots);

  assert.equal(summary.status, "BLOCKED");
  assert.equal(summary.instruments[0]?.status, "INSUFFICIENT_COVERAGE");
  assert.equal(summary.instruments[0]?.coverage_ratio, 0.821918);
});

test("Gate 0B reports missing collection evidence without inventing zero values", async () => {
  const catalog = await readCatalog();
  const snapshots = completeSnapshots(catalog).slice(1);

  const summary = evaluateGate0B(catalog, snapshots);

  assert.equal(summary.status, "BLOCKED");
  assert.equal(summary.instruments[0]?.status, "MISSING_EVIDENCE");
  assert.equal(summary.instruments[0]?.coverage_ratio, undefined);
});
