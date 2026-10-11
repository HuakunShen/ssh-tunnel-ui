/**
 * E2E vitest config: real-terminal tests via `@microsoft/tui-test`.
 * Needs a real TTY + ssh + reachable hosts (`pnpm test:e2e` on your own
 * machine). Each file self-skips in sandboxes (no pty devices).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.git/**"],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
