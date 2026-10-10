/**
 * VS Code extension bundler: esbuild CJS bundle with `vscode` external
 * (space-lens shape) — the vsix ships zero runtime node_modules. Also stages
 * the daemon `server.mjs` beside the bundle so the supervisor can spawn it.
 */
import { buildSync } from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "integrations", "vscode");
const outdir = join(ext, "dist");
mkdirSync(outdir, { recursive: true });

buildSync({
  entryPoints: [join(ext, "src", "extension.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  outfile: join(outdir, "extension.js"),
  sourcemap: false,
  logLevel: "info",
});

const server = join(root, "apps", "server", "dist", "server.mjs");
if (existsSync(server)) {
  copyFileSync(server, join(outdir, "server.mjs"));
  console.log("vscode: staged daemon server.mjs");
} else {
  console.log("vscode: daemon not built yet; run pnpm --filter @ssh-tunnel/server build first (non-fatal)");
}
console.log(`vscode: bundled ${join(outdir, "extension.js")}`);
