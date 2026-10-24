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
  type LaunchMode,
  type LogTail,
  type TunnelProfile,
  type TunnelProfileInput,
  type TunnelState,
  type TunnelStatus,
} from "@ssh-tunnel/contract";
import {
  buildSshArgv,
  canTransition,
  isStoppable,
  sshDestination,
  startTarget,
  stopTarget,
  validateProfileInput,
} from "@ssh-tunnel/core";
import { isOpenableUrl } from "@ssh-tunnel/host-node";
import type {
  ClockPort,
  ControlPort,
  ExternalSession,
  OpenUrlPort,
  ProbePort,
  RuntimeRecord,
  RuntimeStorePort,
  ProcessPort,
  SpawnedProcess,
  StorePort,
  TerminalPort,
  TerminalTargetInfo,
} from "@ssh-tunnel/host-node";
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
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
  /** Optional: without it, "open in browser" is refused rather than faked. */
  readonly openUrl?: OpenUrlPort;
  /** Optional: without it, a terminal-opened tunnel cannot be checked or ended. */
  readonly control?: ControlPort;
  /** Where per-profile ControlMaster sockets live. Default `~/.ssh-tunnel-ui/control`. */
  readonly controlDir?: string;
  /** Optional: records which tunnels were up, so a restart can adopt them. */
  readonly runtime?: RuntimeStorePort;
}

/**
 * How long a freshly handed-off window gets before its control socket must
 * answer. ssh needs a moment to authenticate and bind the master; checking
 * immediately would call a healthy session dead and, worse, forget it.
 */
const TERMINAL_START_GRACE_MS = 12_000;

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
  private readonly openUrlPort: OpenUrlPort | undefined;
  private readonly control: ControlPort | undefined;
  private readonly controlDir: string;
  private readonly runtime: RuntimeStorePort | undefined;
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
    this.openUrlPort = options.openUrl;
    this.control = options.control;
    this.controlDir = options.controlDir ?? join(homedir(), ".ssh-tunnel-ui", "control");
    this.runtime = options.runtime;
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
    await this.adoptRuntime();
  }

  /**
   * Re-claim the tunnels the previous daemon wrote down.
   *
   * A record is a claim, not proof: the ControlMaster socket has to answer
   * before it is trusted, because the ssh process may have died while the
   * daemon was away (a reboot kills it, a crash does not). Entries that fail
   * the check are dropped from the file on the way out.
   */
  private async adoptRuntime(): Promise<void> {
    if (this.runtime === undefined || this.control === undefined) return;
    const records = await this.runtime.read();
    if (records.length === 0) return;
    const keep: RuntimeRecord[] = [];
    for (const record of records) {
      const profile = this.profiles.get(record.profileId);
      if (profile === undefined) continue;
      if (!(await this.socketAlive(record.profileId, profile))) continue;
      keep.push(record);
      this.states.set(record.profileId, {
        profileId: record.profileId,
        status: "running",
        origin: record.origin,
        ...(record.pid === undefined ? {} : { pid: record.pid }),
        startedAt: record.startedAt,
        forwards: [],
      });
      if (record.origin === "terminal") {
        this.sessions.set(record.profileId, {
          profileId: record.profileId,
          terminalId: record.terminalId ?? "terminal",
          mode: record.mode ?? "tunnel",
          command: buildSshArgv(profile, {
            controlPath: this.controlPathFor(record.profileId),
            interactive: record.mode === "shell",
          }).command,
          pid: record.pid ?? 0,
          launchedAt: record.startedAt,
        });
      }
    }
    if (keep.length !== records.length) await this.runtime.write(keep);
  }

  /** Write down what is up now; a failed write must never fail the operation. */
  private async persistRuntime(): Promise<void> {
    if (this.runtime === undefined) return;
    const records: RuntimeRecord[] = [];
    for (const [id, state] of this.states) {
      if (state.origin !== "managed" && state.origin !== "terminal") continue;
      if (state.status !== "running" && state.status !== "degraded" && state.status !== "starting") {
        continue;
      }
      const session = this.sessions.get(id);
      records.push({
        profileId: id,
        origin: state.origin,
        startedAt: state.startedAt ?? this.clock.nowIso(),
        ...(state.pid === undefined ? {} : { pid: state.pid }),
        ...(session === undefined
          ? {}
          : { mode: session.mode, terminalId: session.terminalId }),
      });
    }
    await this.runtime.write(records);
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
    await this.persistRuntime();
  }

  // -- runtime ---------------------------------------------------------------

  async listStates(): Promise<readonly TunnelState[]> {
    await this.ensureLoaded();
    await this.refreshUnmanaged();
    return [...this.states.values()];
  }

  async getState(id: string): Promise<TunnelState> {
    await this.ensureLoaded();
    // Same refresh the list route does, so one row and the whole table cannot
    // disagree about who owns a tunnel.
    await this.refreshUnmanaged();
    const state = this.states.get(id);
    if (state === undefined) {
      throw new TunnelError("NotFound", `no tunnel ${id}`, {
        details: { profileId: id },
      });
    }
    return this.refreshState(id, state);
  }

  private refreshState(id: string, state: TunnelState): TunnelState {
    // Terminal-opened and externally-detected tunnels have no child of ours to
    // check: their truth comes from the control socket and the port probe.
    if (this.sessions.has(id) || state.origin === "terminal" || state.origin === "external") {
      return state;
    }
    // A managed tunnel adopted from the runtime file has no child handle; the
    // ControlMaster socket decides whether it is still alive.
    if (state.origin === "managed" && !this.live.has(id)) {
      return state;
    }
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


  private controlPathFor(id: string): string {
    return join(this.controlDir, `${id}.sock`);
  }

  /**
   * Is a master behind this profile's control socket answering?
   *
   * The file is checked first: with no socket there is nothing to ask, and a
   * status poll must not spawn `ssh` per profile every few seconds. A socket
   * left behind by a killed master answers "not running" and is ignored.
   */
  private async socketAlive(id: string, profile: TunnelProfile): Promise<boolean> {
    if (this.control === undefined) return false;
    const socketPath = this.controlPathFor(id);
    if (!existsSync(socketPath)) return false;
    return this.control.check(socketPath, sshDestination(profile));
  }

  /** Does any local bind port of this profile answer right now? */
  private async bindPortAnswers(profile: TunnelProfile): Promise<boolean> {
    for (const rule of profile.forwards) {
      if (rule.kind === "remote") continue;
      const host =
        rule.bindAddress === undefined ||
        rule.bindAddress === "" ||
        rule.bindAddress === "*" ||
        rule.bindAddress === "0.0.0.0"
          ? "127.0.0.1"
          : rule.bindAddress;
      const result = await this.prober.dialTcp(host, rule.bindPort, 400);
      if (result.ok) return true;
    }
    return false;
  }

  /**
   * Bring terminal-opened and foreign tunnels up to date.
   *
   * The daemon owns neither, so nothing here trusts memory: a terminal session
   * is real only while its ControlMaster answers `ssh -O check`, and a tunnel
   * started outside this app is reported as `external` from the port it holds —
   * never as something this daemon may stop.
   */
  private async refreshUnmanaged(): Promise<void> {
    for (const [id, state] of [...this.states.entries()]) {
      const profile = this.profiles.get(id);
      if (profile === undefined) continue;
      const session = this.sessions.get(id);
      if (session !== undefined) {
        const alive =
          this.control !== undefined &&
          (await this.control.check(this.controlPathFor(id), sshDestination(profile)));
        if (alive) {
          this.states.set(id, {
            ...state,
            status: "running",
            origin: "terminal",
            lastError: undefined,
          });
          continue;
        }
        const ageMs = Date.parse(this.clock.nowIso()) - Date.parse(session.launchedAt);
        if (ageMs < TERMINAL_START_GRACE_MS) {
          // Still connecting (a jump hop can take seconds): keep claiming it.
          this.states.set(id, { ...state, status: "starting", origin: "terminal" });
          continue;
        }
        this.sessions.delete(id);
        const stillListening = await this.bindPortAnswers(profile);
        await this.persistRuntime();
        this.states.set(
          id,
          stillListening
            ? {
                ...state,
                status: "running",
                origin: "external",
                lastError: "the terminal session ended; a listener still holds this port",
              }
            : {
                ...state,
                status: "stopped",
                origin: "terminal",
                pid: undefined,
                startedAt: undefined,
                forwards: [],
              },
        );
        continue;
      }
      // A managed child of ours is authoritative while it lives.
      const live = this.live.get(id);
      if (live !== undefined && this.process.isAlive(live.child.pid)) continue;
      // Adopted after a restart: the socket is the only witness left.
      if (state.origin === "managed") {
        if (await this.socketAlive(id, profile)) continue;
        this.states.set(id, {
          ...state,
          status: "stopped",
          pid: undefined,
          startedAt: undefined,
          forwards: [],
          lastError: "the tunnel exited while the daemon was not running",
        });
        await this.persistRuntime();
        continue;
      }
      // A master this daemon did not record but can still reach: a window from
      // before a restart, or one the user started with the same socket.
      if (await this.socketAlive(id, profile)) {
        this.states.set(id, { ...state, status: "running", origin: "terminal", lastError: undefined });
        continue;
      }
      if (state.origin === "external") {
        if (await this.bindPortAnswers(profile)) continue;
        this.states.set(id, {
          ...state,
          status: "stopped",
          pid: undefined,
          startedAt: undefined,
          forwards: [],
        });
        continue;
      }
      if (state.status !== "stopped") continue;
      if (await this.bindPortAnswers(profile)) {
        this.states.set(id, {
          profileId: id,
          status: "running",
          origin: "external",
          forwards: [],
          lastError: "started outside this daemon; state comes from the bind port",
        });
      }
    }
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

    // The same ControlMaster socket the terminal handoff uses: it is how a
    // later daemon (after a restart) recognises this tunnel as its own.
    try {
      mkdirSync(this.controlDir, { recursive: true, mode: 0o700 });
    } catch {
      // A missing directory shows up as an ssh failure with its own message.
    }
    const { argv } = buildSshArgv(profile, { controlPath: this.controlPathFor(id) });
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
      origin: "managed",
      pid: live.child.pid,
      startedAt,
      argv: [...live.argv],
    });
    const running = this.states.get(id);
    if (running === undefined) {
      throw new TunnelError("InternalError", "state lost during start");
    }
    await this.persistRuntime();
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
    const session = this.sessions.get(id);
    const profile = await this.getProfile(id);
    const socketOwned = this.live.get(id) === undefined && (await this.socketAlive(id, profile));
    if (
      session === undefined &&
      !socketOwned &&
      this.live.get(id) === undefined &&
      refreshed.origin === "external"
    ) {
      throw new TunnelError(
        "Conflict",
        "this tunnel was started outside the daemon; stop it where it was started",
        { details: { profileId: id } },
      );
    }
    this.setStatus(id, "stopping");
    if (session !== undefined || socketOwned) {
      // A window we did not spawn: ask OpenSSH to close its master, which ends
      // the session that owns the forwards.
      if (this.control !== undefined) {
        await this.control.exit(this.controlPathFor(id), sshDestination(profile));
      }
      this.sessions.delete(id);
    }
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
    await this.persistRuntime();
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

  /**
   * The tail of this tunnel's log file, already split into lines.
   *
   * Reading from the end rather than the whole file keeps a daemon that has
   * been running for weeks from dragging megabytes into a dialog: at most
   * 128 KiB is read, and only the last `tail` lines survive. A missing file is
   * not an error — a tunnel that never started has no log yet.
   */
  async logTail(id: string, tail = 200): Promise<LogTail> {
    await this.ensureLoaded();
    if (!this.profiles.has(id)) {
      throw new TunnelError("NotFound", `no profile ${id}`, { details: { profileId: id } });
    }
    const path = join(this.logDir, `${id}.log`);
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      return { profileId: id, path, lines: [], truncated: false, bytes: 0 };
    }
    if (size === 0) return { profileId: id, path, lines: [], truncated: false, bytes: 0 };
    const window = 128 * 1024;
    const start = Math.max(0, size - window);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    let read = 0;
    try {
      const fd = openSync(path, "r");
      try {
        read = readSync(fd, buffer, 0, length, start);
      } finally {
        closeSync(fd);
      }
    } catch {
      return { profileId: id, path, lines: [], truncated: false, bytes: size };
    }
    let text = buffer.toString("utf8", 0, read);
    // A windowed read almost always starts mid-line; drop that fragment.
    if (start > 0) {
      const firstBreak = text.indexOf("\n");
      text = firstBreak === -1 ? "" : text.slice(firstBreak + 1);
    }
    const all = text.split("\n");
    if (all.length > 0 && all[all.length - 1] === "") all.pop();
    const lines = all.slice(Math.max(0, all.length - tail));
    return {
      profileId: id,
      path,
      lines,
      truncated: start > 0 || all.length > lines.length,
      bytes: size,
    };
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
   *
   * A launcher that refuses the call (iTerm2 denying automation, a terminal
   * bundle that moved) surfaces as `TerminalFailed` with the launcher's own
   * stderr, rather than a success toast naming a pid nobody can see.
   *
   * The command carries a per-profile ControlMaster socket, so the session this
   * window owns stays checkable (`ssh -O check`) and stoppable (`ssh -O exit`)
   * even though the daemon never holds its pid. `shell` drops `-N`: the window
   * is then a real interactive session, and the forwards live and die with it.
   */
  async launchInTerminal(
    id: string,
    terminalId: string,
    mode: LaunchMode = "tunnel",
  ): Promise<ExternalSession> {
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
    try {
      mkdirSync(this.controlDir, { recursive: true, mode: 0o700 });
    } catch {
      // A missing directory surfaces as a failed ssh below, with its own words.
    }
    const commandLine = buildSshArgv(profile, {
      controlPath: this.controlPathFor(id),
      interactive: mode === "shell",
    }).command;
    let pid: number;
    try {
      pid = await this.terminal.launch(terminalId, commandLine);
    } catch (e) {
      throw new TunnelError(
        "TerminalFailed",
        e instanceof Error ? e.message : "terminal launch failed",
        { details: { profileId: id, terminalId } },
      );
    }
    if (pid <= 0) {
      throw new TunnelError(
        "TerminalFailed",
        "the terminal launcher reported no process",
        { details: { profileId: id, terminalId } },
      );
    }
    const session: ExternalSession = {
      profileId: id,
      terminalId,
      mode,
      command: commandLine,
      pid,
      launchedAt: this.clock.nowIso(),
    };
    // One window per profile: relaunching replaces the tracked session.
    const previous = this.sessions.get(id);
    if (previous !== undefined) this.terminal.close(previous.pid);
    this.sessions.set(id, session);
    // Claim the row now; the next poll confirms it through the socket and moves
    // it to running (or stopped, when the window died on a bad port).
    const state = this.states.get(id);
    if (state !== undefined) {
      this.states.set(id, {
        ...state,
        status: "starting",
        origin: "terminal",
        pid: undefined,
        startedAt: session.launchedAt,
        forwards: [],
        lastError: undefined,
      });
    }
    await this.persistRuntime();
    return session;
  }

  /** Sessions this daemon launched, newest launch per profile. */
  listSessions(): readonly ExternalSession[] {
    return [...this.sessions.values()];
  }

  // -- opening URLs ---------------------------------------------------------

  /**
   * Hand a URL to the operating system's default handler.
   *
   * The daemon does this rather than the page: inside a webview a plain anchor
   * would navigate the console away instead of opening a browser. Anything
   * that is not http(s) is refused here, so this stays a safe seam even though
   * the caller builds the address.
   */
  openUrl(url: string): { readonly url: string; readonly openedAt: string } {
    if (this.openUrlPort === undefined) {
      throw new TunnelError(
        "UnsupportedOperation",
        "this daemon build cannot open external urls",
        { details: { url } },
      );
    }
    if (!isOpenableUrl(url)) {
      throw new TunnelError("InvalidRequest", "only http and https urls can be opened", {
        details: { url },
      });
    }
    this.openUrlPort.open(url);
    return { url, openedAt: this.clock.nowIso() };
  }

  /** End a launched terminal session. Returns false when none was tracked. */
  closeSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session === undefined) return false;
    this.terminal?.close(session.pid);
    const profile = this.profiles.get(id);
    if (this.control !== undefined && profile !== undefined) {
      void this.control.exit(this.controlPathFor(id), sshDestination(profile));
    }
    this.sessions.delete(id);
    void this.persistRuntime();
    return true;
  }
}
