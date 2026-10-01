import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeAcceptance,
  type AcceptanceCriterionResult,
} from "../src/acceptance/summary.ts";

function row(index: number, status: "PASS" | "FAIL"): AcceptanceCriterionResult {
  return {
    id: `AC-${String(index).padStart(3, "0")}`,
    title: `criterion ${index}`,
    status,
    evidence: { index },
    blockers: status === "PASS" ? [] : [`criterion ${index} failed`],
  };
}

test("PoC acceptance completes only when all 14 criteria pass", () => {
  const complete = summarizeAcceptance(
    "run",
    "dataset",
    Array.from({ length: 14 }, (_, index) => row(index + 1, "PASS")),
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(complete.status, "COMPLETE");
  assert.equal(complete.passed, 14);
  assert.equal(complete.failed, 0);

  const incompleteRows = Array.from(
    { length: 14 },
    (_, index) => row(index + 1, index === 8 ? "FAIL" : "PASS"),
  );
  const incomplete = summarizeAcceptance(
    "run",
    "dataset",
    incompleteRows,
    "2026-10-01T00:00:00.000Z",
  );
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.equal(incomplete.passed, 13);
  assert.equal(incomplete.failed, 1);
  assert.deepEqual(incomplete.criteria[8]?.blockers, ["criterion 9 failed"]);
});
