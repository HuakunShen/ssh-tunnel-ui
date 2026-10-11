/**
 * Shared esbuild helper for per-package `scripts/build.ts` entry points.
 *
 * Each app owns its build script (see the per-app scripts-build-ts files); this module
 * only holds the common bundling so the six scripts don't drift. Run with bun
 * (`bun ./scripts/build.ts` inside the owning package) — bun executes the TS
 * directly, no compile step.
 */
import { buildSync, type BuildOptions } from "esbuild";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BinaryBuildOptions {
  /** Package directory (the one containing `src/` and `dist/`). */
  readonly packageDir: string;
  /** Entry relative to the package dir, e.g. `src/server.ts`. */
  readonly entry: string;
  /** Output file relative to the package dir, e.g. `dist/server.mjs`. */
  readonly outfile: string;
  /** Extra esbuild `external` entries (TUI needs react/opentui external). */
  readonly external?: readonly string[];
  /** Extra esbuild `define` entries. */
  readonly define?: Record<string, string>;
  readonly jsx?: "automatic" | "transform";
}

export function buildBinary(options: BinaryBuildOptions): string {
  const entry = join(options.packageDir, options.entry);
  const outfile = join(options.packageDir, options.outfile);
  mkdirSync(dirname(outfile), { recursive: true });
  const esbuildOptions: BuildOptions = {
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    banner: { js: "#!/usr/bin/env node" },
    loader: { ".tsx": "tsx", ".ts": "ts" },
    logLevel: "info",
  };
  if (options.jsx !== undefined) esbuildOptions.jsx = options.jsx;
  if (options.external !== undefined) esbuildOptions.external = [...options.external];
  if (options.define !== undefined) esbuildOptions.define = { ...options.define };
  buildSync(esbuildOptions);
  chmodSync(outfile, 0o755);
  return outfile;
}

/** `apps/tui` externals: single React copy + runtime native resolution. See build-binary history. */
export const TUI_EXTERNALS: readonly string[] = [
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
];

export const PRODUCTION_DEFINE: Record<string, string> = {
  "process.env.NODE_ENV": '"production"',
};

/** Resolve the owning package dir from a `scripts/build.ts` file URL. */
export function packageDirFromScriptsFile(scriptsFileUrl: string): string {
  return join(dirname(fileURLToPath(scriptsFileUrl)), "..");
}
