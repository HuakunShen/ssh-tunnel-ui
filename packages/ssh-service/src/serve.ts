/**
 * Node launcher for the tunnel daemon: builds the manager from real host
 * ports, serves the Hono API plus the static Web UI, and writes a port file
 * so thin fronts (TUI/CLI/D…and plugins) can discover it.
 */
import { serve } from "@hono/node-server";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { createNodeProbePort, createNodeProcessPort, createFileStorePort, systemClock } from "@ssh-tunnel/host-node";
import { TunnelManager } from "./manager.js";
import { createServiceApp, SERVICE_VERSION } from "./http.js";

export interface ServeOptions {
  readonly port?: number;
  readonly host?: string;
  readonly storePath?: string;
  readonly logDir?: string;
  readonly webDir?: string;
  readonly sshPath?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function homeDir(): string {
  return process.env["HOME"] ?? process.env["USERPROFILE"] ?? process.cwd();
}

export async function startDaemon(options: ServeOptions = {}): Promise<{ port: number; instanceId: string }> {
  const home = homeDir();
  const base = join(home, ".ssh-tunnel-ui");
  const storePath = options.storePath ?? join(base, "profiles.json");
  const logDir = options.logDir ?? join(base, "logs");
  // Only create directories we actually use: an explicit --store/--log-dir
  // elsewhere must not force a home-directory write (sandboxes forbid it).
  for (const dir of [dirname(storePath), logDir]) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // The store/probe layers surface real failures with context.
    }
  }

  const manager = new TunnelManager({
    process: createNodeProcessPort(options.sshPath ?? "ssh"),
    probe: createNodeProbePort(),
    store: createFileStorePort(storePath),
    clock: systemClock,
    logDir,
  });
  const instanceId = `svc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const api = createServiceApp({ manager, serviceInstanceId: instanceId });

  // Static Web UI falls through after /api/*.
  const webDir = options.webDir;
  if (webDir !== undefined) {
    api.get("/*", (c) => {
      const urlPath = new URL(c.req.url).pathname;
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
      if (rel.includes("..")) return c.text("not found", 404);
      const file = join(webDir, rel);
      if (!existsSync(file)) {
        const index = join(webDir, "index.html");
        if (!existsSync(index)) return c.text("web UI not built", 404);
        return new Response(readFileSync(index), { headers: { "content-type": MIME[".html"] ?? "text/html" } });
      }
      const mime = MIME[extname(file)] ?? "application/octet-stream";
      return new Response(readFileSync(file), { headers: { "content-type": mime } });
    });
  }

  const port = options.port ?? 7432;
  const host = options.host ?? "127.0.0.1";
  serve({ fetch: api.fetch, port, hostname: host });
  try {
    writeFileSync(join(dirname(storePath), "daemon.json"), JSON.stringify({ port, host, instanceId, version: SERVICE_VERSION, pid: process.pid }, null, 2));
  } catch {
    // Discovery file is best-effort.
  }
  return { port, instanceId };
}
