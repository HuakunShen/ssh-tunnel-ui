#!/usr/bin/env node
/**
 * Stamp the desktop bundle version from a release tag.
 *
 * A tag says what is being released; `tauri.conf.json` says what the bundle
 * claims to be. Left alone the two drift, and the `.dmg` ends up with the
 * version of whichever commit last bumped it — the exact mismatch that makes
 * `CFBundleShortVersionString` lie about the download.
 *
 * Usage: `node scripts/set-app-version.mjs 0.1.3`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");

// A release tag is `v0.1.3`; Tauri wants `0.1.3`. Accept either spelling.
const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`usage: set-app-version.mjs <semver|vSemver>  (got: ${process.argv[2] ?? "nothing"})`);
  process.exit(2);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
if (config.version === version) {
  console.log(`[version] already ${version}`);
  process.exit(0);
}
config.version = version;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`[version] ${configPath} -> ${version}`);
