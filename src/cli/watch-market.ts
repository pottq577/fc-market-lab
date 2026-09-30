import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function intervalHours(): number {
  const raw = process.env.FC_MARKET_SYNC_INTERVAL_HOURS ?? "24";
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("FC_MARKET_SYNC_INTERVAL_HOURS must be a positive number");
  }
  return value;
}

function runOnce(): Promise<number> {
  const script = fileURLToPath(new URL("./sync-market.ts", import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", script],
      { stdio: "inherit", env: process.env },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

const delayMs = intervalHours() * 60 * 60 * 1000;
while (true) {
  const code = await runOnce();
  if (code !== 0) {
    console.error(`market sync exited with code ${code}; retrying after the configured interval`);
  }
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
