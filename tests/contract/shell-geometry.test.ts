/**
 * Shell geometry parity with space-lens.
 *
 * The console is meant to read as the same family of macOS-first desktop UI as
 * space-lens, which lives in a neighbouring checkout. These assertions pin the
 * values that make it look that way — bar heights, row metrics, type sizes —
 * so an ordinary edit cannot quietly turn the app back into a generic web page.
 *
 * The reference values are copied, not imported: the sibling repo is not a
 * workspace dependency and must never become one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shellCss = readFileSync(
  fileURLToPath(new URL("../../packages/web-ui/src/shell.css", import.meta.url)),
  "utf8",
);

function declaration(selector: string, property: string): string {
  // Collapse whitespace so a selector written across two CSS lines still
  // matches the way it reads in source.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  // Anchor to a rule boundary so a selector can never match inside another
  // one — `.toolbar-icon, .toolbar-button` also occurs within an
  // `:is(...)` in a media query, which would silently read the wrong block.
  const block = new RegExp(`(?:^|[\\n{}])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(shellCss);
  if (block?.[1] === undefined) {
    throw new Error(`no rule for ${selector}`);
  }
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(block[1]);
  if (found?.[1] === undefined) {
    throw new Error(`${selector} has no ${property}`);
  }
  return found[1].trim();
}

describe("console shell matches the space-lens geometry", () => {
  it("sidebar is 216px wide with 34px rows at 13px", () => {
    expect(declaration(".tunnel-sidebar", "width")).toBe("216px");
    expect(declaration(".sidebar-item", "height")).toBe("34px");
    expect(declaration(".sidebar-item", "font-size")).toBe("13px");
    expect(declaration(".sidebar-item", "border-radius")).toBe("6px");
  });

  it("sidebar headings are 11px at weight 550, not small caps", () => {
    expect(declaration(".sidebar-heading", "font-size")).toBe("11px");
    expect(declaration(".sidebar-heading", "font-weight")).toBe("550");
  });

  it("title bar is 56px on macOS, denser on Windows", () => {
    expect(declaration(".tunnel-toolbar", "height")).toBe("56px");
    expect(declaration("[data-interface='windows'] .tunnel-toolbar", "height")).toBe("40px");
  });

  it("the macOS title stacks two lines instead of sharing a baseline", () => {
    expect(declaration(".toolbar-title", "flex-direction")).toBe("column");
    expect(declaration(".toolbar-title strong", "font-size")).toBe("14px");
    expect(declaration(".toolbar-title > span", "font-size")).toBe("12px");
  });

  it("toolbar controls are 30px and flat until hovered", () => {
    expect(declaration(".toolbar-icon, .toolbar-button", "height")).toBe("30px");
    expect(declaration(".toolbar-icon, .toolbar-button", "background")).toBe("transparent");
  });

  it("status bar is 36px with 10px tabular counters", () => {
    expect(declaration(".tunnel-status", "height")).toBe("36px");
    expect(declaration(".tunnel-status", "font-size")).toBe("10px");
  });

  it("rows sit flat on the canvas, not inside a bordered card", () => {
    expect(declaration(".tunnel-row", "padding")).toBe("11px 10px");
    expect(declaration(".tunnel-row .row-name", "font-size")).toBe("12px");
    expect(declaration(".tunnel-row .row-detail", "font-size")).toBe("10px");
    // The list itself carries only a hairline, never a surface + border.
    expect(shellCss).not.toMatch(/\.tunnel-table\s*\{[^}]*border:/);
  });

  it("honours reduced transparency for both the glass pill and panels", () => {
    const block = /@media \(prefers-reduced-transparency: reduce\)\s*\{([\s\S]*?)\n\}/.exec(shellCss);
    expect(block?.[1]).toBeDefined();
    const reduced = block?.[1] ?? "";
    expect(reduced).toContain("backdrop-filter: none");
    expect(reduced).toContain(".toolbar-actions.glass-controls");
  });
});