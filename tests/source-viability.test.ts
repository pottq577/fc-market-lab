import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateGate0A,
  parseSourceViabilityDocument,
} from "../src/gates/source-viability.ts";

function completeEvidence(
  automationDecision: "ALLOWED" | "MANUAL_ONLY" = "ALLOWED",
) {
  return {
    schema_version: 1,
    evidence: [
      {
        source_id: "price-source",
        purpose: "PRICE_HISTORY",
        source_url: "https://example.com/prices",
        policy_url: "https://example.com/policy",
        policy_checked_at: "2026-09-29T16:20:00+09:00",
        access_method: automationDecision === "ALLOWED" ? "API" : "MANUAL_EXPORT",
        native_granularity: "DAILY",
        history_span: "365D",
        price_semantics: "MARKET_REFERENCE_PRICE",
        automation_decision: automationDecision,
        decision_reason: "verified",
        evidence_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
  };
}

test("marks a complete allowed source ready for automation", () => {
  const document = parseSourceViabilityDocument(completeEvidence());
  const result = evaluateGate0A(document);

  assert.equal(result.status, "READY_AUTOMATION");
  assert.equal(result.sources[0]?.status, "READY_AUTOMATION");
  assert.deepEqual(result.sources[0]?.blockers, []);
});

test("marks a complete manual-only source ready for manual collection", () => {
  const document = parseSourceViabilityDocument(
    completeEvidence("MANUAL_ONLY"),
  );
  const result = evaluateGate0A(document);

  assert.equal(result.status, "READY_MANUAL");
  assert.equal(result.sources[0]?.status, "READY_MANUAL");
});

test("keeps unknown policy and automation decisions blocked", () => {
  const input = completeEvidence();
  input.evidence[0].policy_url = "UNKNOWN";
  input.evidence[0].automation_decision = "UNKNOWN" as "ALLOWED";

  const document = parseSourceViabilityDocument(input);
  const result = evaluateGate0A(document);

  assert.equal(result.status, "BLOCKED");
  assert.equal(result.sources[0]?.status, "INCOMPLETE");
  assert.deepEqual(result.sources[0]?.blockers, [
    "policy_url=UNKNOWN",
    "automation_decision=UNKNOWN",
  ]);
});

test("rejects unsupported enum values", () => {
  const input = completeEvidence();
  input.evidence[0].price_semantics = "AVERAGE_PRICE" as "MARKET_REFERENCE_PRICE";

  assert.throws(
    () => parseSourceViabilityDocument(input),
    /price_semantics must be one of/,
  );
});

test("rejects duplicate source ids", () => {
  const input = completeEvidence();
  input.evidence.push({ ...input.evidence[0] });

  assert.throws(
    () => parseSourceViabilityDocument(input),
    /duplicate source_id: price-source/,
  );
});

test("current Gate 0A evidence is ready for manual price-history collection", async () => {
  const raw = await readFile("data/evidence/source-viability.json", "utf8");
  const document = parseSourceViabilityDocument(JSON.parse(raw));
  const result = evaluateGate0A(document);

  assert.equal(result.status, "READY_MANUAL");
  assert.deepEqual(
    result.sources.map((source) => [source.source_id, source.status]),
    [
      ["nexon-open-api-fconline-price-history", "REJECTED"],
      ["fconline-datacenter-price-history", "READY_MANUAL"],
    ],
  );

  const datacenter = result.sources[1];
  assert.equal(datacenter?.automation_decision, "MANUAL_ONLY");
  assert.deepEqual(datacenter?.blockers, []);
});
