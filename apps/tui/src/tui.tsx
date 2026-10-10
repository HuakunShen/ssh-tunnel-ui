/**
 * `ssh-tunnel-tui` — fullscreen terminal front over the same daemon API the
 * Web UI uses (or an in-process manager with `--direct`). Thin front: renders
 * states, sends start/stop/probe, never re-implements tunnel rules.
 */
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard } from "@opentui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createTunnelClient, type TunnelClient } from "@ssh-tunnel/client";
import {
  TunnelError,
  type TunnelProfile,
  type TunnelState,
} from "@ssh-tunnel/contract";
import { TunnelManager } from "@ssh-tunnel/service";
import {
  createFileStorePort,
  createNodeProbePort,
  createNodeProcessPort,
  systemClock,
} from "@ssh-tunnel/host-node";
import { join } from "node:path";
import { readFileSync } from "node:fs";

function homeDir(): string {
  return process.env["HOME"] ?? process.env["USERPROFILE"] ?? process.cwd();
}

function daemonBase(): string {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--daemon=")) return arg.slice("--daemon=".length).replace(/\/$/, "");
  }
  try {
    const raw = readFileSync(join(homeDir(), ".ssh-tunnel-ui", "daemon.json"), "utf8");
    const parsed = JSON.parse(raw) as { host?: unknown; port?: unknown };
    if (typeof parsed.host === "string" && typeof parsed.port === "number") {
      return `http://${parsed.host}:${parsed.port}`;
    }
  } catch {
    // Default below.
  }
  return "http://127.0.0.1:7432";
}

interface Snapshot {
  readonly profiles: readonly TunnelProfile[];
  readonly states: readonly TunnelState[];
  readonly error: string | null;
}

function statusDot(status: string): string {
  switch (status) {
    case "running":
      return "●";
    case "degraded":
      return "◐";
    case "starting":
    case "stopping":
      return "…";
    case "failed":
      return "✖";
    default:
      return "○";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "running":
      return "green";
    case "degraded":
      return "yellow";
    case "failed":
      return "red";
    default:
      return "#999";
  }
}

function App(props: { client: TunnelClient | null; manager: TunnelManager | null }): ReactNode {
  const [snapshot, setSnapshot] = useState<Snapshot>({ profiles: [], states: [], error: null });
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("q quit · ↑↓ select · enter start/stop · p probe · s stop-all · r refresh");

  const refresh = useCallback(async () => {
    try {
      const profiles =
        props.manager !== null ? await props.manager.listProfiles() : await props.client?.listProfiles() ?? [];
      const states =
        props.manager !== null ? await props.manager.listStates() : await props.client?.listStates() ?? [];
      setSnapshot({ profiles: [...profiles], states: [...states], error: null });
    } catch (error) {
      setSnapshot((prev) => ({
        ...prev,
        error: error instanceof TunnelError ? `${error.code}: ${error.message}` : "cannot reach backend",
      }));
    }
  }, [props.client, props.manager]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [refresh]);

  const statesById = useMemo(
    () => new Map(snapshot.states.map((s) => [s.profileId, s])),
    [snapshot.states],
  );

  const current = snapshot.profiles[selected];
  const currentState = current !== undefined ? statesById.get(current.id) : undefined;

  const act = useCallback(
    async (fn: () => Promise<unknown>, label: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        setNotice(label);
      } catch (error) {
        setNotice(error instanceof TunnelError ? `${error.code}: ${error.message}` : "action failed");
      } finally {
        setBusy(false);
        await refresh();
      }
    },
    [busy, refresh],
  );

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      process.exit(0);
    }
    if (snapshot.profiles.length === 0) {
      if (key.name === "r") void refresh();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      setSelected((s) => (s - 1 + snapshot.profiles.length) % snapshot.profiles.length);
    } else if (key.name === "down" || key.name === "j") {
      setSelected((s) => (s + 1) % snapshot.profiles.length);
    } else if (key.name === "return") {
      const profile = snapshot.profiles[selected];
      const state = profile !== undefined ? statesById.get(profile.id) : undefined;
      if (profile === undefined) return;
      if (state?.status === "running" || state?.status === "degraded") {
        void act(
          () => (props.manager !== null ? props.manager.stop(profile.id) : (props.client?.stop(profile.id) as Promise<unknown>)),
          `stopped ${profile.name}`,
        );
      } else {
        void act(
          () => (props.manager !== null ? props.manager.start(profile.id) : (props.client?.start(profile.id) as Promise<unknown>)),
          `started ${profile.name}`,
        );
      }
    } else if (key.name === "p") {
      const profile = snapshot.profiles[selected];
      if (profile === undefined) return;
      void act(
        () => (props.manager !== null ? props.manager.probe(profile.id) : (props.client?.probe(profile.id) as Promise<unknown>)),
        `probed ${profile.name}`,
      );
    } else if (key.name === "s") {
      void act(
        () => (props.manager !== null ? props.manager.stopAll() : (props.client?.stopAll() as Promise<unknown>)),
        "stopped all tunnels",
      );
    } else if (key.name === "r") {
      void refresh();
    }
  });

  const detail =
    current === undefined
      ? "no profiles yet — add one via the CLI or Web UI"
      : [
          `${current.name}  (${current.mode})`,
          `target: ${current.sshTarget}${current.jumpHops?.length ? ` via ${current.jumpHops.join(",")}` : ""}`,
          ...current.forwards.map((f) =>
            f.kind === "dynamic"
              ? `  -D ${f.bindAddress ? `${f.bindAddress}:` : ""}${f.bindPort} (SOCKS)`
              : f.kind === "local"
                ? `  -L ${f.bindAddress ? `${f.bindAddress}:` : ""}${f.bindPort} → ${f.targetHost}:${f.targetPort}`
                : `  -R ${f.bindAddress ? `${f.bindAddress}:` : ""}${f.bindPort} → ${f.targetHost}:${f.targetPort}`,
          ),
          currentState?.pid !== undefined ? `pid ${currentState.pid}` : "",
          currentState?.lastError ? `error: ${currentState.lastError}` : "",
          ...(currentState?.forwards.map((f) => `probe ${f.kind}:${f.bindPort} ${f.ok ? "ok" : "FAIL"}${f.latencyMs !== undefined ? ` ${f.latencyMs}ms` : ""}`) ?? []),
        ]
          .filter((line) => line !== "")
          .join("\n");

  return (
    <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
      <text fg="cyan">ssh-tunnel — one-click tunnel manager{busy ? " (working…)" : ""}</text>
      {snapshot.error !== null ? <text fg="red">{snapshot.error}</text> : null}
      <box style={{ border: true, flexDirection: "column", height: 16, padding: 1 }}>
        {snapshot.profiles.map((profile, index) => {
          const status = statesById.get(profile.id)?.status ?? "stopped";
          return (
            <text key={profile.id} fg={index === selected ? "black" : statusColor(status)} bg={index === selected ? "cyan" : undefined}>
              {index === selected ? "▸ " : "  "}{statusDot(status)} {profile.name} [{profile.mode}] → {profile.sshTarget}
            </text>
          );
        })}
        {snapshot.profiles.length === 0 ? <text fg="#999">(empty)</text> : null}
      </box>
      <box title="detail" style={{ border: true, padding: 1, height: 10 }}>
        <text>{detail}</text>
      </box>
      <text fg="#999">{notice}</text>
    </box>
  );
}

async function main(): Promise<void> {
  const direct = process.argv.slice(2).includes("--direct");
  const base = join(homeDir(), ".ssh-tunnel-ui");
  const manager = direct
    ? new TunnelManager({
        process: createNodeProcessPort(),
        probe: createNodeProbePort(),
        store: createFileStorePort(join(base, "profiles.json")),
        clock: systemClock,
        logDir: join(base, "logs"),
      })
    : null;
  const client = direct ? null : createTunnelClient({ baseUrl: daemonBase(), fetch });
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<App client={client} manager={manager} />);
}

await main();
