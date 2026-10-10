/**
 * VS Code extension tests: supervisor attach/spawn decisions and the tree
 * provider's rendering — all with vscode-free doubles, no extension host.
 */
import { describe, expect, it } from "vitest";
import { ensureDaemon } from "vscode-ssh-tunnel/supervisor";
import { TunnelTreeProvider, type VscodeApi } from "vscode-ssh-tunnel/tree";

function emptyVscode(): VscodeApi {
  return {
    TreeItem: class {
      id?: string;
      label?: string;
      description?: string;
      tooltip?: string;
      contextValue?: string;
      iconPath?: unknown;
      constructor(label: string) {
        this.label = label;
      }
    },
    TreeItemCollapsibleState: { None: 0 },
    ThemeIcon: class {
      constructor(readonly id: string) {}
    },
    EventEmitter: class {
      event: unknown = null;
      fire(): void {
        // Test double: nobody listens.
      }
    },
  } as unknown as VscodeApi;
}

describe("supervisor", () => {
  it("attaches to a healthy daemon without spawning", async () => {
    const fetchImpl = (async (url: string | URL | Request): Promise<Response> => {
      if (String(url).endsWith("/api/health")) {
        return Response.json({ ok: true, version: "0.1.0", serviceInstanceId: "live-one" });
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }) as typeof fetch;
    const running = await ensureDaemon({
      daemonUrl: "http://127.0.0.1:7432",
      fetch: fetchImpl,
    });
    expect(running.owned).toBe(false);
    expect(running.readiness.serviceInstanceId).toBe("live-one");
    running.stop();
  });

  it("fails fast when no daemon answers and spawn is impossible", async () => {
    const failing = (async (): Promise<Response> => {
      throw new Error("down");
    }) as typeof fetch;
    await expect(
      ensureDaemon({
        daemonUrl: "http://127.0.0.1:9",
        serverDir: "/nonexistent-sshtunnel",
        timeoutMs: 500,
        fetch: failing,
      }),
    ).rejects.toThrow();
  });
});

describe("tree provider", () => {
  it("renders rows with status-aware context values", async () => {
    const fetchImpl = (async (url: string | URL | Request): Promise<Response> => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/profiles") {
        return Response.json({
          profiles: [
            {
              id: "t-1", name: "alpha", mode: "local", sshTarget: "ufo",
              forwards: [{ kind: "local", bindPort: 1801, targetHost: "127.0.0.1", targetPort: 22 }],
              createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (path === "/api/states") {
        return Response.json({ states: [{ profileId: "t-1", status: "running", forwards: [] }] });
      }
      throw new Error(`unexpected ${path}`);
    }) as typeof fetch;
    const provider = new TunnelTreeProvider(emptyVscode(), "http://127.0.0.1:7432", fetchImpl);
    await provider.refresh();
    const rows = provider.getChildren();
    expect(rows).toHaveLength(1);
    const item = provider.getTreeItem(rows[0]!) as { contextValue?: string; label?: string };
    expect(item.contextValue).toBe("tunnelRunning");
    expect(item.label).toContain("alpha");
  });

  it("clears rows when the daemon is unreachable", async () => {
    const failing = (async (): Promise<Response> => {
      throw new Error("down");
    }) as typeof fetch;
    const provider = new TunnelTreeProvider(emptyVscode(), "http://127.0.0.1:9", failing);
    await provider.refresh();
    expect(provider.getChildren()).toEqual([]);
  });
});
