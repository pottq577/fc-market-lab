import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseSeedCatalogDocument } from "../src/catalog/seed-catalog.ts";
import {
  evaluateGate0B,
  type CoverageSnapshot,
} from "../src/gates/coverage-viability.ts";

async function readCatalog() {
  return parseSeedCatalogDocument(
    JSON.parse(await readFile("data/catalog/seed-catalog.json", "utf8")),
  );
}

function completeSnapshots(
  catalog: Awaited<ReturnType<typeof readCatalog>>,
): CoverageSnapshot[] {
  return catalog.seeds.map((seed) => ({
    ...seed.primary_instrument,
    observed_at: "2026-09-30T04:33:18.051Z",
    point_count: 365,
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
  assert.equal(summary.instruments[0]?.target_history_reached, true);
});

test("Gate 0B blocks a primary instrument with less than 180 days of history", async () => {
  const catalog = await readCatalog();
  const snapshots = completeSnapshots(catalog);
  snapshots[0] = {
    ...snapshots[0]!,
    point_count: 91,
    observed_span_days: 90,
  };

  const summary = evaluateGate0B(catalog, snapshots);

  assert.equal(summary.status, "BLOCKED");
  assert.equal(summary.failed, 1);
  assert.equal(summary.instruments[0]?.status, "INSUFFICIENT_SPAN");
  assert.equal(summary.instruments[0]?.coverage_ratio, 1);
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
