/**
 * TUI end-to-end tests via `@microsoft/tui-test` (real pseudo-terminal).
 *
 * These need a real TTY + `ssh` + reachable test hosts, so they do NOT run
 * in sandboxes or CI-by-default: `pnpm test:e2e` runs them, `pnpm test`
 * skips them (see `describe.skipIf`). Locally they exercise the shipped
 * `apps/tui/dist/tui.mjs` bundle exactly as a user runs it: boot, list,
 * keyboard start/stop, and the crash that motivated them (dual-React
 * `useState of null`).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tuiBundle = join(root, "apps", "tui", "dist", "tui.mjs");

// Sandbox/CI detector: no pty devices means tui-test cannot open a session.
function canOpenPty(): boolean {
  try {
    execFileSync("python3", ["-c", "import pty; pty.openpty()"], {
      stdio: "pipe",
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

const e2e = describe.skipIf(!canOpenPty() || !existsSync(tuiBundle));

e2e("tui e2e (tui-test, real terminal)", async () => {
  const { TuiTest } = await import("@microsoft/tui-test");

  it("boots without the dual-React hooks crash and lists tunnels", async () => {
    const terminal = TuiTest.ephemeral("tui-boot");
    try {
      await terminal.run(`node ${tuiBundle} --daemon=http://127.0.0.1:7432`, {
        cols: 100,
        rows: 36,
      });
      // The crash under test printed this and nothing else.
      await terminal.getByText("useState", { full: false }).wait({ state: "hidden", timeout: 15000 }).catch(() => undefined);
      const text = await terminal.text();
      expect(text).not.toMatch(/Cannot read properties of null/);
      await terminal.getByText("ssh-tunnel", { full: false }).expect({ timeout: 15000 });
    } finally {
      await terminal.closeQuiet();
    }
  });

  it("starts and stops a tunnel with the keyboard", async () => {
    const terminal = TuiTest.ephemeral("tui-keys");
    try {
      await terminal.run(`node ${tuiBundle} --daemon=http://127.0.0.1:7432`, {
        cols: 100,
        rows: 36,
      });
      await terminal.getByText("ssh-tunnel", { full: false }).expect({ timeout: 15000 });
      // Move to the first row and toggle it, then stop everything.
      await terminal.keyboard.press("Down");
      await terminal.keyboard.press("Enter");
      await terminal.getByText(/start|stop|running|stopped/i, { full: false }).expect({ timeout: 20000 });
      await terminal.keyboard.press("s");
      await terminal.waitIdle({ timeout: 15000 });
      const text = await terminal.text();
      expect(text).not.toMatch(/Cannot read properties of null/);
    } finally {
      await terminal.closeQuiet();
    }
  });
});
