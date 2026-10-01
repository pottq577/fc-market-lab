import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAcceptanceTargetDocument,
  parseResolvedAcceptanceTargetDocument,
  resolveAcceptanceTargets,
} from "../src/catalog/acceptance-targets.ts";

const document = parseAcceptanceTargetDocument({
  schema_version: 1,
  catalog_id: "acceptance-test",
  targets: [{
    target_id: "cucurella",
    player_key: "marc-cucurella",
    player_name: "마르크 쿠쿠레야",
    season: "26TOTS",
    grade: 11,
    valid_from: "2026-09-10T15:30:00+09:00",
    roles: ["SAME_PLAYER", "REGIME_TARGET"],
    evidence_urls: ["https://example.com/evidence"],
  }],
});

test("resolves acceptance targets by exact season and player metadata", async () => {
  const resolved = await resolveAcceptanceTargets(document, {
    resolvedAt: "2026-10-01T05:00:00.000Z",
    fetchJson: async (url) => url.includes("seasonid")
      ? [{ seasonId: 900, className: "26TOTS" }]
      : [
          { id: 900111111, name: "다른 선수" },
          { id: 900222222, name: "마르크 쿠쿠레야" },
        ],
  });
  assert.equal(resolved.targets[0]?.spid, "900222222");
  assert.equal(
    parseResolvedAcceptanceTargetDocument(resolved).targets[0]?.grade,
    11,
  );
});

test("rejects ambiguous spid metadata instead of guessing", async () => {
  await assert.rejects(
    resolveAcceptanceTargets(document, {
      fetchJson: async (url) => url.includes("seasonid")
        ? [{ seasonId: 900, className: "26TOTS" }]
        : [
            { id: 900111111, name: "마르크 쿠쿠레야" },
            { id: 900222222, name: "마르크 쿠쿠레야" },
          ],
    }),
    /resolved to 2 spid rows/,
  );
});
