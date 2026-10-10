/**
 * Node `ProbePort`: TCP dial health checks for forwarded endpoints. Local and
 * dynamic forwards are dialed directly; remote forwards are probed via
 * `ssh target true` only when asked (the prober reports loopback binds as
 * unknown rather than failed — the server side is not dialable from here).
 */
import { connect } from "node:net";
import type { ProbePort } from "./ports.js";

export function createNodeProbePort(): ProbePort {
  return {
    dialTcp(host, port, timeoutMs): Promise<{
      readonly ok: boolean;
      readonly latencyMs?: number;
      readonly detail?: string;
    }> {
      return new Promise((resolve) => {
        const started = Date.now();
        const socket = connect({ host, port });
        let settled = false;
        const done = (result: {
          readonly ok: boolean;
          readonly latencyMs?: number;
          readonly detail?: string;
        }): void => {
          if (settled) return;
          settled = true;
          socket.destroy();
          resolve(result);
        };
        socket.setTimeout(timeoutMs);
        socket.on("connect", () => {
          done({ ok: true, latencyMs: Date.now() - started });
        });
        socket.on("timeout", () => {
          done({ ok: false, detail: `dial ${host}:${port} timed out after ${timeoutMs}ms` });
        });
        socket.on("error", (error: Error) => {
          done({ ok: false, detail: `dial ${host}:${port}: ${error.message}` });
        });
      });
    },
  };
}
