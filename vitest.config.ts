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
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "packages/*/src/**/*.test.ts"],
  },
});
