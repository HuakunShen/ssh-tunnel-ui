/**
 * Hosts without OpenSSH multiplexing (Windows) must still get a working
 * tunnel.
 *
 * The control socket is a POSIX feature: where it does not exist the daemon
 * owns a tunnel by the pid it spawned. These tests pin both halves of that
 * decision — the argv that is built, and the record that is adopted after a
 * restart — because a mistake here is invisible on the machine the code is
 * written on.
 */
import { describe, expect, it } from "vitest";
import { TunnelManager, createServiceApp } from "@ssh-tunnel/service";
import { systemClock } from "@ssh-tunnel/host-node";
import type {
  ProbePort,
  ProcessPort,
  RuntimeRecord,
  RuntimeStorePort,
  SpawnedProcess,
  StorePort,
} from "@ssh-tunnel/host-node";
import type { TunnelProfile } from "@ssh-tunnel/contract";

interface FakeHost {
  readonly process: ProcessPort;
  readonly probe: ProbePort;
  readonly store: StorePort;
  readonly runtime: RuntimeStorePort;
  readonly spawned: { argv: string[] }[];
  readonly pids: number[];
  readonly killed: number[];
  readonly alive: Set<number>;
}

function fakeHost(): FakeHost {
  const spawned: { argv: string[] }[] = [];
  const pids: number[] = [];
  const killed: number[] = [];
  const alive = new Set<number>();
  let nextPid = 50_000;
  const process: ProcessPort = {
    spawn(argv): SpawnedProcess {
      const pid = nextPid++;
      alive.add(pid);
      spawned.push({ argv: [...argv] });
      pids.push(pid);
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
      killed.push(pid);
      alive.delete(pid);
    },
  };
  const probe: ProbePort = {
    async dialTcp() {
      return { ok: true, latencyMs: 1 };
    },
  };
  let saved: readonly TunnelProfile[] = [];
  const store: StorePort = {
    async readProfiles() {
      return saved;
    },
    async writeProfiles(profiles) {
      saved = [...profiles];
    },
  };
  let records: readonly RuntimeRecord[] = [];
  const runtime: RuntimeStorePort = {
    async read() {
      return records;
    },
    async write(next) {
      records = [...next];
    },
  };
  return { process, probe, store, runtime, spawned, pids, killed, alive };
}

const INPUT = {
  name: "no mux",
  mode: "local",
  sshTarget: "ufo",
  forwards: [{ kind: "local", bindPort: 18099, targetHost: "127.0.0.1", targetPort: 22 }],
} as const;

/** A daemon wired the way a host without multiplexing wires it: no `control`. */
function appFor(host: FakeHost): ReturnType<typeof createServiceApp> {
  const manager = new TunnelManager({
    process: host.process,
    probe: host.probe,
    store: host.store,
    clock: systemClock,
    logDir: "/tmp/ssh-tunnel-test-logs",
    runtime: host.runtime,
  });
  return createServiceApp({ manager, serviceInstanceId: "test-instance" });
}

async function createProfile(app: ReturnType<typeof createServiceApp>): Promise<string> {
  const response = await app.request("/api/profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(INPUT),
  });
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function start(app: ReturnType<typeof createServiceApp>, id: string): Promise<Response> {
  return app.request(`/api/states/${id}/start`, { method: "POST" });
}

describe("a host without control sockets", () => {
  it("starts ssh without ControlMaster or ControlPath", async () => {
    const host = fakeHost();
    const app = appFor(host);
    const id = await createProfile(app);

    const response = await start(app, id);
    expect(response.status).toBe(200);
    const argv = host.spawned[0]?.argv.join(" ") ?? "";
    expect(argv).toContain("-L");
    // The whole point: ssh on such a host refuses the option, so it must not
    // be there — while the forward itself is unchanged.
    expect(argv).not.toContain("ControlMaster");
    expect(argv).not.toContain("ControlPath");
  });

  it("stops a tunnel it adopted by pid", async () => {
    const host = fakeHost();
    const first = appFor(host);
    const id = await createProfile(first);
    await start(first, id);
    const pid = host.pids[0];
    expect(pid).toBeDefined();

    // A fresh daemon over the same files: the record is all it has.
    const second = new TunnelManager({
      process: host.process,
      probe: host.probe,
      store: host.store,
      clock: systemClock,
      logDir: "/tmp/ssh-tunnel-test-logs",
      runtime: host.runtime,
    });
    const app = createServiceApp({ manager: second, serviceInstanceId: "second" });
    const listed = await app.request(`/api/states/${id}`);
    const state = (await listed.json()) as { status: string; origin?: string };
    expect(state.status).toBe("running");
    expect(state.origin).toBe("managed");

    const stopped = await app.request(`/api/states/${id}/stop`, { method: "POST" });
    expect(stopped.status).toBe(200);
    expect(((await stopped.json()) as { status: string }).status).toBe("stopped");
    expect(host.killed).toContain(pid);
  });
});

describe("a host with control sockets", () => {
  it("still passes the socket to ssh", async () => {
    const host = fakeHost();
    const manager = new TunnelManager({
      process: host.process,
      probe: host.probe,
      store: host.store,
      clock: systemClock,
      logDir: "/tmp/ssh-tunnel-test-logs",
      controlDir: "/tmp/ssh-tunnel-test-control",
      control: {
        check: async () => false,
        exit: async () => true,
      },
      runtime: host.runtime,
    });
    const app = createServiceApp({ manager, serviceInstanceId: "test-instance" });
    const id = await createProfile(app);
    await start(app, id);
    const argv = host.spawned[0]?.argv.join(" ") ?? "";
    expect(argv).toContain("ControlMaster=yes");
    expect(argv).toContain("ControlPath=");
  });
});
