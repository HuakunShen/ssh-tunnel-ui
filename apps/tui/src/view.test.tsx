/**
 * TUI snapshot tests via OpenTUI's own `test-renderer` (memory frames, mock
 * keys — no TTY needed). The pure `TunnelListView` renders here exactly as
 * the interactive `App` embeds it, so pixels cannot drift from logic.
 */
import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { testRender } from "@opentui/react/test-utils";
import { TunnelListView } from "./view.js";
import type { TunnelProfile, TunnelState } from "@ssh-tunnel/contract";

const NOW = "2026-10-11T00:00:00.000Z";

const PROFILES: TunnelProfile[] = [
  {
    id: "t-1",
    name: "ufo · jupyter",
    mode: "local",
    sshTarget: "ufo",
    forwards: [{ kind: "local", bindPort: 18888, targetHost: "127.0.0.1", targetPort: 8888 }],
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "t-2",
    name: "mini · socks",
    mode: "dynamic",
    sshTarget: "mac-mini",
    forwards: [{ kind: "dynamic", bindPort: 11080 }],
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const STATES: TunnelState[] = [
  { profileId: "t-1", status: "running", pid: 1234, startedAt: NOW, forwards: [{ kind: "local", bindPort: 18888, ok: true, latencyMs: 2 }] },
  { profileId: "t-2", status: "stopped", forwards: [] },
];

function statesById(states: readonly TunnelState[]): Map<string, TunnelState> {
  return new Map(states.map((s) => [s.profileId, s]));
}

describe("TunnelListView snapshots", () => {
  it("renders names, modes, targets and status dots", async () => {
    const setup = await testRender(
      h(TunnelListView, {
        profiles: PROFILES,
        statesById: statesById(STATES),
        selected: 0,
        busy: false,
        error: null,
        notice: "q quit",
      }),
      { width: 100, height: 32 },
    );
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("ufo · jupyter");
    expect(frame).toContain("mini · socks");
    expect(frame).toContain("●");
    expect(frame).toContain("○");
    expect(frame).toContain("18888");
    await setup.dispose();
  });

  it("marks the selected row and shows detail for it", async () => {
    const setup = await testRender(
      h(TunnelListView, {
        profiles: PROFILES,
        statesById: statesById(STATES),
        selected: 1,
        busy: false,
        error: null,
        notice: "q quit",
      }),
      { width: 100, height: 32 },
    );
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("▸");
    expect(frame).toContain("mini · socks");
    expect(frame).toContain("-D");
    expect(frame).toContain("11080");
    await setup.dispose();
  });

  it("shows backend errors and the empty state", async () => {
    const errored = await testRender(
      h(TunnelListView, {
        profiles: PROFILES,
        statesById: statesById(STATES),
        selected: 0,
        busy: true,
        error: "InternalError: cannot reach daemon",
        notice: "q quit",
      }),
      { width: 100, height: 32 },
    );
    await errored.flush();
    expect(errored.captureCharFrame()).toContain("cannot reach daemon");
    await errored.dispose();

    const empty = await testRender(
      h(TunnelListView, {
        profiles: [],
        statesById: statesById([]),
        selected: 0,
        busy: false,
        error: null,
        notice: "q quit",
      }),
      { width: 100, height: 32 },
    );
    await empty.flush();
    expect(empty.captureCharFrame()).toContain("(empty)");
    await empty.dispose();
  });
});
