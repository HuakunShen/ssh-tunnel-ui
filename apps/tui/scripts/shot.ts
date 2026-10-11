#!/usr/bin/env bun
/**
 * `apps/tui` screenshot helper (owned by this package, run with bun).
 *
 * Renders `TunnelListView` with demo data through OpenTUI's test-renderer
 * (memory frames, no TTY) and writes `screenshots/tui-list.svg` — a README
 * gallery asset reproducible anywhere, including sandboxes. Colors follow
 * the app's status palette (green/yellow/red/cyan selection).
 *
 * Usage: `bun ./scripts/shot.ts` here.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { testRender } from "@opentui/react/test-utils";
import { packageDirFromScriptsFile } from "@ssh-tunnel/build-helper";
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
  {
    id: "t-3", name: "win · rdp", mode: "local", sshTarget: "rog16-windows",
    jumpHops: ["ufo"],
    forwards: [{ kind: "local", bindPort: 13389, targetHost: "127.0.0.1", targetPort: 3389 }],
    createdAt: NOW, updatedAt: NOW,
  },
];

const STATES: TunnelState[] = [
  { profileId: "t-1", status: "running", pid: 4242, startedAt: NOW, forwards: [{ kind: "local", bindPort: 18888, ok: true, latencyMs: 2 }] },
  { profileId: "t-2", status: "stopped", forwards: [] },
  { profileId: "t-3", status: "failed", lastError: "ssh exited with code 255", forwards: [] },
];

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Map the app's named colors to hex for the SVG.
const COLOR: Record<string, string> = {
  cyan: "#22d3ee",
  green: "#4ade80",
  yellow: "#facc15",
  red: "#f87171",
  "#999": "#737373",
  black: "#020617",
};

export function frameToSvg(frame: string, selectedBg = "#22d3ee"): string {
  const rows = frame.split("\n");
  const height = rows.length;
  const width = Math.max(...rows.map((r) => [...r].length));
  const cellW = 8.4;
  const cellH = 17;
  const selectedRow = rows.findIndex((r) => r.includes("▸"));
  let rects = "";
  if (selectedRow >= 0) {
    rects = `  <rect x="0" y="${selectedRow * cellH}" width="${width * cellW}" height="${cellH}" fill="${selectedBg}" opacity="0.9"/>\n`;
  }
  const text = rows
    .map((row, y) =>
      [...row]
        .map((ch, x) => {
          if (ch === " ") return "";
          const selected = y === selectedRow;
          const fill = selected ? "#020617" : "#e2e8f0";
          const weight = ch === "▸" || ch === "●" || ch === "◐" || ch === "✖" ? "bold" : "normal";
          return `  <text x="${(x * cellW).toFixed(1)}" y="${((y + 1) * cellH - 4).toFixed(1)}" fill="${fill}" font-weight="${weight}">${escapeXml(ch)}</text>\n`;
        })
        .join(""),
    )
    .join("");
  void COLOR;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(width * cellW).toFixed(0)}" height="${(height * cellH).toFixed(0)}" font-family="JetBrains Mono, Menlo, monospace" font-size="13">\n<rect width="100%" height="100%" fill="#020617"/>\n${rects}${text}</svg>\n`;
}

const packageDir = packageDirFromScriptsFile(import.meta.url);
const setup = await testRender(
  h(TunnelListView, {
    profiles: PROFILES,
    statesById: new Map(STATES.map((s) => [s.profileId, s])),
    selected: 0,
    busy: false,
    error: null,
    notice: "q quit · ↑↓ select · enter start/stop · p probe · s stop-all · r refresh",
  }),
  { width: 100, height: 32 },
);
await setup.flush();
const frame = setup.captureCharFrame();
await setup.dispose();

const outdir = join(packageDir, "..", "..", "screenshots");
mkdirSync(outdir, { recursive: true });
const outfile = join(outdir, "tui-list.svg");
writeFileSync(outfile, frameToSvg(frame));
console.log(`tui shot -> ${outfile}`);
