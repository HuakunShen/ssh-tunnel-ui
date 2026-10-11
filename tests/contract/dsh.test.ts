/**
 * DSH plugin host-half tests: the plugin mounts on a fake Harness webServer
 * and answers context + API routes with loopback guards. Same manager, same
 * Hono app as the daemon — no second implementation.
 */
import { describe, expect, it } from "vitest";
import { apply, inject } from "dsh-plugin-ssh-tunnel";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

interface Registered {
  readonly kind: string;
  readonly path: string;
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void;
}

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeContext(): {
  routes: Registered[];
  apply: () => void;
} {
  const home = join(tmpdir(), `ssh-tunnel-dsh-test-${process.pid}`);
  mkdirSync(home, { recursive: true });
  process.env["SSH_TUNNEL_HOME"] = home;
  const routes: Registered[] = [];
  const ctx = {
    logger: {
      info(): void {},
      warn(): void {},
      error(): void {},
    },
    get(name: string): unknown {
      if (name === "webServer") {
        return {
          port: 19999,
          register(route: Registered): () => void {
            routes.push(route);
            return () => undefined;
          },
        };
      }
      return undefined;
    },
    effect(install: () => void | (() => void)): unknown {
      install();
      return undefined;
    },
  };
  return {
    routes,
    apply(): void {
      // apply expects the harness HostContext; our structural double matches it.
      apply(ctx as Parameters<typeof apply>[0]);
    },
  };
}

function fakeReq(url: string, method = "GET", headers: Record<string, string> = {}): IncomingMessage {
  const stream = new Readable({ read(): void {} });
  (stream as unknown as Record<string, unknown>)["url"] = url;
  (stream as unknown as Record<string, unknown>)["method"] = method;
  (stream as unknown as Record<string, unknown>)["headers"] = {
    host: "127.0.0.1:19999",
    ...headers,
  };
  return stream as unknown as IncomingMessage;
}

function call(
  handler: Registered["handler"],
  url: string,
  method = "GET",
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const req = fakeReq(url, method);
    const chunks: string[] = [];
    const res = {
      status: 0,
      writeHead(status: number): void {
        res.status = status;
      },
      write(chunk: unknown): void {
        chunks.push(String(chunk));
      },
      end(chunk?: unknown): void {
        if (chunk !== undefined) chunks.push(String(chunk));
        resolve({ status: res.status, body: chunks.join("") });
      },
    } as unknown as ServerResponse;
    handler(req, res);
    if (body !== undefined) {
      (req as unknown as Readable).push(body);
    }
    (req as unknown as Readable).push(null);
  });
}

describe("dsh plugin host half", () => {
  it("declares the webServer injection", () => {
    expect(inject).toContain("webServer");
  });

  it("mounts a prefix route and answers context + health", async () => {
    const { routes, apply: run } = makeContext();
    run();
    expect(routes.map((r) => `${r.kind} ${r.path}`)).toContain("prefix /ssh-tunnel");
    const handler = routes[0]?.handler;
    if (handler === undefined) throw new Error("no handler registered");

    const context = await call(handler, "/ssh-tunnel/dsh/context");
    expect(context.status).toBe(200);
    expect(JSON.parse(context.body) as unknown).toEqual({ panelUrl: "/ssh-tunnel/" });

    const health = await call(handler, "/ssh-tunnel/api/health");
    expect(health.status).toBe(200);
    expect((JSON.parse(health.body) as { ok: boolean }).ok).toBe(true);
  });

  it("serves the panel document shell instead of 404", async () => {
    const { routes, apply: run } = makeContext();
    run();
    const handler = routes[0]?.handler;
    if (handler === undefined) throw new Error("no handler registered");

    // The frame URL from /dsh/context must resolve to a document.
    const doc = await call(handler, "/ssh-tunnel/");
    expect(doc.status).toBe(200);
    expect(doc.body).toContain("<!doctype html>");
  });

  it("proxies profile CRUD to the in-process manager", async () => {
    const { routes, apply: run } = makeContext();
    run();
    const handler = routes[0]?.handler;
    if (handler === undefined) throw new Error("no handler registered");

    const created = await call(
      handler,
      "/ssh-tunnel/api/profiles",
      "POST",
      JSON.stringify({
        name: "dsh-test",
        mode: "local",
        sshTarget: "ufo",
        forwards: [{ kind: "local", bindPort: 18181, targetHost: "127.0.0.1", targetPort: 22 }],
      }),
    );
    expect(created.status).toBe(201);
    const id = (JSON.parse(created.body) as { id: string }).id;

    const listed = await call(handler, "/ssh-tunnel/api/profiles");
    expect(listed.status).toBe(200);
    expect(listed.body).toContain("dsh-test");

    const preview = await call(handler, `/ssh-tunnel/api/profiles/${id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body).toContain("-L");
  });

  it("refuses cross-site requests", async () => {
    const { routes, apply: run } = makeContext();
    run();
    const handler = routes[0]?.handler;
    if (handler === undefined) throw new Error("no handler registered");
    const answer = await new Promise<{ status: number; body: string }>((resolve) => {
      const req = fakeReq("/ssh-tunnel/api/health", "GET", {
        origin: "https://evil.example",
      });
      const chunks: string[] = [];
      const res = {
        status: 0,
        writeHead(status: number): void {
          res.status = status;
        },
        write(chunk: unknown): void {
          chunks.push(String(chunk));
        },
        end(chunk?: unknown): void {
          if (chunk !== undefined) chunks.push(String(chunk));
          resolve({ status: res.status, body: chunks.join("") });
        },
      } as unknown as ServerResponse;
      handler(req, res);
      (req as unknown as Readable).push(null);
    });
    expect(answer.status).toBe(403);
  });
});
