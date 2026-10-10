/**
 * DSH plugin host half: discovers the local daemon and exposes tunnel
 * actions to the harness panel. Thin glue — rules stay in core/service.
 */
import { createTunnelClient } from "@ssh-tunnel/client";

export interface DshHostOptions {
  readonly daemonUrl?: string;
  readonly fetch: typeof fetch;
}

export function createDshTunnelHost(options: DshHostOptions): {
  readonly client: ReturnType<typeof createTunnelClient>;
  readonly daemonUrl: string;
} {
  const daemonUrl = (options.daemonUrl ?? "http://127.0.0.1:7432").replace(/\/$/, "");
  return { client: createTunnelClient({ baseUrl: daemonUrl, fetch: options.fetch }), daemonUrl };
}
