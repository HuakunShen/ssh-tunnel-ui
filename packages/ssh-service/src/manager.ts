/**
 * Tunnel manager — the composition root's stateful core. Owns profiles
 * (persisted via `StorePort`), live `ssh` children (via `ProcessPort`), and
 * per-tunnel runtime states. All transitions go through the core state
 * machine so every front observes identical rules.
 */
import {
  TunnelError,
  tunnelProfileSchema,
  type ForwardHealth,
  type TunnelProfile,
  type TunnelProfileInput,
  type TunnelState,
  type TunnelStatus,
} from "@ssh-tunnel/contract";
import {
  buildSshArgv,
  canTransition,
  isStoppable,
  startTarget,
  stopTarget,
  validateProfileInput,
} from "@ssh-tunnel/core";
import type {
  ClockPort,
  ExternalSession,
  ProbePort,
  ProcessPort,
  SpawnedProcess,
  StorePort,
  TerminalPort,
  TerminalTargetInfo,
} from "@ssh-tunnel/host-node";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ManagerOptions {
  readonly process: ProcessPort;
  readonly probe: ProbePort;
  readonly store: StorePort;
  readonly clock: ClockPort;
  readonly logDir: string;
  readonly sshPath?: string;
  /** Max profiles kept. Default 200. */
  readonly maxProfiles?: number;
  /** Optional: without it the daemon only exposes "copy the command". */
  readonly terminal?: TerminalPort;
}

interface LiveTunnel {
  readonly child: SpawnedProcess;
  readonly argv: readonly string[];
  startedAt: string;
  lastError?: string;
}

function newId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function healthForProbe(
  profile: TunnelProfile,
  results: Map<number, { ok: boolean; latencyMs?: number; detail?: string }>,
  remoteNote: string,
): ForwardHealth[] {
  return profile.forwards.map((rule) => {
    if (rule.kind === "remote") {
      return { kind: rule.kind, bindPort: rule.bindPort, ok: true, detail: remoteNote };
    }
    const result = results.get(rule.bindPort);
    if (result === undefined) {
      return {
        kind: rule.kind,
        bindPort: rule.bindPort,
        ok: false,
        detail: "not probed yet",
      };
    }
    return {
      kind: rule.kind,
      bindPort: rule.bindPort,
      ok: result.ok,
      ...(result.latencyMs === undefined ? {} : { latencyMs: result.latencyMs }),
      ...(result.detail === undefined ? {} : { detail: result.detail }),
    };
  });
}

export class TunnelManager {
  private readonly process: ProcessPort;
  private readonly prober: ProbePort;
  private readonly store: StorePort;
  private readonly clock: ClockPort;
  private readonly logDir: string;
  private readonly maxProfiles: number;
  private readonly terminal: TerminalPort | undefined;
  private readonly sessions = new Map<string, ExternalSession>();
  private profiles = new Map<string, TunnelProfile>();
  private states = new Map<string, TunnelState>();
  private live = new Map<string, LiveTunnel>();
  private loaded = false;

  constructor(options: ManagerOptions) {
    this.process = options.process;
    this.prober = options.probe;
    this.store = options.store;
    this.clock = options.clock;
    this.logDir = options.logDir;
    this.maxProfiles = options.maxProfiles ?? 200;
    this.terminal = options.terminal;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const profiles = await this.store.readProfiles();
    for (const profile of profiles) {
      this.profiles.set(profile.id, profile);
      this.states.set(profile.id, {
        profileId: profile.id,
        status: "stopped",
        forwards: [],
      });
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.store.writeProfiles([...this.profiles.values()]);
  }

  private setStatus(id: string, to: TunnelStatus, patch?: Partial<TunnelState>): void {
    const current = this.states.get(id);
    if (current === undefined) return;
    if (!canTransition(current.status, to)) {
      throw new TunnelError(
        "Conflict",
        `cannot move tunnel ${id} from ${current.status} to ${to}`,
        { details: { profileId: id, from: current.status, to } },
      );
    }
    this.states.set(id, { ...current, status: to, ...(patch ?? {}) });
  }

  // -- profiles -------------------------------------------------------------

  async listProfiles(): Promise<readonly TunnelProfile[]> {
    await this.ensureLoaded();
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getProfile(id: string): Promise<TunnelProfile> {
    await this.ensureLoaded();
    const profile = this.profiles.get(id);
    if (profile === undefined) {
      throw new TunnelError("NotFound", `no profile ${id}`, {
        details: { profileId: id },
      });
    }
    return profile;
  }

  async createProfile(input: TunnelProfileInput): Promise<TunnelProfile> {
    await this.ensureLoaded();
    if (this.profiles.size >= this.maxProfiles) {
      throw new TunnelError(
        "LimitExceeded",
        `at most ${this.maxProfiles} profiles`,
      );
    }
    const parsed = tunnelProfileSchema
      .omit({ id: true, createdAt: true, updatedAt: true })
      .safeParse(input);
    if (!parsed.success) {
      throw new TunnelError("InvalidRequest", "profile input is malformed", {
        details: { issues: parsed.error.issues.length },
      });
    }
    const findings = validateProfileInput(parsed.data);
    const blocking = findings.filter((finding) => finding.severity === "error");
    if (blocking.length > 0) {
      throw new TunnelError("InvalidRequest", blocking[0]?.message ?? "invalid profile", {
        details: { path: blocking[0]?.path ?? "", errors: blocking.length },
      });
    }
    const now = this.clock.nowIso();
    const profile: TunnelProfile = {
      ...parsed.data,
      id: newId(),
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.set(profile.id, profile);
    this.states.set(profile.id, { profileId: profile.id, status: "stopped", forwards: [] });
    await this.persist();
    return profile;
  }

  async updateProfile(id: string, input: TunnelProfileInput): Promise<TunnelProfile> {
    await this.ensureLoaded();
    const existing = await this.getProfile(id);
    const state = this.states.get(id);
    if (state !== undefined && (isStoppable(state.status) || state.status === "starting")) {
      throw new TunnelError("Conflict", `stop tunnel ${id} before editing it`, {
        details: { profileId: id, status: state.status },
      });
    }
    const findings = validateProfileInput(input);
    const blocking = findings.filter((finding) => finding.severity === "error");
    if (blocking.length > 0) {
      throw new TunnelError("InvalidRequest", blocking[0]?.message ?? "invalid profile", {
        details: { path: blocking[0]?.path ?? "" },
      });
    }
    const updated: TunnelProfile = {
      ...input,
      id,
      createdAt: existing.createdAt,
      updatedAt: this.clock.nowIso(),
    };
    this.profiles.set(id, updated);
    await this.persist();
    return updated;
  }

  async deleteProfile(id: string): Promise<void> {
    await this.ensureLoaded();
    await this.getProfile(id);
    const state = this.states.get(id);
    if (state !== undefined && state.status !== "stopped" && state.status !== "failed") {
      throw new TunnelError("Conflict", `stop tunnel ${id} before deleting it`, {
        details: { profileId: id, status: state.status },
      });
    }
    this.closeSession(id);
    this.profiles.delete(id);
    this.states.delete(id);
    await this.persist();
  }

  // -- runtime ---------------------------------------------------------------

  async listStates(): Promise<readonly TunnelState[]> {
    await this.ensureLoaded();
    return [...this.states.values()];
  }

  async getState(id: string): Promise<TunnelState> {
    await this.ensureLoaded();
    const state = this.states.get(id);
    if (state === undefined) {
      throw new TunnelError("NotFound", `no tunnel ${id}`, {
        details: { profileId: id },
      });
    }
    return this.refreshState(id, state);
  }

  private refreshState(id: string, state: TunnelState): TunnelState {
    const live = this.live.get(id);
    if (
      (state.status === "running" || state.status === "degraded") &&
      (live === undefined || !this.process.isAlive(live.child.pid))
    ) {
      const failed: TunnelState = {
        ...state,
        status: "failed",
        lastError: "ssh process exited unexpectedly; see log for stderr tail",
      };
      this.states.set(id, failed);
      this.live.delete(id);
      return failed;
    }
    return state;
  }

  async start(id: string): Promise<TunnelState> {
    await this.ensureLoaded();
    const profile = await this.getProfile(id);
    const current = this.states.get(id);
    if (current === undefined) {
      throw new TunnelError("NotFound", `no tunnel ${id}`, {
        details: { profileId: id },
      });
    }
    const refreshed = this.refreshState(id, current);
    const target = startTarget(refreshed.status);
    if (target === null) {
      throw new TunnelError(
        "Conflict",
        `tunnel ${id} is ${refreshed.status}; stop it before starting`,
        { details: { profileId: id, status: refreshed.status } },
      );
    }
    this.setStatus(id, "starting", { lastError: undefined });

    const { argv } = buildSshArgv(profile);
    try {
      mkdirSync(this.logDir, { recursive: true });
    } catch {
      // Probing continues; spawn will surface real failures.
    }
    const logFile = join(this.logDir, `${id}.log`);
    let child: SpawnedProcess;
    try {
      child = this.process.spawn(argv, { logFile });
    } catch (error) {
      this.setStatus(id, "failed", {
        lastError: error instanceof Error ? error.message : "spawn failed",
      });
      const failed = this.states.get(id);
      if (failed === undefined) {
        throw new TunnelError("InternalError", "state lost during start");
      }
      return failed;
    }
    if (child.pid <= 0) {
      this.setStatus(id, "failed", { lastError: "ssh executable not found" });
      const failed = this.states.get(id);
      if (failed === undefined) {
        throw new TunnelError("InternalError", "state lost during start");
      }
      return failed;
    }

    const startedAt = this.clock.nowIso();
    this.live.set(id, { child, argv, startedAt });
    void child.exited.then(({ code }) => {
      const state = this.states.get(id);
      if (state === undefined) return;
      // A stop we initiated already moved the state; only surprise exits fail it.
      if (state.status === "starting" || state.status === "running" || state.status === "degraded") {
        this.live.delete(id);
        try {
          this.setStatus(id, "failed", {
            lastError: `ssh exited with code ${code ?? "unknown"}; see ${logFile}`,
          });
        } catch {
          // Transition raced a stop; stop wins.
        }
      } else {
        this.live.delete(id);
      }
    });

    // Grace window: ExitOnForwardFailure kills ssh fast on bad forwards, so a
    // quick early exit means immediate failure instead of phantom "running".
    // Jump chains need longer: each hop adds a full ssh handshake + agent auth.
    const hopCount = profile.jumpHops?.length ?? 0;
    const graceMs = 900 + hopCount * 4000;
    await new Promise((resolve) => setTimeout(resolve, graceMs));
    const after = this.states.get(id);
    if (after === undefined) {
      throw new TunnelError("InternalError", "state lost during start");
    }
    const live = this.live.get(id);
    if (live === undefined || !this.process.isAlive(live.child.pid)) {
      this.live.delete(id);
      if (after.status === "starting") {
        this.setStatus(id, "failed", {
          lastError: `ssh exited during startup; see ${logFile}`,
        });
      }
      const failed = this.states.get(id);
      if (failed === undefined) {
        throw new TunnelError("InternalError", "state lost during start");
      }
      return failed;
    }
    this.setStatus(id, "running", {
      pid: live.child.pid,
      startedAt,
      argv: [...live.argv],
    });
    const running = this.states.get(id);
    if (running === undefined) {
      throw new TunnelError("InternalError", "state lost during start");
    }
    // Best-effort first probe; failures mark degraded, never block start.
    void this.probeTunnel(id).catch(() => undefined);
    return (this.states.get(id) ?? running);
  }

  async stop(id: string): Promise<TunnelState> {
    await this.ensureLoaded();
    const current = this.states.get(id);
    if (current === undefined) {
      throw new TunnelError("NotFound", `no tunnel ${id}`, {
        details: { profileId: id },
      });
    }
    const refreshed = this.refreshState(id, current);
    const target = stopTarget(refreshed.status);
    if (target === null) {
      if (refreshed.status === "stopped" || refreshed.status === "failed") {
        return refreshed;
      }
      throw new TunnelError(
        "Conflict",
        `tunnel ${id} is ${refreshed.status}; nothing to stop`,
        { details: { profileId: id, status: refreshed.status } },
      );
    }
    this.setStatus(id, "stopping");
    const live = this.live.get(id);
    if (live !== undefined) {
      this.process.killTree(live.child.pid);
      // Grace window, then escalate.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (this.process.isAlive(live.child.pid)) {
        live.child.kill("SIGKILL");
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      this.live.delete(id);
    }
    this.setStatus(id, "stopped", { pid: undefined, startedAt: undefined });
    const stopped = this.states.get(id);
    if (stopped === undefined) {
      throw new TunnelError("InternalError", "state lost during stop");
    }
    return stopped;
  }

  async stopAll(): Promise<readonly TunnelState[]> {
    await this.ensureLoaded();
    const results: TunnelState[] = [];
    for (const id of [...this.states.keys()]) {
      try {
        results.push(await this.stop(id));
      } catch {
        // One stuck tunnel must not block the rest.
      }
    }
    return results;
  }

  async probe(id: string): Promise<TunnelState> {
    await this.ensureLoaded();
    return this.probeTunnel(id);
  }

  private async probeTunnel(id: string): Promise<TunnelState> {
    const profile = await this.getProfile(id);
    const current = this.states.get(id);
    if (current === undefined) {
      throw new TunnelError("NotFound", `no tunnel ${id}`, {
        details: { profileId: id },
      });
    }
    const refreshed = this.refreshState(id, current);
    if (refreshed.status !== "running" && refreshed.status !== "degraded") {
      return refreshed;
    }
    const results = new Map<number, { ok: boolean; latencyMs?: number; detail?: string }>();
    for (const rule of profile.forwards) {
      if (rule.kind === "remote") continue;
      const host =
        rule.bindAddress === undefined || rule.bindAddress === "" || rule.bindAddress === "*"
          ? "127.0.0.1"
          : rule.bindAddress === "0.0.0.0"
            ? "127.0.0.1"
            : rule.bindAddress;
      // Dynamic (SOCKS) ports accept TCP; a connect = alive. Retry: the
      // listener can lag process liveness, especially behind jump hops.
      let result = await this.prober.dialTcp(host, rule.bindPort, 2500);
      for (let attempt = 0; !result.ok && attempt < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        result = await this.prober.dialTcp(host, rule.bindPort, 2500);
      }
      results.set(rule.bindPort, result);
    }
    const forwards = healthForProbe(
      profile,
      results,
      "remote forwards listen on the server; verified via ssh exit status",
    );
    const anyLocal = forwards.some((forward) => forward.kind !== "remote");
    const allOk = forwards.every((forward) => forward.ok);
    const next: TunnelStatus = !anyLocal || allOk ? "running" : "degraded";
    if (next !== refreshed.status && canTransition(refreshed.status, next)) {
      this.states.set(id, { ...refreshed, status: next, forwards });
    } else {
      this.states.set(id, { ...refreshed, forwards });
    }
    const updated = this.states.get(id);
    if (updated === undefined) {
      throw new TunnelError("InternalError", "state lost during probe");
    }
    return updated;
  }

  preview(id: string): { readonly argv: readonly string[]; readonly command: string };
  preview(profile: TunnelProfile): { readonly argv: readonly string[]; readonly command: string };
  preview(
    idOrProfile: string | TunnelProfile,
  ): { readonly argv: readonly string[]; readonly command: string } {
    if (typeof idOrProfile === "string") {
      const profile = this.profiles.get(idOrProfile);
      if (profile === undefined) {
        throw new TunnelError("NotFound", `no profile ${idOrProfile}`, {
          details: { profileId: idOrProfile },
        });
      }
      return buildSshArgv(profile);
    }
    return buildSshArgv(idOrProfile);
  }

  // -- terminal sessions ----------------------------------------------------

  /** Terminals installed on this host; empty when the port is not wired. */
  listTerminals(): readonly TerminalTargetInfo[] {
    return this.terminal?.detect() ?? [];
  }

  /**
   * Hand the profile's exact ssh command to a real terminal window. We spawn
   * that window, so the pid is ours to close — but the tunnel's health stays
   * defined by port probes, so a user-closed window is reported as stopped,
   * never as a failure.
   */
  launchInTerminal(id: string, terminalId: string): ExternalSession {
    if (this.terminal === undefined) {
      throw new TunnelError(
        "UnsupportedOperation",
        "this daemon build cannot open terminals",
        { details: { profileId: id } },
      );
    }
    const profile = this.profiles.get(id);
    if (profile === undefined) {
      throw new TunnelError("NotFound", `no profile ${id}`, {
        details: { profileId: id },
      });
    }
    const known = this.terminal.detect().some((target) => target.id === terminalId);
    if (!known) {
      throw new TunnelError("NotFound", `terminal ${terminalId} is not installed`, {
        details: { profileId: id, terminalId },
      });
    }
    const commandLine = buildSshArgv(profile).command;
    let pid: number;
    try {
      pid = this.terminal.launch(terminalId, commandLine);
    } catch (e) {
      throw new TunnelError(
        "UnsupportedOperation",
        e instanceof Error ? e.message : "terminal launch failed",
        { details: { profileId: id, terminalId } },
      );
    }
    if (pid <= 0) {
      throw new TunnelError(
        "SshFailed",
        "terminal launcher exited immediately",
        { details: { profileId: id, terminalId } },
      );
    }
    const session: ExternalSession = {
      profileId: id,
      terminalId,
      command: commandLine,
      pid,
      launchedAt: this.clock.nowIso(),
    };
    // One window per profile: relaunching replaces the tracked session.
    const previous = this.sessions.get(id);
    if (previous !== undefined) this.terminal.close(previous.pid);
    this.sessions.set(id, session);
    return session;
  }

  /** Sessions this daemon launched, newest launch per profile. */
  listSessions(): readonly ExternalSession[] {
    return [...this.sessions.values()];
  }

  /** End a launched terminal session. Returns false when none was tracked. */
  closeSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session === undefined) return false;
    this.terminal?.close(session.pid);
    this.sessions.delete(id);
    return true;
  }
}
