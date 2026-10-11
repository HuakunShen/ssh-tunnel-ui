/**
 * Host half of the SSH tunnel plugin for the DeepSeek Harness.
 *
 * It adds one thing to the Harness host process: the tunnel manager workbench,
 * rendered by this repo's own Web UI inside the Harness Web UI.
 *
 * The shape follows the Refyard/Space Lens plugins deliberately:
 *
 * - **No second browser origin.** The Harness owns a loopback web server, so
 *   the workbench mounts on it at `/ssh-tunnel` rather than taking a port of
 *   its own. One page origin means no CORS and nothing new reachable.
 * - **The workbench is the product, not a reimplementation.** A real
 *   `TunnelManager` + Hono app is assembled in this process out of
 *   `@ssh-tunnel/host-node` — the same wiring the daemon uses — so every
 *   tunnel operation (profiles, start/stop-all, probes, previews) is
 *   available here without a second implementation drifting behind.
 * - **Loopback-only guard.** The route checks Host/Origin/Sec-Fetch-Site the
 *   way the sibling plugins do, so a cross-site page cannot drive tunnels.
 * - **No approval model needed.** Tunnels spawn the user's own `ssh` with the
 *   user's own config/keys; the plugin adds no new authority beyond what the
 *   session's shell already has.
 */
import {
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TunnelManager } from "@ssh-tunnel/service";
import { createServiceApp } from "@ssh-tunnel/service";
import {
  createFileStorePort,
  createNodeProbePort,
  createNodeProcessPort,
  systemClock,
} from "@ssh-tunnel/host-node";

/** Where the workbench is mounted on the Harness web server. The client half reads it too. */
const PREFIX = "/ssh-tunnel";
/** The route the panel asks for its frame URL. */
const CONTEXT_ROUTE = `${PREFIX}/dsh/context`;

/** Wait for the web server before applying, so the route registers whenever it activates. */
export const inject = ["webServer"];

/** The part of the Harness web server this plugin needs. */
interface WebServerLike {
  readonly port?: number;
  register(route: {
    kind: "exact" | "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}

/** The slice of the Harness host context this plugin uses. */
interface HostContext {
  readonly logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  get(name: "webServer"): WebServerLike | undefined;
  effect(install: () => void | (() => void), label?: string): unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendProblem(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { problem: { status, message } });
}

export function apply(ctx: HostContext): void {
  const webServer = ctx.get("webServer");
  if (webServer === undefined) {
    ctx.logger.warn("ssh-tunnel: no webServer service; the tunnel panel has nothing to mount on");
    return;
  }

  // Store/log locations follow the daemon's layout; overridable for tests
  // and sandboxes that forbid home-directory writes.
  const base =
    process.env["SSH_TUNNEL_HOME"] ?? join(homedir(), ".ssh-tunnel-ui");
  const manager = new TunnelManager({
    process: createNodeProcessPort(),
    probe: createNodeProbePort(),
    store: createFileStorePort(join(base, "profiles.json")),
    clock: systemClock,
    logDir: join(base, "logs"),
  });
  // Same Hono app the daemon serves for `/api/*`, plus the static Web UI
  // this package stages under `web/` at build time (see `scripts/build.ts`).
  // Without the document branch the panel frame would land on a 404.
  const api = createServiceApp({ manager, serviceInstanceId: "dsh-plugin" });
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

  const WEB_MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };

  function serveDocument(urlPath: string, res: ServerResponse): boolean {
    const rel = urlPath === `${PREFIX}/` || urlPath === PREFIX ? "index.html" : urlPath.slice(PREFIX.length + 1);
    if (rel.includes("..")) return false;
    const file = join(webRoot, rel);
    if (!existsSync(file)) {
      // SPA fallback: deep links resolve to the shell.
      const index = join(webRoot, "index.html");
      if (!existsSync(index)) return false;
      res.writeHead(200, { "content-type": WEB_MIME[".html"] ?? "text/html", "cache-control": "no-store" });
      res.end(readFileSync(index));
      return true;
    }
    res.writeHead(200, {
      "content-type": WEB_MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(readFileSync(file));
    return true;
  }

  function originsFor(port: number): readonly string[] {
    return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = webServer?.port;
    if (typeof port !== "number" || !Number.isInteger(port) || port <= 0) {
      sendProblem(res, 503, "the Harness web server has no listening port yet");
      return;
    }
    const origins = originsFor(port);
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (typeof host !== "string" || host === "" || !origins.includes(`http://${host}`)) {
      sendProblem(res, 403, "this panel is served on a loopback origin only");
      return;
    }
    if (origin === "null") {
      sendProblem(res, 403, "request origin is not allowed");
      return;
    }
    if (typeof origin === "string" && origin !== "" && !origins.includes(origin)) {
      sendProblem(res, 403, "request origin is not allowed");
      return;
    }
    if (
      (origin === undefined || origin === "") &&
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      sendProblem(res, 403, "cross-site requests are refused");
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    if (url.pathname === CONTEXT_ROUTE) {
      sendJson(res, 200, { panelUrl: `${PREFIX}/` });
      return;
    }
    if (!url.pathname.startsWith(`${PREFIX}/api/`)) {
      if (serveDocument(url.pathname, res)) return;
      sendProblem(res, 404, "unknown ssh-tunnel panel route");
      return;
    }

    // Forward to the Hono app via a synthetic Request. Only string headers
    // travel: Node's raw header table can hold arrays/undefined, which the
    // Request constructor rejects.
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(", ");
    }
    const init: RequestInit = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk as Buffer);
      }
      init.body = Buffer.concat(chunks);
    }
    let answer: Response;
    try {
      // The mount prefix is this plugin's own; the Hono app answers `/api/*`.
      const upstreamPath = url.pathname.slice(PREFIX.length);
      answer = await api.fetch(
        new Request(`http://127.0.0.1${upstreamPath}${url.search}`, init),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.logger.error(`ssh-tunnel: workbench request failed: ${message}`);
      sendProblem(res, 500, "the tunnel workbench did not answer");
      return;
    }
    const outHeaders: Record<string, string> = {};
    answer.headers.forEach((value, key) => {
      outHeaders[key] = value;
    });
    res.writeHead(answer.status, outHeaders);
    if (answer.body === null) {
      res.end();
      return;
    }
    const reader = answer.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch {
      res.end();
    }
  }

  // Keep the unused import honest: direct proxying is unnecessary here because
  // the Hono app runs in-process; the import documents the alternative shape.
  void httpRequest;

  ctx.effect(
    () =>
      webServer.register({
        kind: "prefix",
        path: PREFIX,
        handler(req, res) {
          void handle(req, res).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            ctx.logger.error(`ssh-tunnel: panel request failed: ${message}`);
            if (!res.headersSent) {
              sendProblem(res, 500, `the tunnel panel failed: ${message}`);
            } else {
              res.end();
            }
          });
        },
      }),
    "ssh-tunnel: web route",
  );
  ctx.logger.info("ssh-tunnel: tunnel panel mounted");
}
