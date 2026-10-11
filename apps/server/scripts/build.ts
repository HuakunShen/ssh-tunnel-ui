#!/usr/bin/env bun
/**
 * `apps/server` build (owned by this package, run with bun).
 *
 * Bundles the daemon into a single zero-dependency ESM file; workspace
 * packages ride inside, so nothing resolves `workspace:*` at runtime.
 * Usage: `bun ./scripts/build.ts` here, or `pnpm --filter @ssh-tunnel/server build`.
 */
import {
  buildBinary,
  packageDirFromScriptsFile,
  PRODUCTION_DEFINE,
} from "@ssh-tunnel/build-helper";

const packageDir = packageDirFromScriptsFile(import.meta.url);
const outfile = buildBinary({
  packageDir,
  entry: "src/server.ts",
  outfile: "dist/server.mjs",
  define: PRODUCTION_DEFINE,
});
console.log(`built ${outfile}`);
