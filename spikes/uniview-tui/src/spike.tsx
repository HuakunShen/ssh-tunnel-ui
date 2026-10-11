/**
 * Spike (not shipped): can `@uniview/tui-react` carry the tunnel TUI?
 *
 * Renders a tunnel list with uniview's `List` + `Panel` + `Text` on a memory
 * surface, drives keys via `dispatchInput`, and asserts the frames — the same
 * shape its own test suite uses. No TTY required.
 */
import { createElement as h, useState } from "react";
import {
  List,
  MemoryCellSurface,
  Panel,
  StatusBar,
  StyleTable,
  Text,
  createTuiReactRoot,
  type TuiInputEvent,
} from "@uniview/tui-react";

export interface SpikeTunnel {
  readonly id: string;
  readonly name: string;
  readonly mode: string;
  readonly target: string;
  readonly status: string;
}

const key = (k: string): TuiInputEvent => ({
  type: "key",
  key: k,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
});

export function tick(): Promise<void> {
  return (async () => {
    for (let i = 0; i < 25; i += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  })();
}

export function TunnelListSpike(props: {
  readonly tunnels: readonly SpikeTunnel[];
  readonly onToggle?: (id: string) => void;
}): React.ReactElement {
  const [selected, setSelected] = useState(0);
  const items = props.tunnels.map(
    (t) => `${t.status === "running" ? "●" : "○"} ${t.name} [${t.mode}] → ${t.target}`,
  );
  return h(
    Panel,
    { title: "ssh-tunnel (uniview spike)" },
    h(List<string>, {
      items,
      selectedIndex: selected,
      onSelect: (index: number) => {
        setSelected(index);
        const tunnel = props.tunnels[index];
        if (tunnel !== undefined) props.onToggle?.(tunnel.id);
      },
      width: 60,
      height: 8,
    }),
    h(StatusBar, {
      items: [{ label: "toggle · select", keyHint: "enter · ↑↓" }],
    }),
    h(Text, {}, `selected: ${props.tunnels[selected]?.name ?? "(none)"}`),
  );
}

export async function renderSpike(
  tunnels: readonly SpikeTunnel[],
  onToggle?: (id: string) => void,
): Promise<{ surfaceText: string; root: ReturnType<typeof createTuiReactRoot>; styles: StyleTable }> {
  const styles = new StyleTable();
  const surface = new MemoryCellSurface({ styles });
  const root = createTuiReactRoot({ surface, styles, size: { width: 64, height: 14 } });
  root.render(h(TunnelListSpike, { tunnels, onToggle }));
  await tick();
  return { surfaceText: surface.text({ trimRight: true }), root, styles };
}

export { key };
