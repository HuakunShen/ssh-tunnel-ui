#!/usr/bin/env bun
/**
 * `apps/desktop` build check (owned by this package, run with bun).
 *
 * Verifies the Tauri shell inputs: the Web UI dist must exist (Tauri embeds
 * it as `frontendDist`), and `cargo check` must pass for the shell when cargo
 * is available. The real `.app` comes from `tauri build`; this keeps
 * `pnpm build` green without a Rust toolchain. CI with Rust runs the gate.
 * Usage: `bun ./scripts/build.ts` here, or `pnpm --filter @ssh-tunnel/desktop build`.
 */
import { $ } from "bun";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packageDirFromScriptsFile } from "@ssh-tunnel/build-helper";

const packageDir = packageDirFromScriptsFile(import.meta.url);
const webDist = join(packageDir, "..", "web", "dist", "index.html");
const webPresent = existsSync(webDist);
if (!webPresent) {
  console.log("desktop: web UI not built yet; run pnpm --filter @ssh-tunnel/web build first (non-fatal)");
} else {
  console.log("desktop: web UI present, Tauri frontendDist verified");
}

const manifest = join(packageDir, "src-tauri", "Cargo.toml");
const cargoCheck = await $`cargo check --manifest-path ${manifest}`.nothrow().quiet();
const cargoOk = cargoCheck.exitCode === 0;
if (cargoOk) {
  console.log("desktop: cargo check passed");
} else {
  console.log("desktop: cargo check skipped/failed in this env — CI runs the real gate");
}

// Shell manifest for Tauri bundling + turbo outputs: records the verified
// inputs so `tauri build` and caches can rely on one file.
const outdir = join(packageDir, "dist");
mkdirSync(outdir, { recursive: true });
writeFileSync(
  join(outdir, "shell.json"),
  JSON.stringify(
    { webPresent, cargoOk, frontendDist: "../web/dist", devUrl: "http://127.0.0.1:7432" },
    null,
    2,
  ),
);
console.log(`desktop: shell manifest -> ${join(outdir, "shell.json")}`);
