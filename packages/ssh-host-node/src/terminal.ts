/**
 * Terminal discovery + launch — the "Open in…" affordance.
 *
 * The daemon spawns the terminal *itself* and keeps the pid, so an external
 * session stays manageable (Close ends it) even though the user may also close
 * the window freely. Health never depends on the terminal process: it is
 * measured by probing the forwarded ports, so a hand-closed window is a clean,
 * accurate state rather than a leak.
 *
 * Only terminals whose CLI accepts "run this one command" are offered, and
 * discovery is pure filesystem probing — nothing here runs a candidate.
 */
import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import type { TerminalPort, TerminalTargetInfo } from "./ports.js";

/** A terminal the daemon knows how to launch with a single command. */
interface TerminalTarget extends TerminalTargetInfo {
  /** Executable to spawn; resolved from PATH unless `absolutePath` is set. */
  readonly command: string;
  readonly absolutePath?: string;
  /** Build argv for launching `commandLine` (already display-quoted). */
  argvFor(commandLine: string): readonly string[];
}

function canRead(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function whichOnPath(command: string): string | undefined {
  const path = process.env["PATH"] ?? "";
  for (const dir of path.split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, command);
    try {
      if (statSync(candidate).isFile() && canRead(candidate)) return candidate;
    } catch {
      // Not this directory.
    }
  }
  return undefined;
}

function inApplications(app: string): string | undefined {
  const home = homedir();
  for (const dir of ["/Applications", join(home, "Applications")]) {
    const candidate = join(dir, `${app}.app`, "Contents", "MacOS", app);
    if (canRead(candidate)) return candidate;
  }
  return undefined;
}

const macTargets: readonly TerminalTarget[] = [
  {
    id: "terminal",
    label: "Terminal",
    hint: "com.apple.Terminal",
    platform: "darwin",
    command: "open",
    argvFor: (cmd) => ["-a", "Terminal", "/bin/zsh", "-lc", cmd],
  },
  {
    id: "iterm2",
    label: "iTerm2",
    hint: "com.googlecode.iterm2",
    platform: "darwin",
    command: "open",
    argvFor: (cmd) => ["-a", "iTerm", "/bin/zsh", "-lc", cmd],
  },
  {
    id: "warp",
    label: "Warp",
    hint: "dev.warp.Warp-Stable",
    platform: "darwin",
    command: "open",
    argvFor: (cmd) => ["-a", "Warp", "--", "/bin/zsh", "-lc", cmd],
  },
  {
    id: "ghostty",
    label: "Ghostty",
    hint: "com.mitchellh.ghostty",
    platform: "darwin",
    command: "open",
    argvFor: (cmd) => ["-a", "Ghostty", "--", "/bin/zsh", "-lc", cmd],
  },
  {
    id: "kitty",
    label: "kitty",
    hint: "kitty",
    platform: "darwin",
    command: "kitty",
    argvFor: (cmd) => ["--", "/bin/zsh", "-lc", cmd],
  },
  {
    id: "wezterm",
    label: "WezTerm",
    hint: "com.github.wez.wezterm",
    platform: "darwin",
    command: "wezterm",
    argvFor: (cmd) => ["start", "--", "/bin/zsh", "-lc", cmd],
  },
  {
    id: "alacritty",
    label: "Alacritty",
    hint: "org.alacritty",
    platform: "darwin",
    command: "alacritty",
    argvFor: (cmd) => ["--", "/bin/zsh", "-lc", cmd],
  },
  {
    id: "vscode",
    label: "VS Code",
    hint: "com.microsoft.VSCode",
    platform: "darwin",
    command: "code",
    argvFor: (cmd) => ["--new-window", "/bin/zsh", "-lc", cmd],
  },
];

const linuxTargets: readonly TerminalTarget[] = [
  {
    id: "gnome-terminal",
    label: "GNOME Terminal",
    hint: "gnome-terminal",
    platform: "linux",
    command: "gnome-terminal",
    argvFor: (cmd) => ["--", "/bin/sh", "-lc", cmd],
  },
  {
    id: "konsole",
    label: "Konsole",
    hint: "org.kde.konsole",
    platform: "linux",
    command: "konsole",
    argvFor: (cmd) => ["-e", "/bin/sh", "-lc", cmd],
  },
  {
    id: "alacritty",
    label: "Alacritty",
    hint: "org.alacritty",
    platform: "linux",
    command: "alacritty",
    argvFor: (cmd) => ["--", "/bin/sh", "-lc", cmd],
  },
  {
    id: "kitty",
    label: "kitty",
    hint: "kitty",
    platform: "linux",
    command: "kitty",
    argvFor: (cmd) => ["--", "/bin/sh", "-lc", cmd],
  },
  {
    id: "xterm",
    label: "XTerm",
    hint: "xterm",
    platform: "linux",
    command: "xterm",
    argvFor: (cmd) => ["-e", "/bin/sh", "-lc", cmd],
  },
];

const windowsTargets: readonly TerminalTarget[] = [
  {
    id: "windows-terminal",
    label: "Windows Terminal",
    hint: "wt.exe",
    platform: "win32",
    command: "wt.exe",
    argvFor: (cmd) => ["new-tab", "--title", "SSH Tunnel", "cmd.exe", "/c", cmd],
  },
  {
    id: "powershell",
    label: "PowerShell",
    hint: "powershell.exe",
    platform: "win32",
    command: "powershell.exe",
    argvFor: (cmd) => ["-NoExit", "-Command", cmd],
  },
];

/**
 * `.app` bundle names proving installation — a terminal may exist with no PATH
 * shim (Warp ships none by default), so the bundle is the real signal.
 */
const macBundleProbe: Readonly<Record<string, readonly string[]>> = {
  terminal: ["Terminal"],
  iterm2: ["iTerm"],
  warp: ["Warp"],
  ghostty: ["Ghostty"],
  kitty: ["kitty"],
  wezterm: ["WezTerm"],
  alacritty: ["Alacritty"],
  vscode: ["Visual Studio Code"],
};

/**
 * Detect installed terminals for `hostPlatform`. macOS resolves the `.app`
 * bundle; Linux and Windows probe the executable on PATH.
 */
export function detectTerminals(
  hostPlatform: NodeJS.Platform = platform(),
): readonly TerminalTarget[] {
  const table =
    hostPlatform === "darwin"
      ? macTargets
      : hostPlatform === "win32"
        ? windowsTargets
        : linuxTargets;

  const found: TerminalTarget[] = [];
  for (const target of table) {
    let absolutePath: string | undefined;
    if (hostPlatform === "darwin") {
      for (const app of macBundleProbe[target.id] ?? []) {
        absolutePath = inApplications(app);
        if (absolutePath !== undefined) break;
      }
      // Bundle apps launch through `open -a`, which needs no PATH entry.
      if (absolutePath === undefined && target.command !== "open") continue;
    } else if (whichOnPath(target.command) === undefined) {
      continue;
    }
    found.push(
      absolutePath === undefined ? target : { ...target, absolutePath },
    );
  }
  return found;
}

/**
 * A launchable session the daemon owns: the terminal process it spawned, so it
 * can be ended on demand. Kept distinct from the managed `ssh` child so we
 * never claim to supervise a GUI app beyond its launcher pid.
 */
export interface ExternalSession {
  readonly profileId: string;
  readonly terminalId: string;
  /** Keyed as `command` so it matches the wire contract directly. */
  readonly command: string;
  readonly pid: number;
  readonly launchedAt: string;
}

export function createTerminalPort(
  hostPlatform: NodeJS.Platform = platform(),
): TerminalPort {
  const targets = detectTerminals(hostPlatform);

  const find = (terminalId: string): TerminalTarget => {
    const target = targets.find((candidate) => candidate.id === terminalId);
    if (target === undefined) {
      throw new Error(`terminal ${terminalId} is not installed on this machine`);
    }
    return target;
  };

  return {
    detect(): readonly TerminalTargetInfo[] {
      return targets.map(({ id, label, hint, platform: p }) => ({
        id,
        label,
        hint,
        platform: p,
      }));
    },

    launch(terminalId: string, commandLine: string): number {
      const target = find(terminalId);
      const child = spawn(target.command, [...target.argvFor(commandLine)], {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => {
        // The launcher exited immediately (app missing, PATH wrong). Nothing to
        // clean up: the tunnel runs inside the terminal, not under this pid.
      });
      child.unref();
      return child.pid ?? -1;
    },

    close(pid: number): void {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone — the user may have closed the window themselves.
      }
    },
  };
}