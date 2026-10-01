import { createViewerServer } from "../viewer/server.ts";

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const dbPath = readOption(args, "db") ?? "data/fc-market-lab.db";
const host = readOption(args, "host") ?? "127.0.0.1";
const port = Number(readOption(args, "port") ?? "8790");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new TypeError("--port must be an integer between 1 and 65535");
}

const viewer = createViewerServer({ dbPath, host, port });
viewer.server.listen(port, host, () => {
  console.log(`FC Market Lab Viewer: http://${host}:${port}`);
  console.log(`Database: ${dbPath}`);
});

function shutdown(): void {
  viewer.close();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
