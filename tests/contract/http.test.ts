/**
 * HTTP integration tests: the daemon API against an in-memory manager
 * (fake ports, no real ssh). Guards the contract every front shares.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TunnelManager, createServiceApp } from "@ssh-tunnel/service";
import { systemClock } from "@ssh-tunnel/host-node";
import type { ProbePort, ProcessPort, SpawnedProcess, StorePort, TerminalPort } from "@ssh-tunnel/host-node";
import type { TunnelProfile } from "@ssh-tunnel/contract";

function fakePorts(): {
  process: ProcessPort;
  probe: ProbePort;
  store: StorePort;
  spawned: { argv: string[] }[];
} {
  const spawned: { argv: string[] }[] = [];
  let nextPid = 50000;
  const alive = new Set<number>();
  const process: ProcessPort = {
    spawn(argv): SpawnedProcess {
      const pid = nextPid++;
      alive.add(pid);
      spawned.push({ argv: [...argv] });
      return {
        pid,
        exited: new Promise(() => undefined),
        kill(): void {
          alive.delete(pid);
        },
      };
    },
    isAlive(pid): boolean {
      return alive.has(pid);
    },
    killTree(pid): void {
      alive.delete(pid);
    },
  };
  const probe: ProbePort = {
    async dialTcp(_host, _port, _timeoutMs) {
      return { ok: true, latencyMs: 1 };
    },
  };
  let saved: readonly TunnelProfile[] = [];
  const store: StorePort = {
    async readProfiles(): Promise<readonly TunnelProfile[]> {
      return saved;
    },
    async writeProfiles(profiles: readonly TunnelProfile[]): Promise<void> {
      saved = [...profiles];
    },
  };
  return { process, probe, store, spawned };
}

const INPUT = {
  name: "int test",
  mode: "local",
  sshTarget: "ufo",
  forwards: [{ kind: "local", bindPort: 18099, targetHost: "127.0.0.1", targetPort: 22 }],
} as const;

async function post(app: { request: (input: string | Request, init?: RequestInit) => Promise<Response> }, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const response = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as unknown;
  return { status: response.status, json };
}

async function get(app: { request: (input: string | Request, init?: RequestInit) => Promise<Response> }, path: string): Promise<{ status: number; json: unknown }> {
  const response = await app.request(path);
  const json = (await response.json().catch(() => null)) as unknown;
  return { status: response.status, json };
}

describe("daemon API", () => {
  let app: ReturnType<typeof createServiceApp>;
  let spawned: { argv: string[] }[];

  beforeEach(() => {
    const ports = fakePorts();
    spawned = ports.spawned;
    const manager = new TunnelManager({
      process: ports.process,
      probe: ports.probe,
      store: ports.store,
      clock: systemClock,
      logDir: "/tmp/ssh-tunnel-test-logs",
    });
    app = createServiceApp({ manager, serviceInstanceId: "test-instance" });
  });

  it("health reports version + instance", async () => {
    const { status, json } = await get(app, "/api/health");
    expect(status).toBe(200);
    expect((json as { ok: boolean }).ok).toBe(true);
  });

  it("full profile lifecycle: create -> preview -> start -> probe -> stop -> delete", async () => {
    const created = await post(app, "/api/profiles", INPUT);
    expect(created.status).toBe(201);
    const id = (created.json as { id: string }).id;
    expect(typeof id).toBe("string");

    const preview = await get(app, `/api/profiles/${id}/preview`);
    expect(preview.status).toBe(200);
    expect(((preview.json as { argv: string[] }).argv.join(" "))).toContain("-L");

    const started = await post(app, `/api/states/${id}/start`);
    expect(started.status).toBe(200);
    expect((started.json as { status: string }).status).toBe("running");
    expect(spawned[0]?.argv.join(" ")).toContain("ufo");

    const probed = await post(app, `/api/states/${id}/probe`);
    expect((probed.json as { status: string }).status).toBe("running");

    const stopped = await post(app, `/api/states/${id}/stop`);
    expect((stopped.json as { status: string }).status).toBe("stopped");

    const deleted = await app.request(`/api/profiles/${id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
  });

  it("rejects malformed input with InvalidRequest (400)", async () => {
    const { status, json } = await post(app, "/api/profiles", { name: "", mode: "nope" });
    expect(status).toBe(400);
    expect((json as { problem: { code: string } }).problem.code).toBe("InvalidRequest");
  });

  it("returns NotFound (404) for unknown ids", async () => {
    const { status, json } = await post(app, "/api/states/nope/start");
    expect(status).toBe(404);
    expect((json as { problem: { code: string } }).problem.code).toBe("NotFound");
  });

  it("refuses double-start with Conflict (409)", async () => {
    const created = await post(app, "/api/profiles", INPUT);
    const id = (created.json as { id: string }).id;
    await post(app, `/api/states/${id}/start`);
    const again = await post(app, `/api/states/${id}/start`);
    expect(again.status).toBe(409);
    expect((again.json as { problem: { code: string } }).problem.code).toBe("Conflict");
  });

  describe("terminal sessions", () => {
    let launched: { terminalId: string; commandLine: string }[];
    let closed: number[];

    beforeEach(() => {
      launched = [];
      closed = [];
      const ports = fakePorts();
      spawned = ports.spawned;
      let nextPid = 60000;
      const terminal: TerminalPort = {
        detect: () => [
          { id: "terminal", label: "Terminal", hint: "com.apple.Terminal", platform: "darwin" },
          { id: "warp", label: "Warp", hint: "dev.warp.Warp-Stable", platform: "darwin" },
        ],
        async launch(terminalId, commandLine): Promise<number> {
          launched.push({ terminalId, commandLine });
          return nextPid++;
        },
        close(pid): void {
          closed.push(pid);
        },
      };
      const manager = new TunnelManager({
        process: ports.process,
        probe: ports.probe,
        store: ports.store,
        clock: systemClock,
        logDir: "/tmp/ssh-tunnel-test-logs",
        terminal,
      });
      app = createServiceApp({ manager, serviceInstanceId: "test-instance" });
    });

    it("lists only terminals the host reports", async () => {
      const { status, json } = await get(app, "/api/terminals");
      expect(status).toBe(200);
      expect((json as { terminals: { id: string }[] }).terminals.map((t) => t.id)).toEqual([
        "terminal",
        "warp",
      ]);
    });

    it("launches the exact ssh command and tracks the session pid", async () => {
      const created = await post(app, "/api/profiles", INPUT);
      const id = (created.json as { id: string }).id;

      const result = await post(app, `/api/profiles/${id}/launch`, { terminalId: "warp" });
      expect(result.status).toBe(200);
      const body = result.json as { pid: number; command: string; terminalId: string };
      expect(body.terminalId).toBe("warp");
      expect(body.pid).toBeGreaterThan(0);
      // The command handed to the terminal is the same one preview returns.
      const preview = await get(app, `/api/profiles/${id}/preview`);
      expect(body.command).toBe((preview.json as { command: string }).command);
      expect(launched[0]?.commandLine).toContain("-L");

      const closedSession = await app.request(`/api/profiles/${id}/session`, { method: "DELETE" });
      expect(closedSession.status).toBe(200);
      expect(closed).toEqual([body.pid]);
    });

    it("reports a launcher that refuses the call as TerminalFailed (502)", async () => {
      const ports = fakePorts();
      const refusing: TerminalPort = {
        detect: () => [
          { id: "iterm2", label: "iTerm2", hint: "com.googlecode.iterm2", platform: "darwin" },
        ],
        async launch(): Promise<number> {
          throw new Error(
            "iTerm2 refused the launch: execution error: iTerm got an error: A privilege violation occurred. (-10004)",
          );
        },
        close(): void {
          // Nothing was spawned, so there is nothing to end.
        },
      };
      const manager = new TunnelManager({
        process: ports.process,
        probe: ports.probe,
        store: ports.store,
        clock: systemClock,
        logDir: "/tmp/ssh-tunnel-test-logs",
        terminal: refusing,
      });
      const refusingApp = createServiceApp({ manager, serviceInstanceId: "test-refusing" });
      const created = await post(refusingApp, "/api/profiles", INPUT);
      const id = (created.json as { id: string }).id;

      const result = await post(refusingApp, `/api/profiles/${id}/launch`, {
        terminalId: "iterm2",
      });
      expect(result.status).toBe(502);
      const problem = (result.json as { problem: { code: string; message: string } }).problem;
      expect(problem.code).toBe("TerminalFailed");
      // The launcher's own words are what tell the user to grant Automation.
      expect(problem.message).toContain("-10004");
    });

    it("rejects an uninstalled terminal with NotFound (404)", async () => {
      const created = await post(app, "/api/profiles", INPUT);
      const id = (created.json as { id: string }).id;
      const result = await post(app, `/api/profiles/${id}/launch`, { terminalId: "ghostty" });
      expect(result.status).toBe(404);
      expect((result.json as { problem: { code: string } }).problem.code).toBe("NotFound");
    });

    it("relaunching replaces the tracked session", async () => {
      const created = await post(app, "/api/profiles", INPUT);
      const id = (created.json as { id: string }).id;
      const first = await post(app, `/api/profiles/${id}/launch`, { terminalId: "terminal" });
      await post(app, `/api/profiles/${id}/launch`, { terminalId: "warp" });
      expect(closed).toEqual([(first.json as { pid: number }).pid]);
    });
  });
});
