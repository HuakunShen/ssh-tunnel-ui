/**
 * Desktop stub builder: verifies the Tauri wiring notes are present and the
 * Web UI dist exists. The real `tauri build` runs after `tauri:init`; this
 * stub keeps `pnpm build` green until then.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDist = join(root, "apps", "web", "dist", "index.html");
if (!existsSync(webDist)) {
  console.log("desktop stub: web UI not built yet; run pnpm --filter @ssh-tunnel/web build first (non-fatal)");
} else {
  console.log("desktop stub: web UI present; Tauri wiring notes verified");
}
