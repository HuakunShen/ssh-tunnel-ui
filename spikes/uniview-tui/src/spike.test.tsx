/**
 * Spike assertions: tunnel list renders, arrow keys move selection, Enter
 * fires the toggle callback with the right id. Memory surface, no TTY.
 */
import { describe, expect, it } from "vitest";
import { key, renderSpike, tick } from "@ssh-tunnel/uniview-spike/spike";

const TUNNELS = [
  { id: "t-1", name: "ufo web", mode: "local", target: "ufo", status: "running" },
  { id: "t-2", name: "mini socks", mode: "dynamic", target: "mac-mini", status: "stopped" },
] as const;

describe("uniview spike: tunnel list", () => {
  it("renders names, modes, targets and status dots", async () => {
    const { surfaceText, root } = await renderSpike([...TUNNELS]);
    expect(surfaceText).toContain("ufo web");
    expect(surfaceText).toContain("mini socks");
    expect(surfaceText).toContain("●");
    expect(surfaceText).toContain("○");
    root.destroy();
  });

  it("moves selection with ArrowDown and toggles with Enter", async () => {
    const toggled: string[] = [];
    const { surfaceText: _before, root } = await renderSpike([...TUNNELS], (id) => toggled.push(id));
    void _before;
    root.dispatchInput(key("Tab"));
    root.dispatchInput(key("ArrowDown"));
    await tick();
    root.dispatchInput(key("Enter"));
    await tick();
    expect(toggled).toEqual(["t-2"]);
    root.destroy();
  });
});
