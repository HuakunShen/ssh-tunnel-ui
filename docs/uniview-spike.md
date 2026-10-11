# Spike report: `@uniview/tui-react` for the tunnel TUI

Date: 2026-10-11. Published package `@uniview/tui-react@0.0.3` evaluated via
`spikes/uniview-tui` (memory-surface tests, no TTY). Submodule
`vendors/uniview` tracks upstream for co-evolution with OpenTUI.

## Verdict: capable, but NOT adopted yet — stay on OpenTUI, track uniview

| Axis | OpenTUI (current) | uniview tui-react (0.0.3) |
|---|---|---|
| Renderer maturity | Production (space-lens ships it) | Young but real (lazygit/charts/opencode demos) |
| React model | Standard React 19 + reconciler | Custom reconciler, own component set (`Panel/List/Select/TextInput/StatusBar/...`) |
| Test story | Needs real TTY (`@microsoft/tui-test`, now wired as `pnpm test:e2e`) | **Memory surface + `dispatchInput` + semantic query — zero TTY** (`AutomationSession`) |
| Native deps | Per-platform binding (bundling caveat, documented) | Pure JS (yoga layout) |
| API stability | 0.6.0, moving | 0.0.3, moving faster |

## What the spike proved (`spikes/uniview-tui`, 2 tests green)

- Tunnel list renders (names/modes/targets/status dots) on `MemoryCellSurface`.
- `ArrowDown` moves selection, `Enter` fires toggle with the right tunnel id.
- `tsc --noEmit` clean; no TTY anywhere in the loop.

## Why not migrate now

1. **Full component rewrite.** Every JSX element changes (`<box>/<text>` →
   `Panel/List/Text/...`); keyboard handling moves from `useKeyboard` to
   focus-routed `onKeyDown`. The App shell would be rewritten, not ported.
2. **Young API surface.** 0.0.3 with fast-moving props (this spike already hit
   one: `StatusItem.text` → `{label, keyHint}`). Migrating now buys churn.
3. **OpenTUI just got fixed.** The startup crash was our bundling bug
   (dual-React), not an OpenTUI defect; with `react` external + production
   defines the current TUI runs clean (verified headless, e2e pending local).

## Plan (per owner's direction: submodule + co-evolve)

- Keep `vendors/uniview` pinned; re-run the spike at each uniview minor bump.
- Migration trigger: uniview's OpenTUI-compatible backend (`tui-backend-opentui`,
  currently `Experimental Gate A`) stabilizes — then only the render backend
  swaps while the reducer + contract stay untouched.
- If migrating: port `apps/tui` to uniview components, keep the daemon/HTTP
  API identical, and keep `@microsoft/tui-test` e2e as the cross-backend
  adjudicator (same keypresses → same pixels).
