#!/usr/bin/env bun
/**
 * `apps/tui` build (owned by this package, run with bun).
 *
 * Bundles the TUI with `react` + `@opentui/*` external: a bundled second
 * React copy crashes every hook at startup, and the native render binding
 * must resolve from its real pnpm-store location at runtime. The bundle thus
 * runs with `apps/tui/node_modules` present (like a vite SSR build).
 * Usage: `bun ./scripts/build.ts` here, or `pnpm --filter @ssh-tunnel/tui build`.
 */
import {
  buildBinary,
  packageDirFromScriptsFile,
  PRODUCTION_DEFINE,
  TUI_EXTERNALS,
} from "@ssh-tunnel/build-helper";

const packageDir = packageDirFromScriptsFile(import.meta.url);
const outfile = buildBinary({
  packageDir,
  entry: "src/tui.tsx",
  outfile: "dist/tui.mjs",
  jsx: "automatic",
  external: TUI_EXTERNALS,
  define: PRODUCTION_DEFINE,
});
console.log(`built ${outfile}`);
