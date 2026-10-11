#!/usr/bin/env bun
/**
 * `apps/cli` build (owned by this package, run with bun).
 *
 * Bundles the CLI into a single zero-dependency ESM file.
 * Usage: `bun ./scripts/build.ts` here, or `pnpm --filter @ssh-tunnel/cli build`.
 */
import {
  buildBinary,
  packageDirFromScriptsFile,
  PRODUCTION_DEFINE,
} from "@ssh-tunnel/build-helper";

const packageDir = packageDirFromScriptsFile(import.meta.url);
const outfile = buildBinary({
  packageDir,
  entry: "src/cli.ts",
  outfile: "dist/cli.mjs",
  define: PRODUCTION_DEFINE,
});
console.log(`built ${outfile}`);
