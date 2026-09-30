import { readFile } from "node:fs/promises";

import { parseSeedCatalogDocument } from "../catalog/seed-catalog.ts";
import { buildDatacenterMetadataTemplate } from "../evidence/datacenter-metadata.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const catalogPath =
  readOption(args, "catalog") ?? "data/catalog/seed-catalog.json";
const catalog = parseSeedCatalogDocument(
  JSON.parse(await readFile(catalogPath, "utf8")),
);
console.log(JSON.stringify(buildDatacenterMetadataTemplate(catalog), null, 2));
