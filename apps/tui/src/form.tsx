/**
 * Tunnel creation form: controlled `<input>` fields driven by React state,
 * Tab cycles fields, Enter submits, Esc cancels. Pure props in, validated
 * `TunnelProfileInput` out — no I/O, so test-renderer covers it fully.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import type { ForwardRule, TunnelMode, TunnelProfileInput } from "@ssh-tunnel/contract";
import { TUNNEL_MODES } from "@ssh-tunnel/contract";

export const FORM_FIELDS = [
  "name",
  "mode",
  "target",
  "localPort",
  "remoteHost",
  "remotePort",
] as const;

export type FormField = (typeof FORM_FIELDS)[number];

export interface TunnelFormValue {
  readonly name: string;
  readonly mode: TunnelMode;
  readonly target: string;
  readonly localPort: string;
  readonly remoteHost: string;
  readonly remotePort: string;
}

export const EMPTY_FORM: TunnelFormValue = {
  name: "",
  mode: "local",
  target: "",
  localPort: "",
  remoteHost: "127.0.0.1",
  remotePort: "",
};

export function validateForm(value: TunnelFormValue): string | null {
  if (value.name.trim() === "") return "name is required";
  if (value.target.trim() === "") return "ssh target is required";
  const localPort = Number(value.localPort);
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
    return "local port must be 1–65535";
  }
  if (value.mode !== "dynamic") {
    if (value.remoteHost.trim() === "") return "remote host is required";
    const remotePort = Number(value.remotePort);
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      return "remote port must be 1–65535";
    }
  }
  return null;
}

export function toProfileInput(value: TunnelFormValue): TunnelProfileInput {
  const localPort = Number(value.localPort);
  const forwards: ForwardRule[] =
    value.mode === "dynamic"
      ? [{ kind: "dynamic", bindPort: localPort }]
      : value.mode === "remote"
        ? [{
          kind: "remote",
          bindPort: localPort,
          targetHost: value.remoteHost.trim(),
          targetPort: Number(value.remotePort),
        }]
        : [{
          kind: "local",
          bindPort: localPort,
          targetHost: value.remoteHost.trim(),
          targetPort: Number(value.remotePort),
        }];
  return {
    name: value.name.trim(),
    mode: value.mode,
    sshTarget: value.target.trim(),
    forwards,
  };
}

interface TunnelFormProps {
  readonly initial?: TunnelFormValue;
  readonly onSubmit: (input: TunnelProfileInput) => void;
  readonly onCancel: () => void;
}

const FIELD_LABEL: Record<FormField, string> = {
  name: "Name",
  mode: "Mode (local/remote/dynamic)",
  target: "SSH target (alias or user@host)",
  localPort: "Local port",
  remoteHost: "Remote host",
  remotePort: "Remote port",
};

export function TunnelForm(props: TunnelFormProps): ReactNode {
  const [value, setValue] = useState<TunnelFormValue>(props.initial ?? EMPTY_FORM);
  const [focus, setFocus] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof TunnelFormValue>(key: K, next: string): void {
    setError(null);
    if (key === "mode") {
      const mode = ((): TunnelMode => {
        const found = TUNNEL_MODES.find((m) => m === next);
        return found ?? "local";
      })();
      setValue((v) => ({ ...v, mode }));
      return;
    }
    setValue((v) => ({ ...v, [key]: next }));
  }

  function submit(): void {
    const problem = validateForm(value);
    if (problem !== null) {
      setError(problem);
      return;
    }
    props.onSubmit(toProfileInput(value));
  }

  // Field navigation lives here so the form is self-contained: ↑↓ move
  // between fields, Esc cancels. The focused `<input>` keeps text keys;
  // global keys (q/s/r) are suspended by the parent while the form is open.
  useKeyboard((key) => {
    if (key.name === "escape") {
      props.onCancel();
    } else if (key.name === "up") {
      setFocus((f) => (f - 1 + FORM_FIELDS.length) % FORM_FIELDS.length);
    } else if (key.name === "down" || key.name === "tab") {
      setFocus((f) => (f + 1) % FORM_FIELDS.length);
    }
  });

  const field = FORM_FIELDS[focus] ?? "name";

  return (
    <box style={{ border: true, flexDirection: "column", padding: 1, gap: 1 }} title="new tunnel">
      <text fg="#999">↑↓ select field · type to edit · Enter save · Esc cancel</text>
      {(Object.keys(FIELD_LABEL) as FormField[]).map((key) => {
        const active = key === field;
        const shown =
          key === "mode" ? value.mode : value[key];
        return (
          <box key={key} style={{ flexDirection: "row", gap: 1 }}>
            <text fg={active ? "cyan" : "#999"}>
              {active ? "▸ " : "  "}{FIELD_LABEL[key]}:
            </text>
            <input
              value={shown}
              placeholder={key === "remoteHost" ? "127.0.0.1" : ""}
              focused={active}
              onInput={(next) => set(key, next)}
              onSubmit={() => submit()}
            />
          </box>
        );
      })}
      {error !== null ? <text fg="red">{error}</text> : null}
      <text fg="#999">mode cycles: local → remote → dynamic (type to replace)</text>
    </box>
  );
}
