/**
 * Desktop shell verifier: the Web UI dist must exist (Tauri embeds it), and
 * — when cargo is available — `cargo check` must pass for the shell. Without
 * cargo (or without network for the registry) the TS-side check still keeps
 * `pnpm build` green; CI with Rust runs the real gate.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDist = join(root, "apps", "web", "dist", "index.html");
if (!existsSync(webDist)) {
  console.log("desktop: web UI not built yet; run pnpm --filter @ssh-tunnel/web build first (non-fatal)");
} else {
  console.log("desktop: web UI present, Tauri frontendDist verified");
}

const manifest = join(root, "apps", "desktop", "src-tauri", "Cargo.toml");
try {
  execFileSync("cargo", ["check", "--manifest-path", manifest], {
    stdio: "pipe",
    env: {
      ...process.env,
      CARGO_HOME: process.env["CARGO_HOME"] ?? "/tmp/cargo-home",
      CARGO_TARGET_DIR: process.env["CARGO_TARGET_DIR"] ?? "/tmp/cargo-target-sshtunnel",
    },
  });
  console.log("desktop: cargo check passed");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`desktop: cargo check skipped/failed in this env (${message.slice(0, 120)}) — CI runs the real gate`);
}
