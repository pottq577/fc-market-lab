import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";

import { listViewerRuns, loadViewerPayload } from "./data.ts";
import { loadBenchmarkViewerPayload } from "./benchmark-data.ts";
import { benchmarkViewerPage } from "./benchmark-page.ts";
import { insightViewerPage } from "./insight-page.ts";
import { viewerPage as legacyViewerPage } from "./page.ts";

export interface ViewerServerOptions {
  dbPath: string;
  host: string;
  port: number;
}

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function createViewerServer(options: ViewerServerOptions): {
  server: Server;
  close: () => void;
} {
  const db = new DatabaseSync(options.dbPath, { readOnly: true });
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${options.host}:${options.port}`);
      if (request.method !== "GET") {
        response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
        response.end("Method Not Allowed\n");
        return;
      }
      if (url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(url.searchParams.get("legacy") === "1" ? legacyViewerPage() : insightViewerPage());
        return;
      }
      if (url.pathname === "/benchmark") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(benchmarkViewerPage());
        return;
      }
      if (url.pathname === "/api/benchmark") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(json(loadBenchmarkViewerPayload(db)));
        return;
      }
      if (url.pathname === "/api/runs") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(json(listViewerRuns(db)));
        return;
      }
      if (url.pathname === "/api/data") {
        const run = url.searchParams.get("run") ?? undefined;
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(json(loadViewerPayload(db, run)));
        return;
      }
      if (url.pathname === "/health") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("ok\n");
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found\n");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    }
  });
  return {
    server,
    close() {
      server.close();
      db.close();
    },
  };
}
