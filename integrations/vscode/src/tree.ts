/**
 * Tree view for the VS Code extension: one row per tunnel with its live
 * status, forwarding summary, and inline start/stop. Refreshes on demand and
 * on a poll while visible. All rules stay in core/service; this only renders.
 */
import { createTunnelClient, type TunnelClient } from "@ssh-tunnel/client";
import type { TunnelProfile, TunnelState } from "@ssh-tunnel/contract";

// `vscode` is an extension-host ambient: imported only when running inside VS
// Code. The type import keeps this file checkable without the API package;
// the runtime import happens in extension.ts and is passed in.
export interface VscodeApi {
  readonly TreeItem: new (label: string, collapsibleState: number) => {
    id?: string;
    label?: string;
    description?: string;
    tooltip?: string;
    contextValue?: string;
    iconPath?: unknown;
  };
  readonly TreeItemCollapsibleState: { readonly None: number };
  readonly ThemeIcon: new (id: string) => unknown;
  readonly EventEmitter: new <T>() => {
    event: unknown;
    fire(value?: T): void;
  };
}

export interface TunnelRow {
  readonly profile: TunnelProfile;
  readonly status: TunnelState["status"];
  readonly detail: string;
}

function forwardSummary(profile: TunnelProfile): string {
  return profile.forwards
    .map((rule) =>
      rule.kind === "dynamic"
        ? `-D ${rule.bindPort}`
        : rule.kind === "local"
          ? `-L ${rule.bindPort}→${rule.targetHost}:${rule.targetPort}`
          : `-R ${rule.bindPort}→${rule.targetHost}:${rule.targetPort}`,
    )
    .join(" ");
}

export class TunnelTreeProvider {
  private readonly client: TunnelClient;
  private readonly api: VscodeApi;
  private readonly changed: { event: unknown; fire(value?: void): void };
  private rows: TunnelRow[] = [];

  constructor(api: VscodeApi, daemonUrl: string, fetchImpl: typeof fetch) {
    this.api = api;
    this.client = createTunnelClient({ baseUrl: daemonUrl, fetch: fetchImpl });
    this.changed = new api.EventEmitter<void>();
  }

  get onDidChangeTreeData(): unknown {
    return this.changed.event;
  }

  async refresh(): Promise<void> {
    try {
      const [profiles, states] = await Promise.all([
        this.client.listProfiles(),
        this.client.listStates(),
      ]);
      const byId = new Map(states.map((state) => [state.profileId, state.status]));
      this.rows = [...profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((profile) => ({
          profile,
          status: byId.get(profile.id) ?? "stopped",
          detail: `${profile.sshTarget} · ${forwardSummary(profile)}`,
        }));
    } catch {
      this.rows = [];
    }
    this.changed.fire();
  }

  getChildren(): TunnelRow[] {
    return this.rows;
  }

  getTreeItem(row: TunnelRow): object {
    const statusIcon =
      row.status === "running"
        ? "circle-filled"
        : row.status === "failed"
          ? "error"
          : row.status === "degraded"
            ? "warning"
            : "circle-outline";
    const item = new this.api.TreeItem(
      `${row.profile.name} [${row.status}]`,
      this.api.TreeItemCollapsibleState.None,
    );
    item.id = row.profile.id;
    item.description = row.detail;
    item.tooltip = `${row.profile.name} (${row.profile.mode}) → ${row.profile.sshTarget}`;
    item.contextValue = row.status === "running" || row.status === "degraded" ? "tunnelRunning" : "tunnelStopped";
    item.iconPath = new this.api.ThemeIcon(statusIcon);
    return item;
  }
}
