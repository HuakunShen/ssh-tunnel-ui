# Feedback for uniview (`tui-react@0.0.3`): findings from the ssh-tunnel spike

Date: 2026-10-11. Evaluated via `spikes/uniview-tui` (list render, arrow-key
selection, Enter toggle — 2 tests green on `MemoryCellSurface`, no TTY).
Authored from real usage, not from reading docs.

## What works well (keep)

1. **Test story is the best in class.** `MemoryCellSurface` +
   `dispatchInput` + semantic query needs zero TTY — our OpenTUI side needs
   `@microsoft/tui-test` + a real pty for the same coverage. This alone is a
   reason to keep co-evolving.
2. **Finished interactive primitives.** `TextInput` (controlled caret),
   `Select`, `List` (full-row highlight, scroll-into-view) cover everything a
   manager-style TUI needs. OpenTUI React ships only `box`/`text`/`input` —
   every form control there is hand-rolled.
3. **The `requestedRef` pattern in `List`** (stale-`selectedIndex` coalescing
   for back-to-back keys) is correct and documented inline — we hit exactly
   this class of bug in our own key handling.

## Friction found (ordered by cost to us)

1. **`StatusItem` rename without a migration note.** Spike code written
   against `{ text }` fails against `{ label, keyHint }` with no hint of the
   rename. Suggestion: keep a deprecated alias for one minor + a
   `CHANGELOG.md` entry per breaking prop change. (Cost us: one spike
   iteration.)
2. **`List.onSelect(index)` carries no trigger source.** Keyboard move and
   mouse click both arrive as a bare index. For a manager TUI these mean
   different things (move selection vs activate/select-then-confirm), and for
   accessibility the distinction matters. Suggestion:
   `onSelect(index, source: "keyboard" | "pointer")` (additive, backwards
   compatible).
3. **No changelog to pin migration timing.** `tui-react@0.0.3` moves fast;
   without per-version notes adopters cannot tell a safe bump from a rewrite.
   Suggestion: auto-generate from conventional commits if handwritten notes
   are too costly.

## Non-issues (checked, fine)

- Custom reconciler vs standard React: no interop problem found in the spike;
  hooks (`useState`) behave normally under `createTuiReactRoot`.
- Pure-JS yoga layout: no native-binding bundling caveats (unlike OpenTUI's
  per-platform binding, which bit us once — documented in our build script).
