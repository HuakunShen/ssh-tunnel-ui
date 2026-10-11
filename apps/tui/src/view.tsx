/**
 * Pure tunnel-list view: renders profiles + states with zero side effects.
 * No hooks, no timers, no I/O — fully testable with OpenTUI's test-renderer
 * (`captureCharFrame` snapshots) and reusable by the interactive `App`.
 */
import type { ReactNode } from "react";
import type { TunnelProfile, TunnelState } from "@ssh-tunnel/contract";

export interface TunnelListViewProps {
  readonly profiles: readonly TunnelProfile[];
  readonly statesById: ReadonlyMap<string, TunnelState>;
  readonly selected: number;
  readonly busy: boolean;
  readonly error: string | null;
  readonly notice: string;
}

export function statusDot(status: string): string {
  switch (status) {
    case "running":
      return "●";
    case "degraded":
      return "◐";
    case "starting":
    case "stopping":
      return "…";
    case "failed":
      return "✖";
    default:
      return "○";
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "running":
      return "green";
    case "degraded":
      return "yellow";
    case "failed":
      return "red";
    default:
      return "#999";
  }
}

export function detailText(
  profile: TunnelProfile | undefined,
  state: TunnelState | undefined,
): string {
  if (profile === undefined) return "no profiles yet — add one via the CLI or Web UI";
  return [
    `${profile.name}  (${profile.mode})`,
    `target: ${profile.sshTarget}${profile.jumpHops?.length ? ` via ${profile.jumpHops.join(",")}` : ""}`,
    ...profile.forwards.map((f) =>
      f.kind === "dynamic"
        ? `  -D ${f.bindAddress ? `${f.bindAddress}:` : ""}${f.bindPort} (SOCKS)`
        : f.kind === "local"
          ? `  -L ${f.bindAddress ? `${f.bindAddress}:` : ""}${f.bindPort} → ${f.targetHost}:${f.targetPort}`
          : `  -R ${f.bindAddress ? `${f.bindAddress}:` : ""}${f.bindPort} → ${f.targetHost}:${f.targetPort}`,
    ),
    state?.pid !== undefined ? `pid ${state.pid}` : "",
    state?.lastError ? `error: ${state.lastError}` : "",
    ...(state?.forwards.map((f) => `probe ${f.kind}:${f.bindPort} ${f.ok ? "ok" : "FAIL"}${f.latencyMs !== undefined ? ` ${f.latencyMs}ms` : ""}`) ?? []),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function TunnelListView(props: TunnelListViewProps): ReactNode {
  const current = props.profiles[props.selected];
  const currentState = current !== undefined ? props.statesById.get(current.id) : undefined;
  return (
    <box style={{ flexDirection: "column", padding: 1, gap: 1 }}>
      <text fg="cyan">ssh-tunnel — one-click tunnel manager{props.busy ? " (working…)" : ""}</text>
      {props.error !== null ? <text fg="red">{props.error}</text> : null}
      <box style={{ border: true, flexDirection: "column", height: 16, padding: 1 }}>
        {props.profiles.map((profile, index) => {
          const status = props.statesById.get(profile.id)?.status ?? "stopped";
          const isSelected = index === props.selected;
          // Full-row highlight: the background lives on the row box (which
          // spans the container width), not on the text span — OpenTUI paints
          // text backgrounds per glyph run, so a text-level bg would stop at
          // the last character and look like it "overflows" the box.
          return (
            <box key={profile.id} style={{ backgroundColor: isSelected ? "cyan" : undefined }}>
              <text fg={isSelected ? "black" : statusColor(status)}>
                {isSelected ? "▸ " : "  "}
                {statusDot(status)} {profile.name} [{profile.mode}] → {profile.sshTarget}
              </text>
            </box>
          );
        })}
        {props.profiles.length === 0 ? <text fg="#999">(empty)</text> : null}
      </box>
      <box title="detail" style={{ border: true, padding: 1, height: 10 }}>
        <text>{detailText(current, currentState)}</text>
      </box>
      <text fg="#999">{props.notice}</text>
    </box>
  );
}
