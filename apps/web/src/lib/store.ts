/**
 * Web data layer: typed daemon client + Svelte 5 reactive stores.
 *
 * Every component reads `profiles`, `states`, `hosts` from here; mutations go
 * through the shared `@ssh-tunnel/client` so the Web UI can never drift from
 * the contract. Polling is centralized (one interval) to avoid N components
 * hammering `/api/states`.
 */
import { createTunnelClient, type TunnelClient } from "@ssh-tunnel/client";
import type {
  LaunchMode,
  SshHostInfo,
  TerminalTarget,
  TunnelProfile,
  TunnelProfileInput,
  TunnelState,
} from "@ssh-tunnel/contract";

export type {
  LaunchMode,
  TunnelProfile,
  TunnelProfileInput,
  TunnelState,
  SshHostInfo,
  TerminalTarget,
};

function baseUrl(): string {
  // Same-origin when served by the daemon; `?daemon=` override for dev
  // (`vite dev --port 5173` against a daemon on 7432).
  try {
    const override = new URLSearchParams(window.location.search).get("daemon");
    if (override !== null && override !== "") return override.replace(/\/$/, "");
    // Inside the Tauri shell the page runs on `tauri://localhost`, where a
    // relative `/api/*` would hit the asset protocol instead of the daemon.
    // Same for the VS Code webview (`vscode-webview://`). Default to the
    // loopback daemon the host spawns (or attaches to).
    if (window.location.protocol === "tauri:" || window.location.protocol === "vscode-webview:") {
      return "http://127.0.0.1:7432";
    }
  } catch {
    // Non-browser (prerender): fall through to relative.
  }
  return "";
}

let client: TunnelClient | null = null;

export function getClient(): TunnelClient {
  if (client === null) {
    client = createTunnelClient({ baseUrl: baseUrl(), fetch });
  }
  return client;
}

export interface TunnelStore {
  profiles: TunnelProfile[];
  states: TunnelState[];
  hosts: SshHostInfo[];
  terminals: TerminalTarget[];
  connected: boolean;
  lastError: string | null;
  loading: boolean;
}

export const initialStore: TunnelStore = {
  profiles: [],
  states: [],
  hosts: [],
  terminals: [],
  connected: false,
  lastError: null,
  loading: true,
};

export function stateOf(store: TunnelStore, profileId: string): TunnelState | undefined {
  return store.states.find((s) => s.profileId === profileId);
}

export async function refreshAll(store: TunnelStore): Promise<TunnelStore> {
  const api = getClient();
  try {
    const [profiles, states] = await Promise.all([api.listProfiles(), api.listStates()]);
    return { ...store, profiles: [...profiles], states: [...states], connected: true, lastError: null, loading: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "cannot reach daemon";
    return { ...store, connected: false, lastError: message, loading: false };
  }
}

export async function refreshHosts(store: TunnelStore): Promise<TunnelStore> {
  try {
    const hosts = await getClient().listHosts();
    return { ...store, hosts: [...hosts] };
  } catch {
    return store;
  }
}

/**
 * Installed terminals for the "Open in…" menu. An older daemon has no such
 * route, which is not an error: the UI simply falls back to copy-only.
 */
export async function refreshTerminals(store: TunnelStore): Promise<TunnelStore> {
  try {
    const terminals = await getClient().listTerminals();
    return { ...store, terminals: [...terminals] };
  } catch {
    return { ...store, terminals: [] };
  }
}

/**
 * Open a forwarded port in the user's own browser.
 *
 * The daemon performs the OS call: inside a webview a plain anchor would
 * navigate this console away instead of launching a browser. An older daemon
 * has no such route, so the failure is surfaced rather than silently swallowed.
 */
export async function openUrl(url: string): Promise<void> {
  await getClient().openUrl(url);
}
