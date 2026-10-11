#!/usr/bin/env bun
/**
 * `integrations/vscode` build (owned by this package, run with bun).
 *
 * esbuild CJS bundle with `vscode` external (space-lens shape) — the vsix
 * ships zero runtime node_modules. Also stages the daemon `server.mjs`
 * beside the bundle so the supervisor can spawn it.
 * Usage: `bun ./scripts/build.ts` here, or `pnpm --filter vscode-ssh-tunnel build`.
 */
import { $ } from "bun";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { packageDirFromScriptsFile } from "@ssh-tunnel/build-helper";

const packageDir = packageDirFromScriptsFile(import.meta.url);
const outdir = join(packageDir, "dist");
await $`mkdir -p ${outdir}`.quiet();

await build({
  entryPoints: [join(packageDir, "src", "extension.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  outfile: join(outdir, "extension.js"),
  sourcemap: false,
  logLevel: "info",
});

const server = join(packageDir, "..", "..", "apps", "server", "dist", "server.mjs");
if (existsSync(server)) {
  copyFileSync(server, join(outdir, "server.mjs"));
  console.log("vscode: staged daemon server.mjs");
} else {
  console.log("vscode: daemon not built yet; run pnpm --filter @ssh-tunnel/server build first (non-fatal)");
}
console.log(`vscode: bundled ${join(outdir, "extension.js")}`);
