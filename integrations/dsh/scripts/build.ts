#!/usr/bin/env bun
/**
 * `integrations/dsh` build (owned by this package, run with bun).
 *
 * Stages the Web UI static build (`apps/web/dist`) under `web/` so the host
 * half can serve panel documents from inside the installed package — without
 * this the panel frame lands on a 404 while `/api/*` works.
 * Usage: `bun ./scripts/build.ts` here.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { packageDirFromScriptsFile } from "@ssh-tunnel/build-helper";

const packageDir = packageDirFromScriptsFile(import.meta.url);
const src = join(packageDir, "..", "..", "apps", "web", "dist");
const dest = join(packageDir, "web");
if (!existsSync(join(src, "index.html"))) {
  console.log("dsh: web UI not built yet; run pnpm --filter @ssh-tunnel/web build first (non-fatal)");
} else {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`dsh: staged web UI -> ${dest}`);
}
