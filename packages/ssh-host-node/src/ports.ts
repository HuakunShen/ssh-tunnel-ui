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

export const systemClock: ClockPort = {
  nowIso(): string {
    return new Date().toISOString();
  },
};
