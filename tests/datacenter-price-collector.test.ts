import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CollectionHaltedError,
  collectDatacenterPriceTarget,
  collectDatacenterPriceTargets,
} from "../src/collect/datacenter-price.ts";

const liveShape = `
<script>
var json1 = {
  "time": ["12.30", "12.31", "1.01", "1.02",],
  "value": ["1000000", "1100000", "1050000", "1200000",],
}
</script>
`;

function fixedNow() {
  return new Date("2026-01-03T00:00:00.000Z");
}

test("collects one target with the expected public Data Center POST contract", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "fc-market-price-"));
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(liveShape, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };

  const result = await collectDatacenterPriceTarget(
    { spid: "851224371", grade: 1 },
    { outputDir, fetchImpl: fetchImpl as typeof fetch, now: fixedNow },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(String(calls[0]?.init?.body), "spid=851224371&n1strong=1");
  assert.equal(result.point_count, 4);
  assert.equal(result.native_granularity, "P1D");
  assert.equal(await readFile(result.raw_path, "utf8"), liveShape);

  const metadata = JSON.parse(await readFile(result.metadata_path, "utf8"));
  assert.equal(metadata.collector, "experimental-datacenter-price");
  assert.equal(metadata.request.spid, "851224371");
  assert.equal(metadata.request.n1strong, 1);
  assert.equal(metadata.raw_sha256, result.raw_sha256);
});

test("retries 5xx with backoff and then succeeds", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "fc-market-price-"));
  let requestCount = 0;
  const sleeps: number[] = [];
  const fetchImpl = async () => {
    requestCount += 1;
    if (requestCount < 3) {
      return new Response("temporary", { status: 503 });
    }
    return new Response(liveShape, { status: 200 });
  };

  const result = await collectDatacenterPriceTarget(
    { spid: "851224371", grade: 1 },
    {
      outputDir,
      fetchImpl: fetchImpl as typeof fetch,
      now: fixedNow,
      delayMs: 1_000,
      maxRetries: 2,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    },
  );

  assert.equal(result.point_count, 4);
  assert.equal(requestCount, 3);
  assert.deepEqual(sleeps, [1_000, 2_000]);
});

test("halts immediately on 429 without retrying", async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return new Response("rate limited", { status: 429 });
  };

  await assert.rejects(
    () =>
      collectDatacenterPriceTarget(
        { spid: "851224371", grade: 1 },
        { fetchImpl: fetchImpl as typeof fetch, now: fixedNow },
      ),
    (error: unknown) =>
      error instanceof CollectionHaltedError && error.status === 429,
  );
  assert.equal(requestCount, 1);
});

test("collects target lists sequentially with a minimum inter-request delay", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "fc-market-price-"));
  const events: string[] = [];
  const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
    events.push(`request:${String(init?.body)}`);
    return new Response(liveShape, { status: 200 });
  };

  const results = await collectDatacenterPriceTargets(
    [
      { spid: "851224371", grade: 1 },
      { spid: "851224371", grade: 2 },
    ],
    {
      outputDir,
      fetchImpl: fetchImpl as typeof fetch,
      now: (() => {
        let second = 0;
        return () => new Date(`2026-01-03T00:00:0${second++}.000Z`);
      })(),
      delayMs: 1_000,
      sleep: async (milliseconds) => {
        events.push(`sleep:${milliseconds}`);
      },
    },
  );

  assert.equal(results.length, 2);
  assert.deepEqual(events, [
    "request:spid=851224371&n1strong=1",
    "sleep:1000",
    "request:spid=851224371&n1strong=2",
  ]);
});

test("rejects collection delays below the safety floor", async () => {
  await assert.rejects(
    () =>
      collectDatacenterPriceTargets(
        [{ spid: "851224371", grade: 1 }],
        { delayMs: 999 },
      ),
    /delayMs must be an integer >= 1000/,
  );
});
