/**
 * `pnpm --filter @ssh-tunnel/web build` — the Web UI is a dependency-free
 * static page on purpose (no framework, no bundler): copy it to dist so the
 * daemon can serve it. Zero JS toolchain beyond this copy.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "apps", "web", "dist");
mkdirSync(outdir, { recursive: true });
copyFileSync(join(root, "apps", "web", "src", "index.html"), join(outdir, "index.html"));
console.log(`web UI -> ${join(outdir, "index.html")}`);
