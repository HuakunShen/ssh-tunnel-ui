/**
 * Daemon supervisor for the VS Code extension: attaches to a running daemon
 * when healthy, otherwise spawns `ssh-tunnel-serve` bundled beside the
 * extension and waits for `/api/health`. Loopback only, port default 7432.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

export interface DaemonReadiness {
  readonly url: string;
  readonly serviceInstanceId: string;
}

export interface RunningDaemon {
  readonly readiness: DaemonReadiness;
  readonly owned: boolean;
  stop(): void;
}

async function healthOk(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; serviceInstanceId?: string }> {
  try {
    const response = await fetchImpl(`${url}/api/health`);
    if (!response.ok) return { ok: false };
    const body = (await response.json()) as { serviceInstanceId?: unknown };
    return {
      ok: true,
      ...(typeof body.serviceInstanceId === "string"
        ? { serviceInstanceId: body.serviceInstanceId }
        : {}),
    };
  } catch {
    return { ok: false };
  }
}

async function waitFor(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; serviceInstanceId?: string }> {
  const started = Date.now();
  for (;;) {
    const result = await healthOk(url, fetchImpl);
    if (result.ok) return result;
    if (Date.now() - started > timeoutMs) return { ok: false };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Attach to `daemonUrl` when it answers, else spawn the bundled server
 * (`serverDir/server.mjs` via node, or a native sidecar) and wait for it.
 */
export async function ensureDaemon(options: {
  readonly daemonUrl?: string;
  readonly serverDir?: string;
  readonly storePath?: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}): Promise<RunningDaemon> {
  const url = (options.daemonUrl ?? "http://127.0.0.1:7432").replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const existing = await healthOk(url, fetchImpl);
  if (existing.ok) {
    return {
      readiness: {
        url,
        serviceInstanceId: existing.serviceInstanceId ?? "attached",
      },
      owned: false,
      stop(): void {
        // Attached daemons are not ours to kill.
      },
    };
  }

  const serverDir = options.serverDir ?? __dirname;
  const script = join(serverDir, "server.mjs");
  const { existsSync } = await import("node:fs");
  let child: ChildProcess;
  if (existsSync(script)) {
    child = spawn("node", [script, "--port=7432", "--host=127.0.0.1"], {
      stdio: "ignore",
      detached: false,
    });
  } else {
    const binary = join(serverDir, "ssh-tunnel-serve");
    const args = ["--port=7432", "--host=127.0.0.1"];
    if (options.storePath !== undefined) args.push(`--store=${options.storePath}`);
    child = spawn(binary, args, { stdio: "ignore", detached: false });
  }
  // A spawn that cannot exec (missing binary) emits `error`, not `exit` —
  // without a listener it becomes an uncaught exception. Swallow it here:
  // `waitFor` still times out and reports the actionable failure below.
  child.on("error", () => undefined);
  const ready = await waitFor(url, options.timeoutMs ?? 15000, fetchImpl);
  if (!ready.ok) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    throw new Error("ssh-tunnel daemon did not become ready; is node installed and port 7432 free?");
  }
  return {
    readiness: { url, serviceInstanceId: ready.serviceInstanceId ?? "spawned" },
    owned: true,
    stop(): void {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    },
  };
}
