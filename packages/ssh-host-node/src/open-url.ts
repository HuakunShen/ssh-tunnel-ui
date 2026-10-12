/**
 * Handing a URL to the operating system's default handler.
 *
 * The daemon does this rather than the page because a webview treats a plain
 * anchor as an in-app navigation. Opening here also means the browser build,
 * the desktop app and any future plugin host all resolve "open it" the same
 * way, through the one place that knows which command the platform uses.
 */
import { spawn } from "node:child_process";
import { platform } from "node:os";

import type { OpenUrlPort } from "./ports.js";

/**
 * Only `http` and `https` are ever handed to the OS.
 *
 * A caller could pass `file:`, a custom scheme, or something with shell
 * metacharacters in it. Since this value ends up on a command line, the
 * allow-list is the security boundary, not a nicety: anything else is refused
 * rather than escaped.
 */
const OPENABLE_SCHEME = /^https?:\/\//i;

export function isOpenableUrl(url: string): boolean {
  return OPENABLE_SCHEME.test(url);
}

/**
 * Arguments for `open`. Passing a URL as its own argv entry means it is never
 * concatenated into a shell string, so no quoting can be got wrong.
 */
function darwinCommand(url: string): { readonly file: string; readonly args: readonly string[] } {
  return { file: "open", args: [url] };
}

function windowsCommand(url: string): { readonly file: string; readonly args: readonly string[] } {
  // `start` is a cmd builtin, so the empty string is the window title. The
  // `""`-prefixed form keeps cmd from treating the URL as its own option.
  return { file: "cmd.exe", args: ["/c", "start", "", url] };
}

export function createOpenUrlPort(): OpenUrlPort {
  return {
    open(url: string): void {
      if (!isOpenableUrl(url)) {
        throw new Error("refusing to open a non-http url");
      }
      const system = platform();
      const { file, args } =
        system === "darwin"
          ? darwinCommand(url)
          : system === "win32"
            ? windowsCommand(url)
            : { file: "xdg-open", args: [url] as const };
      const child = spawn(file, args, {
        // The handler outlives the request; never let it hold the daemon open.
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      child.on("error", (error: Error) => {
        throw error;
      });
    },
  };
}
