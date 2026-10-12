#!/usr/bin/env bun
/**
 * Verify the selected-row highlight spans the full container width.
 * Uses `captureSpans()` (per-span bg colors) — `captureCharFrame()` only
 * carries characters, so it cannot see background coverage at all.
 */
import { createElement as h } from "react";
import { testRender } from "@opentui/react/test-utils";
import { TunnelListView } from "../src/view.js";
import type { TunnelProfile, TunnelState } from "@ssh-tunnel/contract";

const NOW = "2026-10-11T00:00:00.000Z";
const PROFILES: TunnelProfile[] = [
  {
    id: "t-1", name: "ufo · jupyter", mode: "local", sshTarget: "ufo",
    forwards: [{ kind: "local", bindPort: 18888, targetHost: "127.0.0.1", targetPort: 8888 }],
    createdAt: NOW, updatedAt: NOW,
  },
  {
    id: "t-2", name: "mini · socks", mode: "dynamic", sshTarget: "mac-mini",
    forwards: [{ kind: "dynamic", bindPort: 11080 }],
    createdAt: NOW, updatedAt: NOW,
  },
];
const STATES: TunnelState[] = [
  { profileId: "t-1", status: "running", forwards: [] },
  { profileId: "t-2", status: "stopped", forwards: [] },
];

const WIDTH = 100;
const setup = await testRender(
  h(TunnelListView, {
    profiles: PROFILES,
    statesById: new Map(STATES.map((s) => [s.profileId, s])),
    selected: 0,
    busy: false,
    error: null,
    notice: "q",
  }),
  { width: WIDTH, height: 32 },
);
await setup.flush();
const frame = setup.captureSpans();
await setup.dispose();

function rgbaToString(bg: { r: number; g: number; b: number; a: number }): string {
  return `rgba(${bg.r},${bg.g},${bg.b},${bg.a})`;
}

let selectedRow = -1;
frame.lines.forEach((line, y) => {
  const text = line.spans.map((s) => s.text).join("");
  if (text.includes("▸")) selectedRow = y;
});
if (selectedRow < 0) {
  console.log("FAIL: no selected row found");
  process.exit(1);
}
const line = frame.lines[selectedRow]!;
let cyanCells = 0;
let totalCells = 0;
for (const span of line.spans) {
  totalCells += span.width;
  // cyan highlight ≈ (r≈0, g≈1, b≈1) opaque; BGRA channels are 0–1 floats.
  if (span.bg.a > 0.5 && span.bg.g > 0.5 && span.bg.b > 0.5 && span.bg.r < 0.4) {
    cyanCells += span.width;
  }
}
console.log(`frame cols=${frame.cols} selectedRow=${selectedRow} cyanCells=${cyanCells}/${totalCells}`);
// Border chrome (│ + padding) carries no background; everything between the
// borders must be highlighted. Allow the border cells as the only gap.
if (totalCells - cyanCells <= 6) {
  console.log("PASS: highlight spans the full row width");
} else {
  console.log("FAIL: highlight stops early (text-level bg bug)");
  process.exit(1);
}
