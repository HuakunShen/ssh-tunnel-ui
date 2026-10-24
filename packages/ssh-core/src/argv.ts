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

/** Extras the daemon adds for one specific run, never for the advertised one. */
export interface ArgvOptions {
  /**
   * Absolute path of this tunnel's `ControlMaster` socket. Adds
   * `-o ControlMaster=yes -o ControlPath=… -o ControlPersist=no`, so the
   * process reports `ssh -O check` and accepts `ssh -O exit` later.
   */
  readonly controlPath?: string;
  /** Give the terminal an interactive login shell instead of `-N`. */
  readonly interactive?: boolean;
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
 *
 * `options` only ever *adds* to the default vector, so the command a profile
 * advertises (copy/preview) stays byte-identical to what a plain `ssh` run
 * would be. The daemon passes `controlPath` when the command is handed to a
 * terminal, which is what lets it check and stop a tunnel it no longer owns.
 */
export function buildSshArgv(
  profile: TunnelProfile,
  options: ArgvOptions = {},
): ArgvBuildResult {
  const argv: string[] = [];

  // Batch + non-interactive first so a missing key fails fast, not on a prompt.
  // An interactive shell is the exception: the whole point of that window is
  // that the user can answer a password prompt, and ssh keeps the *first* value
  // it sees for a repeated option, so this one cannot be overridden later.
  if (options.interactive !== true) {
    argv.push("-o", "BatchMode=yes");
  }
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

  if (options.controlPath !== undefined && options.controlPath !== "") {
    // One master per profile: the socket is how a later `ssh -O check`/`exit`
    // finds this very process, even when a terminal owns it instead of us.
    argv.push(
      "-o",
      "ControlMaster=yes",
      "-o",
      `ControlPath=${options.controlPath}`,
      "-o",
      "ControlPersist=no",
    );
  }

  argv.push(sshDestination(profile));

  if (options.interactive === true) {
    // No `-N`: ssh asks for the login shell, and the forwards live exactly as
    // long as that session does.
  } else if (profile.noRemoteCommand === false && profile.remoteCommand) {
    argv.push(profile.remoteCommand);
  } else {
    argv.push("-N");
  }

  return { argv, command: quoteForDisplay(argv) };
}

/** `user@host` as the profile asks for it; also what `-O` commands need. */
export function sshDestination(profile: TunnelProfile): string {
  return profile.sshUser !== undefined && profile.sshUser !== ""
    ? `${profile.sshUser}@${profile.sshTarget.replace(/^[^@]+@/, "")}`
    : profile.sshTarget;
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
