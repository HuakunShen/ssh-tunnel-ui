/**
 * WebdriverIO config for the SSH Tunnel desktop app (Tauri 2).
 *
 * Follows the official Tauri WebDriver guide: the `@wdio/tauri-service`
 * runs an **embedded** WebDriver server inside the app itself, so macOS
 * needs no external driver. `appBinaryPath` points at the release bundle
 * binary built by `pnpm --filter @ssh-tunnel/desktop build:app`.
 *
 * Run: `pnpm --filter @ssh-tunnel/desktop test:e2e` (builds first).
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [join(desktopDir, "e2e/specs/**/*.js")],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: join(
          desktopDir,
          "src-tauri/target/release/bundle/macos/SSH Tunnel.app/Contents/MacOS/ssh-tunnel-desktop",
        ),
      },
    },
  ],
  services: [
    [
      "tauri",
      {
        driverProvider: "embedded",
      },
    ],
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },
};
