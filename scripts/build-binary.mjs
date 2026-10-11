/**
 * `pnpm build` helper: bundles one app entry (server/cli/tui) into a single
 * zero-dependency ESM file with esbuild. Workspace packages ride inside the
 * bundle, so the artifact has no `workspace:*` left to resolve at runtime.
 *
 * Usage: node scripts/build-binary.mjs <server|cli|tui>
 */
import { buildSync } from "esbuild";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
const ENTRIES = {
  server: "apps/server/src/server.ts",
  cli: "apps/cli/src/cli.ts",
  tui: "apps/tui/src/tui.tsx",
};

if (target === undefined || !(target in ENTRIES)) {
  console.error(`usage: build-binary.mjs <${Object.keys(ENTRIES).join("|")}>`);
  process.exit(1);
}

const entry = join(root, ENTRIES[target]);
const outdir = join(root, target === "server" ? "apps/server/dist" : target === "cli" ? "apps/cli/dist" : "apps/tui/dist");
mkdirSync(outdir, { recursive: true });
const outfile = join(outdir, target === "server" ? "server.mjs" : target === "cli" ? "cli.mjs" : "tui.mjs");

buildSync({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  banner: { js: "#!/usr/bin/env node" },
  loader: { ".tsx": "tsx", ".ts": "ts" },
  jsx: "automatic",
  // Ship production React/reconciler builds: without this, the bundle runs
  // development builds (slow, noisy) because NODE_ENV is unset at runtime.
  define: { "process.env.NODE_ENV": '"production"' },
  // OpenTUI's native render library is platform-specific and loaded via a
  // dynamic import at runtime. If @opentui/* is bundled, that import resolves
  // from the bundle location and misses the native package (which lives as a
  // sibling of @opentui/core in the pnpm store). Keep @opentui/* external so
  // it loads from its real location and finds its own native sibling — the
  // TUI bundle thus needs apps/tui/node_modules at runtime (like a vite SSR
  // build), while server/cli stay zero-dependency single files.
  //
  // `react` MUST stay external too: bundling it creates a second copy with
  // its own hooks dispatcher, while @opentui/react's reconciler drives the
  // node_modules copy — App's useState then reads `null` and crashes at
  // startup ("Cannot read properties of null (reading 'useState')").
  external:
    target === "tui"
      ? [
          "react",
          "@opentui/core",
          "@opentui/react",
          "@opentui/core-darwin-arm64",
          "@opentui/core-darwin-x64",
          "@opentui/core-linux-x64",
          "@opentui/core-linux-arm64",
          "@opentui/core-win32-x64",
          "@opentui/core-win32-arm64",
          "@opentui/core-linux-x64-musl",
          "@opentui/core-linux-arm64-musl",
        ]
      : [],
  logLevel: "info",
});
chmodSync(outfile, 0o755);
console.log(`built ${outfile}`);
