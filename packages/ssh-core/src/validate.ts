/**
 * Semantic validation for tunnel profiles — beyond what zod shapes can say.
 * Returns human-readable findings with field paths so forms can highlight
 * them. Pure function, host-free.
 */
import type { TunnelProfile, TunnelProfileInput } from "@ssh-tunnel/contract";
import { localBindPorts } from "./argv.js";

export interface ProfileFinding {
  readonly path: string;
  readonly message: string;
  /** `error` blocks start; `warning` is shown but allowed. */
  readonly severity: "error" | "warning";
}

const PROFILE_LIMITS = {
  maxNameLength: 120,
  maxForwards: 16,
  maxJumpHops: 8,
  maxExtraOptions: 32,
  maxNotesLength: 2000,
} as const;

/** Validate a profile input; empty array = valid. */
export function validateProfileInput(
  input: TunnelProfileInput,
): readonly ProfileFinding[] {
  const findings: ProfileFinding[] = [];

  if (input.name.trim() === "") {
    findings.push({ path: "name", message: "name must not be blank", severity: "error" });
  }
  if (input.sshTarget.trim() === "") {
    findings.push({
      path: "sshTarget",
      message: "ssh target must not be blank (alias, user@host, or hostname)",
      severity: "error",
    });
  }
  if (input.forwards.length === 0) {
    findings.push({
      path: "forwards",
      message: "at least one forward rule is required",
      severity: "error",
    });
  }
  if (input.forwards.length > PROFILE_LIMITS.maxForwards) {
    findings.push({
      path: "forwards",
      message: `at most ${PROFILE_LIMITS.maxForwards} forwards per tunnel`,
      severity: "error",
    });
  }

  // Duplicate local bind ports inside one profile would make ssh fail.
  const seen = new Map<number, number>();
  input.forwards.forEach((rule, index) => {
    if (rule.kind !== "local" && rule.kind !== "dynamic") return;
    const first = seen.get(rule.bindPort);
    if (first !== undefined) {
      findings.push({
        path: `forwards.${index}.bindPort`,
        message: `port ${rule.bindPort} already used by forwards.${first} in this profile`,
        severity: "error",
      });
    } else {
      seen.set(rule.bindPort, index);
    }
  });

  // Remote forwards to loopback bind only reachable from the server itself.
  input.forwards.forEach((rule, index) => {
    if (rule.kind !== "remote") return;
    const bind = rule.bindAddress ?? "";
    if (bind === "" || bind === "localhost" || bind === "127.0.0.1" || bind === "::1") {
      findings.push({
        path: `forwards.${index}.bindAddress`,
        message:
          "remote forward binds loopback on the server: only the server itself can connect. Use 0.0.0.0 (needs GatewayPorts on the server) to expose it.",
        severity: "warning",
      });
    }
  });

  // Privileged local ports need root.
  input.forwards.forEach((rule, index) => {
    if (rule.kind !== "local" && rule.kind !== "dynamic") return;
    if (rule.bindPort < 1024) {
      findings.push({
        path: `forwards.${index}.bindPort`,
        message: `port ${rule.bindPort} is privileged (<1024) and needs root/admin to bind`,
        severity: "warning",
      });
    }
  });

  if (input.noRemoteCommand === false && !input.remoteCommand) {
    findings.push({
      path: "remoteCommand",
      message: "noRemoteCommand is false but no remoteCommand is set; ssh would open a shell",
      severity: "warning",
    });
  }
  if ((input.jumpHops?.length ?? 0) > PROFILE_LIMITS.maxJumpHops) {
    findings.push({
      path: "jumpHops",
      message: `at most ${PROFILE_LIMITS.maxJumpHops} jump hops`,
      severity: "error",
    });
  }
  if ((input.extraOptions?.length ?? 0) > PROFILE_LIMITS.maxExtraOptions) {
    findings.push({
      path: "extraOptions",
      message: `at most ${PROFILE_LIMITS.maxExtraOptions} extra -o options`,
      severity: "error",
    });
  }
  if ((input.notes?.length ?? 0) > PROFILE_LIMITS.maxNotesLength) {
    findings.push({ path: "notes", message: "notes too long", severity: "error" });
  }

  return findings;
}

/** Cross-profile check: two profiles wanting the same local port. */
export function findPortConflicts(
  profiles: readonly TunnelProfile[],
): readonly { readonly port: number; readonly profileIds: readonly string[] }[] {
  const byPort = new Map<number, string[]>();
  for (const profile of profiles) {
    for (const port of localBindPorts(profile)) {
      const list = byPort.get(port);
      if (list === undefined) byPort.set(port, [profile.id]);
      else list.push(profile.id);
    }
  }
  const conflicts: { port: number; profileIds: string[] }[] = [];
  for (const [port, ids] of byPort) {
    if (ids.length > 1) conflicts.push({ port, profileIds: ids });
  }
  return conflicts;
}
