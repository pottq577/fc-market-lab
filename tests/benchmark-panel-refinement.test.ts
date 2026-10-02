import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REFINEMENT_PANEL_SIZES,
  parseRefinementPanelSizes,
  summarizePassTail,
  validateRefinementPanelSizes,
} from "../src/benchmark/panel-refinement.ts";

test("parses and validates a dense refinement grid while preserving baseline anchors", () => {
  assert.deepEqual(parseRefinementPanelSizes(), [...DEFAULT_REFINEMENT_PANEL_SIZES]);
  assert.deepEqual(
    parseRefinementPanelSizes("200,300,400,500,600,700,800"),
    [200, 300, 400, 500, 600, 700, 800],
  );
  assert.deepEqual(
    validateRefinementPanelSizes(
      [200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800],
      [100, 200, 400, 800],
    ),
    [200, 400, 800],
  );
  assert.throws(
    () => parseRefinementPanelSizes("200,400,400,800"),
    /duplicates/,
  );
  assert.throws(
    () => parseRefinementPanelSizes("200,500,400,800"),
    /strictly increasing/,
  );
  assert.throws(
    () => validateRefinementPanelSizes([200, 400, 700], [100, 200, 400, 800]),
    /largest panel must remain P800/,
  );
});

test("reports the earliest panel whose entire larger-panel tail passes", () => {
  const pairs = [
    [200, 250, "FAIL"],
    [250, 300, "FAIL"],
    [300, 350, "PASS"],
    [350, 400, "PASS"],
    [400, 450, "PASS"],
    [450, 800, "PASS"],
  ].map(([smaller, larger, status]) => ({
    smaller_panel_label: `P${smaller}`,
    smaller_panel_size: Number(smaller),
    larger_panel_label: `P${larger}`,
    larger_panel_size: Number(larger),
    status: status as "PASS" | "FAIL" | "INSUFFICIENT",
  }));

  assert.deepEqual(summarizePassTail(pairs), {
    start_panel_label: "P300",
    start_panel_size: 300,
    end_panel_label: "P800",
    end_panel_size: 800,
    pass_pair_count: 4,
  });
  assert.equal(
    summarizePassTail(pairs.map((pair) => ({ ...pair, status: "FAIL" as const }))),
    null,
  );
});
