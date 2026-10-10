/**
 * HTTP integration tests: the daemon API against an in-memory manager
 * (fake ports, no real ssh). Guards the contract every front shares.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TunnelManager, createServiceApp } from "@ssh-tunnel/service";
import { systemClock } from "@ssh-tunnel/host-node";
import type { ProbePort, ProcessPort, SpawnedProcess, StorePort } from "@ssh-tunnel/host-node";
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
});
