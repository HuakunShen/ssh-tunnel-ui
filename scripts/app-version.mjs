#!/usr/bin/env node
/**
 * Print the desktop bundle version.
 *
 * The release workflow names every artifact after this one value, so it is read
 * from the file `tauri build` actually bundles rather than from the tag a
 * second time: whatever the bundle says is what the download is called.
 *
 * Usage: `node scripts/app-version.mjs`
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  readFileSync(join(root, "apps", "desktop", "src-tauri", "tauri.conf.json"), "utf8"),
);
process.stdout.write(`${config.version}\n`);
