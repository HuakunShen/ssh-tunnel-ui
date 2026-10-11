#!/usr/bin/env bun
/**
 * `apps/web` build (owned by this package, run with bun).
 *
 * Full SvelteKit static build into `dist/` for the daemon to serve
 * (`--web-dir=apps/web/dist`) and for Tauri/VS Code/DSH to embed.
 * Usage: `bun ./scripts/build.ts` here, or `pnpm --filter @ssh-tunnel/web build`.
 */
import { $ } from "bun";
import { join } from "node:path";
import { packageDirFromScriptsFile } from "@ssh-tunnel/build-helper";

const packageDir = packageDirFromScriptsFile(import.meta.url);
await $`vite build`.cwd(packageDir);
console.log(`web: vite build -> ${join(packageDir, "dist")}`);
