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

export interface SpanCell {
  readonly text: string;
  readonly bg: { r: number; g: number; b: number; a: number };
  readonly fg: { r: number; g: number; b: number; a: number };
  readonly width: number;
}

function rgbaToHex(c: { r: number; g: number; b: number }): string {
  const q = (v: number): string => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${q(c.r)}${q(c.g)}${q(c.b)}`;
}

function isTransparent(bg: { a: number }): boolean {
  return bg.a < 0.05;
}

/**
 * Render spans to SVG using the REAL per-span colors from `captureSpans()`.
 * Background rects follow the actual bg runs (including the full-row box
 * highlight), text follows the actual fg — the file reflects the renderer,
 * not an approximation.
 */
export function spansToSvg(
  lines: { spans: SpanCell[] }[][] | { spans: SpanCell[] }[],
  cols: number,
): string {
  const rows = lines as { spans: SpanCell[] }[];
  const cellW = 8.4;
  const cellH = 17;
  let out = "";
  rows.forEach((line, y) => {
    let x = 0;
    for (const span of line.spans) {
      const w = span.width;
      if (!isTransparent(span.bg)) {
        out += `  <rect x="${(x * cellW).toFixed(1)}" y="${(y * cellH).toFixed(1)}" width="${(w * cellW).toFixed(1)}" height="${cellH}" fill="${rgbaToHex(span.bg)}"/>\n`;
      }
      const chars = [...span.text];
      let cx = x;
      for (const ch of chars) {
        if (ch !== " ") {
          const weight = ch === "▸" || ch === "●" || ch === "◐" || ch === "✖" ? "bold" : "normal";
          const fill = isTransparent(span.bg) ? rgbaToHex(span.fg) : "#020617";
          out += `  <text x="${(cx * cellW).toFixed(1)}" y="${((y + 1) * cellH - 4).toFixed(1)}" fill="${fill}" font-weight="${weight}">${escapeXml(ch)}</text>\n`;
        }
        cx += 1;
      }
      x += w;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(cols * cellW).toFixed(0)}" height="${(rows.length * cellH).toFixed(0)}" font-family="JetBrains Mono, Menlo, monospace" font-size="13">\n<rect width="100%" height="100%" fill="#020617"/>\n${out}</svg>\n`;
}

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
const captured = setup.captureSpans();
await setup.dispose();

const outdir = join(packageDir, "..", "..", "screenshots");
mkdirSync(outdir, { recursive: true });
const outfile = join(outdir, "tui-list.svg");
writeFileSync(outfile, spansToSvg(captured.lines, captured.cols));
console.log(`tui shot -> ${outfile}`);
