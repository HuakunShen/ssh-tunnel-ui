/**
 * DSH plugin client half: renders the tunnel list inside the harness panel
 * using the shared typed client. No `node:*` here — this ships to the Web
 * shell, so it only uses injected `fetch`.
 */
import { createTunnelClient } from "@ssh-tunnel/client";
import type { TunnelProfile, TunnelState } from "@ssh-tunnel/contract";

export interface DshPanelSnapshot {
  readonly profiles: readonly TunnelProfile[];
  readonly states: readonly TunnelState[];
}

export async function loadDshPanelSnapshot(
  daemonUrl: string,
  fetchImpl: typeof fetch,
): Promise<DshPanelSnapshot> {
  const client = createTunnelClient({ baseUrl: daemonUrl, fetch: fetchImpl });
  const [profiles, states] = await Promise.all([
    client.listProfiles(),
    client.listStates(),
  ]);
  return { profiles: [...profiles], states: [...states] };
}
