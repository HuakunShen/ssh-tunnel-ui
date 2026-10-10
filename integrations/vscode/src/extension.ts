/**
 * VS Code extension stub (thin front): registers `ssh-tunnel.start/stop/
 * reveal` commands backed by the shared typed client. The tree view renders
 * `listProfiles` + `listStates`; all rules stay in core/service.
 *
 * Wiring (package.json contributes, omitted here for brevity):
 * - viewsContainers/activitybar + views: `sshTunnel` tree backed by `TunnelTreeProvider`
 * - commands: `ssh-tunnel.start`, `ssh-tunnel.stop`, `ssh-tunnel.stopAll`,
 *   `ssh-tunnel.reveal` (opens the Web UI at the daemon URL)
 */
import { createTunnelClient } from "@ssh-tunnel/client";

export interface VscodeExtensionOptions {
  readonly daemonUrl?: string;
  readonly fetch: typeof fetch;
  readonly reveal?: (url: string) => void;
}

export function createVscodeTunnelCommands(options: VscodeExtensionOptions): {
  readonly daemonUrl: string;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  stopAll(): Promise<void>;
  reveal(): void;
} {
  const daemonUrl = (options.daemonUrl ?? "http://127.0.0.1:7432").replace(/\/$/, "");
  const client = createTunnelClient({ baseUrl: daemonUrl, fetch: options.fetch });
  return {
    daemonUrl,
    async start(id: string): Promise<void> {
      await client.start(id);
    },
    async stop(id: string): Promise<void> {
      await client.stop(id);
    },
    async stopAll(): Promise<void> {
      await client.stopAll();
    },
    reveal(): void {
      options.reveal?.(daemonUrl);
    },
  };
}
