import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseSeedCatalogDocument,
  seedCatalogTargets,
  summarizeSeedCatalog,
} from "../src/catalog/seed-catalog.ts";

const catalogPath = "data/catalog/seed-catalog.json";

async function readCatalog(): Promise<unknown> {
  return JSON.parse(await readFile(catalogPath, "utf8"));
}

test("frozen seed catalog contains 20 unique players and primary instruments", async () => {
  const catalog = parseSeedCatalogDocument(await readCatalog());
  const summary = summarizeSeedCatalog(catalog);

  assert.deepEqual(summary, {
    catalog_id: "sample-market-2026-09-29",
    status: "FROZEN",
    player_count: 20,
    primary_instrument_count: 20,
    source_id: "fconline-datacenter-daily-squad",
    source_data_date: "2026-09-29",
  });
});

test("seed catalog maps deterministically to price collection targets", async () => {
  const catalog = parseSeedCatalogDocument(await readCatalog());
  const targets = seedCatalogTargets(catalog);

  assert.equal(targets.length, 20);
  assert.deepEqual(targets[0], { spid: "863239231", grade: 1 });
  assert.deepEqual(targets.at(-1), { spid: "856243715", grade: 1 });
});

test("rejects catalogs below the accepted seed-player range", async () => {
  const value = (await readCatalog()) as Record<string, unknown>;
  value.seeds = (value.seeds as unknown[]).slice(0, 19);

  assert.throws(
    () => parseSeedCatalogDocument(value),
    /document\.seeds must contain 20-30 players/,
  );
});

test("rejects duplicate primary instruments", async () => {
  const value = (await readCatalog()) as {
    seeds: Array<Record<string, unknown>>;
  };
  const first = value.seeds[0]?.primary_instrument;
  if (!first || !value.seeds[1]) {
    throw new Error("seed fixture is incomplete");
  }
  value.seeds[1].primary_instrument = first;

  assert.throws(
    () => parseSeedCatalogDocument(value),
    /duplicate primary instrument/,
  );
});
