/**
 * Executable lookup on the host `PATH`.
 *
 * This is the one place the host's path syntax matters: Windows separates
 * entries with `;` (splitting on `:` shreds `C:\Program Files\nodejs`) and
 * stores executables with an extension from `PATHEXT` (`node.exe`), so a bare
 * `join(dir, "node")` never resolves there. Everything is pure filesystem
 * probing — no candidate is ever executed.
 */
import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";

/** Default `PATHEXT` value, used when the environment does not carry one. */
const DEFAULT_PATH_EXTENSIONS = ".COM;.EXE;.BAT;.CMD";

export interface WhichOptions {
  /** Host platform; defaults to the running one. */
  readonly platform?: NodeJS.Platform;
  /** Value to search instead of `process.env.PATH`. */
  readonly pathValue?: string;
  /** Value to use instead of `process.env.PATHEXT` (Windows only). */
  readonly pathExtensions?: string;
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    // `X_OK` is a no-op on Windows (every file is "executable"), which is the
    // behaviour we want there: existence is the signal.
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * File names `command` may resolve to on `hostPlatform`.
 *
 * A command that already carries a known extension (`wt.exe`) is tried as
 * written, so both spellings work.
 */
export function executableNames(
  command: string,
  hostPlatform: NodeJS.Platform,
  pathExtensions: string = DEFAULT_PATH_EXTENSIONS,
): readonly string[] {
  if (hostPlatform !== "win32") return [command];
  const extensions = pathExtensions
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension !== "");
  const lower = command.toLowerCase();
  if (extensions.some((extension) => lower.endsWith(extension))) return [command];
  return extensions.map((extension) => `${command}${extension}`);
}

/**
 * Resolve `command` to an absolute path, or `undefined` when nothing matches.
 *
 * Empty `PATH` entries are skipped on purpose: an empty entry means "current
 * directory" to some shells, and a tunnel manager must not pick up a binary
 * from whatever directory it happens to start in.
 */
export function whichOnPath(
  command: string,
  options: WhichOptions = {},
): string | undefined {
  const hostPlatform = options.platform ?? platform();
  const pathValue = options.pathValue ?? process.env["PATH"] ?? "";
  const pathExtensions =
    options.pathExtensions ?? process.env["PATHEXT"] ?? DEFAULT_PATH_EXTENSIONS;
  const names = executableNames(command, hostPlatform, pathExtensions);
  // Derived from the platform rather than `path.delimiter` so the whole
  // function can be told which host it is looking at, which is the only way to
  // test the Windows branch from a POSIX machine.
  const separator = hostPlatform === "win32" ? ";" : ":";
  for (const dir of pathValue.split(separator)) {
    if (dir === "") continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}
