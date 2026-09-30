import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface RawHtmlFile {
  path: string;
  raw: Buffer;
  raw_sha256: string;
}

function sha256(raw: Buffer): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

async function listHtmlFiles(root: string): Promise<string[]> {
  const result: string[] = [];

  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        result.push(path);
      }
    }
  }

  await walk(root);
  return result.sort();
}

export async function indexRawHtmlFilesByHash(
  root: string,
): Promise<Map<string, RawHtmlFile>> {
  const byHash = new Map<string, RawHtmlFile>();
  for (const path of await listHtmlFiles(root)) {
    const raw = await readFile(path);
    const raw_sha256 = sha256(raw);
    if (!byHash.has(raw_sha256)) {
      byHash.set(raw_sha256, { path, raw, raw_sha256 });
    }
  }
  return byHash;
}
