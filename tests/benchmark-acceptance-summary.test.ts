import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeBenchmarkAcceptance,
  type BenchmarkAcceptanceCriterionResult,
} from "../src/acceptance/benchmark-acceptance.ts";

function row(index: number, status: "PASS" | "FAIL"): BenchmarkAcceptanceCriterionResult {
  return {
    id: `MB-${String(index).padStart(3, "0")}`,
    title: `criterion ${index}`,
    status,
    evidence: { index },
    blockers: status === "PASS" ? [] : [`criterion ${index} failed`],
  };
}

test("benchmark acceptance completes only when all 14 criteria pass", () => {
  const complete = summarizeBenchmarkAcceptance(
    "run", "dataset", "convergence",
    Array.from({ length: 14 }, (_, index) => row(index + 1, "PASS")),
    "2026-10-02T00:00:00.000Z",
  );
  assert.equal(complete.status, "COMPLETE");
  assert.equal(complete.passed, 14);
  assert.equal(complete.failed, 0);

  const incomplete = summarizeBenchmarkAcceptance(
    "run", "dataset", "convergence",
    Array.from({ length: 14 }, (_, index) => row(index + 1, index === 9 ? "FAIL" : "PASS")),
    "2026-10-02T00:00:00.000Z",
  );
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.equal(incomplete.passed, 13);
  assert.equal(incomplete.failed, 1);
});
