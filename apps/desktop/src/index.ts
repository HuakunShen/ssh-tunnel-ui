/**
 * `@ssh-tunnel/desktop` — Tauri shell stub (thin front).
 *
 * Production shape: `tauri init` with `frontendDist: ../web/dist` and
 * `devUrl: http://127.0.0.1:7432`; the Rust side spawns `ssh-tunnel-serve`
 * as a sidecar and opens the same Web UI. Until then, this module documents
 * the wiring and offers the discovery helper every shell reuses.
 */
import { createTunnelClient } from "@ssh-tunnel/client";

export interface DesktopShellOptions {
  readonly daemonUrl?: string;
  readonly fetch: typeof fetch;
}

/** Resolve the daemon URL: explicit flag wins, else discovery file, else default. */
export function resolveDaemonUrl(explicit?: string): string {
  if (explicit !== undefined && explicit !== "") return explicit.replace(/\/$/, "");
  return "http://127.0.0.1:7432";
}

export function createDesktopClient(options: DesktopShellOptions): ReturnType<typeof createTunnelClient> {
  return createTunnelClient({
    baseUrl: resolveDaemonUrl(options.daemonUrl),
    fetch: options.fetch,
  });
}

export const TAURI_WIRING_NOTES = [
  "tauri.conf.json: frontendDist ../web/dist, devUrl http://127.0.0.1:7432",
  "sidecar: ssh-tunnel-serve --port=7432 --web-dir=../web/dist (bundled binary)",
  "no domain logic in Rust: all tunnel rules stay in @ssh-tunnel/core + service",
] as const;
