import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { collectOpenApiMetadata } from "../collect/openapi-metadata.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function fileTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

const args = process.argv.slice(2);
const rawDir = readOption(args, "raw-dir") ?? "data/raw/openapi-metadata";
const manifestPath = readOption(args, "manifest") ?? join(rawDir, "latest.json");
const observedAt = readOption(args, "observed-at") ?? new Date().toISOString();
const artifacts = await collectOpenApiMetadata({ observedAt });
const dayDir = join(rawDir, observedAt.slice(0, 10));
await mkdir(dayDir, { recursive: true });

const paths: Record<string, string> = {};
for (const artifact of artifacts) {
  const path = join(
    dayDir,
    `${artifact.kind}-${fileTimestamp(artifact.observed_at)}.json`,
  );
  await writeFile(path, artifact.raw);
  paths[artifact.kind] = path;
}

const manifest = {
  schema_version: 1,
  observed_at: observedAt,
  artifacts: paths,
};
await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ...manifest, manifest_path: manifestPath }, null, 2));
