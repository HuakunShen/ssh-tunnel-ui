/**
 * Bundle regression tests: the TUI crash ("Cannot read properties of null
 * (reading 'useState')") was a dual-React bundle — `react` bundled inside
 * `tui.mjs` while `@opentui/react` used the node_modules copy, so hooks
 * dispatched to a null dispatcher. These run anywhere (no TTY) and fail the
 * build if the bundling regresses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tuiBundle = join(root, "apps", "tui", "dist", "tui.mjs");

describe("tui bundle shape", () => {
  it("exists after pnpm build", () => {
    expect(existsSync(tuiBundle)).toBe(true);
  });

  it("keeps react external (single hooks dispatcher)", () => {
    const source = readFileSync(tuiBundle, "utf8");
    // The bundle must import react, not inline it: an inlined second copy
    // crashes every hook call at startup.
    expect(source).toMatch(/from\s*["']react["']/);
    // No bundled development reconciler (production define must hold).
    expect(source).not.toContain("react-reconciler.development");
  });

  it("keeps @opentui/* external (native binding resolution)", () => {
    const source = readFileSync(tuiBundle, "utf8");
    expect(source).toMatch(/@opentui\/react/);
    expect(source).toMatch(/@opentui\/core/);
  });
});
