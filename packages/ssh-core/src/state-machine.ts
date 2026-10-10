/**
 * Tunnel lifecycle state machine. Allowed transitions are data, not lore:
 * every layer (service, CLI, TUI, Web) consults `canTransition` instead of
 * re-implementing the rules, so an illegal transition fails the same way
 * everywhere.
 */
import type { TunnelStatus } from "@ssh-tunnel/contract";

const TRANSITIONS: Record<TunnelStatus, readonly TunnelStatus[]> = {
  stopped: ["starting"],
  starting: ["running", "failed", "stopping"],
  running: ["stopping", "degraded", "failed"],
  degraded: ["running", "stopping", "failed"],
  failed: ["starting", "stopped"],
  stopping: ["stopped", "failed"],
};

export function canTransition(
  from: TunnelStatus,
  to: TunnelStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** All statuses reachable with one `start` request from here. */
export function startTarget(from: TunnelStatus): TunnelStatus | null {
  if (from === "stopped" || from === "failed") return "starting";
  return null;
}

/** All statuses reachable with one `stop` request from here. */
export function stopTarget(from: TunnelStatus): TunnelStatus | null {
  if (from === "starting" || from === "running" || from === "degraded") {
    return "stopping";
  }
  return null;
}

/** Terminal-ish states where a fresh start is legal. */
export function isStartable(status: TunnelStatus): boolean {
  return startTarget(status) !== null;
}

/** Live states where a stop is legal. */
export function isStoppable(status: TunnelStatus): boolean {
  return stopTarget(status) !== null;
}
