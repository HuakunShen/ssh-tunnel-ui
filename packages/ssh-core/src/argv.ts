/**
 * `ssh` argv builder — turns a validated profile into the exact argument
 * vector the host layer spawns. Pure function, no I/O, fully unit-testable.
 *
 * Covers the whole SSH forwarding surface:
 * - `-L [bind:]port:host:hostport` (local)
 * - `-R [bind:]port:host:hostport` (remote)
 * - `-D [bind:]port` (dynamic SOCKS)
 * - `-J hop1,hop2` (jump/bastion, combinable with any forward kind)
 * - multiple forwards per process, extra `-o` options, identity file,
 *   keepalive, ExitOnForwardFailure, ClearAllForwardings, `-N`/remote command.
 */
import type { ForwardRule, TunnelProfile } from "@ssh-tunnel/contract";

export interface ArgvBuildResult {
  readonly argv: readonly string[];
  readonly command: string;
}

/** Quote one argv element for display only (never for execution). */
export function quoteForDisplay(argv: readonly string[]): string {
  return ["ssh", ...argv]
    .map((part) =>
      /^[A-Za-z0-9_@%+=:,./-]+$/.test(part)
        ? part
        : `'${part.replace(/'/g, `'\\''`)}'`,
    )
    .join(" ");
}

function forwardSpec(rule: ForwardRule): string {
  const bind =
    rule.bindAddress === undefined || rule.bindAddress === ""
      ? ""
      : `${rule.bindAddress}:`;
  switch (rule.kind) {
    case "local":
      return `${bind}${rule.bindPort}:${rule.targetHost}:${rule.targetPort}`;
    case "remote":
      return `${bind}${rule.bindPort}:${rule.targetHost}:${rule.targetPort}`;
    case "dynamic":
      return `${bind}${rule.bindPort}`;
  }
}

function flagFor(rule: ForwardRule): "-L" | "-R" | "-D" {
  switch (rule.kind) {
    case "local":
      return "-L";
    case "remote":
      return "-R";
    case "dynamic":
      return "-D";
  }
}

/**
 * Build the argv for `ssh` (without the executable name itself).
 * Throws nothing: callers must pass a schema-validated profile.
 */
export function buildSshArgv(profile: TunnelProfile): ArgvBuildResult {
  const argv: string[] = [];

  // Batch + non-interactive first so a missing key fails fast, not on a prompt.
  argv.push("-o", "BatchMode=yes");
  argv.push("-o", "StrictHostKeyChecking=accept-new");

  if (profile.exitOnForwardFailure !== false) {
    argv.push("-o", "ExitOnForwardFailure=yes");
  }
  if (profile.clearAllForwardings === true) {
    argv.push("-o", "ClearAllForwardings=yes");
  }

  const keepalive = profile.serverAliveInterval ?? 30;
  if (keepalive > 0) {
    argv.push("-o", `ServerAliveInterval=${keepalive}`);
    argv.push("-o", "ServerAliveCountMax=3");
  }

  if (profile.sshPort !== undefined) {
    argv.push("-p", String(profile.sshPort));
  }
  if (profile.identityFile !== undefined && profile.identityFile !== "") {
    argv.push("-i", profile.identityFile);
  }
  if (profile.jumpHops !== undefined && profile.jumpHops.length > 0) {
    argv.push("-J", profile.jumpHops.join(","));
  }

  for (const rule of profile.forwards) {
    argv.push(flagFor(rule), forwardSpec(rule));
  }

  for (const opt of profile.extraOptions ?? []) {
    argv.push("-o", `${opt.key}=${opt.value}`);
  }

  const destination =
    profile.sshUser !== undefined && profile.sshUser !== ""
      ? `${profile.sshUser}@${profile.sshTarget.replace(/^[^@]+@/, "")}`
      : profile.sshTarget;
  argv.push(destination);

  if (profile.noRemoteCommand === false && profile.remoteCommand) {
    argv.push(profile.remoteCommand);
  } else {
    argv.push("-N");
  }

  return { argv, command: quoteForDisplay(argv) };
}

/** All local bind ports this profile will listen on (for conflict checks). */
export function localBindPorts(profile: TunnelProfile): readonly number[] {
  const ports: number[] = [];
  for (const rule of profile.forwards) {
    if (rule.kind === "local" || rule.kind === "dynamic") {
      ports.push(rule.bindPort);
    }
  }
  return ports;
}
