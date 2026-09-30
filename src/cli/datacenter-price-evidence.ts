import { readFile } from "node:fs/promises";

import { buildDatacenterPriceCaptureEvidence } from "../evidence/datacenter-price-history.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(`--${name}`);
  if (index >= 0) {
    return args[index + 1];
  }
  return undefined;
}

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith("--"));
if (!inputPath) {
  throw new TypeError(
    "usage: npm run evidence:datacenter-price -- <saved-response> --spid <spid> --grade <grade> [--observed-at <iso>]",
  );
}

const spid = readOption(args, "spid");
const gradeRaw = readOption(args, "grade");
const observedAt = readOption(args, "observed-at") ?? new Date().toISOString();
if (!spid || !gradeRaw) {
  throw new TypeError("--spid and --grade are required");
}

const grade = Number(gradeRaw);
const raw = await readFile(inputPath, "utf8");
const evidence = buildDatacenterPriceCaptureEvidence({
  raw,
  spid,
  grade,
  observed_at: observedAt,
});

console.log(JSON.stringify(evidence, null, 2));
