/**
 * Root vitest config: resolves workspace packages to their TS source
 * directly (mirroring the source-direct wiring rule), so cross-package
 * tests exercise the same code the apps ship.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ssh-tunnel/contract": `${root}packages/ssh-contract/src/index.ts`,
      "@ssh-tunnel/core": `${root}packages/ssh-core/src/index.ts`,
      "@ssh-tunnel/client": `${root}packages/ssh-client/src/index.ts`,
      "@ssh-tunnel/host-node": `${root}packages/ssh-host-node/src/index.ts`,
      "@ssh-tunnel/service": `${root}packages/ssh-service/src/index.ts`,
      "dsh-plugin-ssh-tunnel": `${root}integrations/dsh/src/host.ts`,
      "vscode-ssh-tunnel/supervisor": `${root}integrations/vscode/src/supervisor.ts`,
      "vscode-ssh-tunnel/tree": `${root}integrations/vscode/src/tree.ts`,
      "@ssh-tunnel/uniview-spike/spike": `${root}spikes/uniview-tui/src/spike.tsx`,
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "packages/*/src/**/*.test.ts", "spikes/*/src/**/*.test.tsx"],
    // e2e needs a real TTY (skipped in sandboxes); `pnpm test:e2e` runs it.
    exclude: ["**/node_modules/**", "**/.git/**", "tests/e2e/**"],
  },
});
