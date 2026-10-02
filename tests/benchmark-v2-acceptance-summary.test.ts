import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeBenchmarkV2Acceptance,
  type BenchmarkV2AcceptanceCriterionResult,
} from "../src/acceptance/benchmark-v2-acceptance.ts";

function item(id: `MB2-${string}`, status: "PASS" | "FAIL"): BenchmarkV2AcceptanceCriterionResult {
  return {
    id,
    title: id,
    status,
    evidence: {},
    blockers: status === "PASS" ? [] : ["blocked"],
  };
}

test("benchmark v2 acceptance is complete only when every criterion passes", () => {
  const complete = summarizeBenchmarkV2Acceptance(
    "run",
    "dataset",
    "convergence",
    [item("MB2-001", "PASS"), item("MB2-002", "PASS")],
    "2026-10-02T06:00:00.000Z",
  );
  assert.equal(complete.status, "COMPLETE");
  assert.equal(complete.passed, 2);
  assert.equal(complete.failed, 0);

  const incomplete = summarizeBenchmarkV2Acceptance(
    "run",
    "dataset",
    "convergence",
    [item("MB2-001", "PASS"), item("MB2-002", "FAIL")],
    "2026-10-02T06:00:00.000Z",
  );
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.equal(incomplete.passed, 1);
  assert.equal(incomplete.failed, 1);
});
