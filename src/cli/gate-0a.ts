import { readFile } from "node:fs/promises";

import {
  evaluateGate0A,
  parseSourceViabilityDocument,
} from "../gates/source-viability.ts";

const args = process.argv.slice(2);
const evidencePath = args.find((arg) => !arg.startsWith("--")) ??
  "data/evidence/source-viability.json";
const requireReady = args.includes("--require-ready");

const raw = await readFile(evidencePath, "utf8");
const document = parseSourceViabilityDocument(JSON.parse(raw));
const summary = evaluateGate0A(document);

console.log(JSON.stringify(summary, null, 2));

if (requireReady && summary.status === "BLOCKED") {
  process.exitCode = 2;
}
