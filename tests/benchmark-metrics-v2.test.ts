import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCHMARK_METRIC_V2_VERSION,
  BENCHMARK_METRIC_VERSION,
  benchmarkReturnAggregation,
  weightedMean,
  weightedMedian,
} from "../src/benchmark/metrics.ts";

test("market benchmark v2 uses population-weighted mean while v1 stays median", () => {
  assert.equal(
    benchmarkReturnAggregation(BENCHMARK_METRIC_VERSION),
    "WEIGHTED_MEDIAN_PLAYER_RETURN",
  );
  assert.equal(
    benchmarkReturnAggregation(BENCHMARK_METRIC_V2_VERSION),
    "WEIGHTED_MEAN_PLAYER_RETURN",
  );
  assert.equal(
    benchmarkReturnAggregation("custom-legacy-version"),
    "WEIGHTED_MEDIAN_PLAYER_RETURN",
  );
});

test("weighted mean preserves sparse directional signal that weighted median collapses", () => {
  const values = [
    { value: 0, weight: 49 },
    { value: 0, weight: 49 },
    { value: 0.1, weight: 2 },
  ];
  assert.equal(weightedMedian(values), 0);
  assert.ok(Math.abs(weightedMean(values) - 0.002) < 1e-12);
});

test("weighted mean honors population weights", () => {
  const values = [
    { value: -0.1, weight: 1 },
    { value: 0.2, weight: 3 },
  ];
  assert.ok(Math.abs(weightedMean(values) - 0.125) < 1e-12);
});
