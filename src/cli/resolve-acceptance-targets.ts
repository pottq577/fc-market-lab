import { readFile, writeFile } from "node:fs/promises";

import {
  parseAcceptanceTargetDocument,
  resolveAcceptanceTargets,
} from "../catalog/acceptance-targets.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const inputPath = readOption(args, "input") ?? "data/catalog/acceptance-targets.json";
const outputPath = readOption(args, "output") ?? "data/catalog/acceptance-targets.resolved.json";
const document = parseAcceptanceTargetDocument(JSON.parse(await readFile(inputPath, "utf8")));
const resolved = await resolveAcceptanceTargets(document);
await writeFile(outputPath, `${JSON.stringify(resolved, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  status: "RESOLVED",
  input_path: inputPath,
  output_path: outputPath,
  targets: resolved.targets.map((target) => ({
    target_id: target.target_id,
    spid: target.spid,
    grade: target.grade,
    season: target.season,
  })),
}, null, 2));
