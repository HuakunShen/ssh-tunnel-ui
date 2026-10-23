/**
 * Host ports — the seam where portable core meets the OS. Core plans what to
 * do; only the trusted Node host implements these. Every method is small,
 * synchronous-shaped (async where I/O), and mockable for tests.
 */
import type { TunnelProfile } from "@ssh-tunnel/contract";

export interface SpawnedProcess {
  readonly pid: number;
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
  kill(signal?: string): void;
}

export interface ProcessPort {
  /** Spawn `ssh` detached; resolves once the child exists (not when ready). */
  spawn(argv: readonly string[], options: { readonly logFile: string }): SpawnedProcess;
  /** True while pid is alive. */
  isAlive(pid: number): boolean;
  /** Best-effort tree kill. */
  killTree(pid: number): void;
}

export interface ProbePort {
  /** TCP dial with timeout; resolves ok/latency, never throws for refuse. */
  dialTcp(host: string, port: number, timeoutMs: number): Promise<{ readonly ok: boolean; readonly latencyMs?: number; readonly detail?: string }>;
}

export interface StorePort {
  readProfiles(): Promise<readonly TunnelProfile[]>;
  writeProfiles(profiles: readonly TunnelProfile[]): Promise<void>;
}

export interface ClockPort {
  nowIso(): string;
}

/** A terminal the daemon can start a tunnel command in. */
export interface TerminalTargetInfo {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly platform: string;
}

/**
 * Terminal launching. The daemon spawns the terminal itself, so the resulting
 * pid stays ours to end; health is still measured by probing ports, which is
 * why this is optional rather than required for the daemon to work.
 */
export interface TerminalPort {
  /** Terminals actually installed on this machine. */
  detect(): readonly TerminalTargetInfo[];
  /**
   * Launch `commandLine` inside `terminalId`; resolves to the spawned pid.
   *
   * Rejects when the launcher itself failed — a missing binary, or a terminal
   * that refused the call (iTerm2 denying Apple events, for instance). The
   * promise deliberately waits a short settle window, because a launcher that
   * dies instantly is the only observable failure: after that the tunnel lives
   * in the terminal's own process tree, not ours.
   */
  launch(terminalId: string, commandLine: string): Promise<number>;
  /** End a previously launched terminal session. */
  close(pid: number): void;
}

/**
 * OpenSSH control-socket operations, for tunnels this daemon does not own.
 *
 * A tunnel opened in the user's own terminal cannot be signalled by pid; the
 * control socket is the only honest handle on it. Both calls answer `false`
 * rather than throwing, because "the socket is gone" is an ordinary state.
 */
export interface ControlPort {
  /** True while the master behind `socketPath` is running. */
  check(socketPath: string, destination: string): Promise<boolean>;
  /** Ask the master to exit; true when OpenSSH accepted the request. */
  exit(socketPath: string, destination: string): Promise<boolean>;
}

/**
 * Opening a URL in the user's own default handler.
 *
 * A webview cannot do this with a plain anchor: clicking one navigates the
 * application frame instead of handing the address to the browser. The daemon
 * owns the OS call, so every host (browser, Tauri, VS Code) behaves the same.
 */
export interface OpenUrlPort {
  /** Hand `url` to the system default handler. Throws when the OS refuses. */
  open(url: string): void;
}

export const systemClock: ClockPort = {
  nowIso(): string {
    return new Date().toISOString();
  },
};
