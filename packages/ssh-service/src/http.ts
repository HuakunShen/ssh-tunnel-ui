/**
 * Hono HTTP API for the tunnel daemon. Every handler validates input with the
 * contract schemas up front (400 on failure) and maps `TunnelError.code` to
 * its exhaustive HTTP status — one code is always one status.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  TUNNEL_STATUS_BY_CODE,
  TunnelError,
  healthResponseSchema,
  hostListResponseSchema,
  launchRequestSchema,
  launchResponseSchema,
  openUrlRequestSchema,
  openUrlResponseSchema,
  previewResponseSchema,
  profileInputSchema,
  profileListResponseSchema,
  stateListResponseSchema,
  terminalListResponseSchema,
  tunnelStateSchema,
  type TunnelProblemCode,
  type TunnelProfile,
} from "@ssh-tunnel/contract";
import { readSshConfigHosts } from "@ssh-tunnel/host-node";
import type { TunnelManager } from "./manager.js";

export const SERVICE_VERSION = "0.1.0";

function problemBody(code: TunnelProblemCode, message: string, retryable: boolean, details?: Record<string, string | number | boolean>): Response {
  const status = TUNNEL_STATUS_BY_CODE[code];
  return Response.json(
    {
      problem: {
        code,
        message,
        retryable,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status },
  );
}

function toResponse(error: unknown): Response {
  if (error instanceof TunnelError) {
    const problem = error.toProblem();
    const details: Record<string, string | number | boolean> | undefined =
      problem.details === undefined ? undefined : { ...problem.details };
    return problemBody(problem.code, problem.message, problem.retryable, details);
  }
  const message = error instanceof Error ? error.message : "unknown failure";
  return problemBody("InternalError", message, false);
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    throw new TunnelError("InvalidRequest", "request body must be JSON");
  }
}

export interface ServiceContext {
  readonly manager: TunnelManager;
  readonly serviceInstanceId: string;
  readonly webDir?: string;
}

export function createServiceApp(context: ServiceContext): Hono {
  const app = new Hono();
  app.use("/api/*", cors());

  app.get("/api/health", (c) => {
    const body = { ok: true as const, version: SERVICE_VERSION, serviceInstanceId: context.serviceInstanceId };
    const checked = healthResponseSchema.safeParse(body);
    if (!checked.success) return toResponse(new TunnelError("InternalError", "health shape drifted"));
    return c.json(checked.data);
  });

  app.get("/api/profiles", async (c) => {
    try {
      const profiles = await context.manager.listProfiles();
      const checked = profileListResponseSchema.safeParse({ profiles: [...profiles] });
      if (!checked.success) return toResponse(new TunnelError("InternalError", "profile list shape drifted"));
      return c.json(checked.data);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.post("/api/profiles", async (c) => {
    try {
      const body = await parseJson(c.req.raw);
      const parsed = profileInputSchema.safeParse(body);
      if (!parsed.success) {
        return toResponse(new TunnelError("InvalidRequest", "profile input is malformed"));
      }
      const created = await context.manager.createProfile(parsed.data);
      return c.json(created, 201);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.get("/api/profiles/:id", async (c) => {
    try {
      const profile: TunnelProfile = await context.manager.getProfile(c.req.param("id"));
      return c.json(profile);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.put("/api/profiles/:id", async (c) => {
    try {
      const body = await parseJson(c.req.raw);
      const parsed = profileInputSchema.safeParse(body);
      if (!parsed.success) {
        return toResponse(new TunnelError("InvalidRequest", "profile input is malformed"));
      }
      const updated = await context.manager.updateProfile(c.req.param("id"), parsed.data);
      return c.json(updated);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.delete("/api/profiles/:id", async (c) => {
    try {
      await context.manager.deleteProfile(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      return toResponse(error);
    }
  });

  app.get("/api/profiles/:id/preview", async (c) => {
    try {
      const id = c.req.param("id");
      const { argv, command } = context.manager.preview(id);
      const checked = previewResponseSchema.safeParse({ profileId: id, argv: [...argv], command });
      if (!checked.success) return toResponse(new TunnelError("InternalError", "preview shape drifted"));
      return c.json(checked.data);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.get("/api/terminals", (c) => {
    const checked = terminalListResponseSchema.safeParse({
      terminals: [...context.manager.listTerminals()],
    });
    if (!checked.success) {
      return toResponse(new TunnelError("InternalError", "terminal list shape drifted"));
    }
    return c.json(checked.data);
  });

  app.post("/api/open-url", async (c) => {
    try {
      const parsed = openUrlRequestSchema.safeParse(await parseJson(c.req.raw));
      if (!parsed.success) {
        throw new TunnelError("InvalidRequest", "open-url needs a url");
      }
      const opened = context.manager.openUrl(parsed.data.url);
      const checked = openUrlResponseSchema.safeParse(opened);
      if (!checked.success) {
        return toResponse(new TunnelError("InternalError", "open-url shape drifted"));
      }
      return c.json(checked.data);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.post("/api/profiles/:id/launch", async (c) => {
    try {
      const parsed = launchRequestSchema.safeParse(await parseJson(c.req.raw));
      if (!parsed.success) {
        throw new TunnelError("InvalidRequest", "launch needs a terminalId");
      }
      const session = await context.manager.launchInTerminal(
        c.req.param("id"),
        parsed.data.terminalId,
        parsed.data.mode ?? "tunnel",
      );
      const checked = launchResponseSchema.safeParse(session);
      if (!checked.success) {
        return toResponse(new TunnelError("InternalError", "launch shape drifted"));
      }
      return c.json(checked.data);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.delete("/api/profiles/:id/session", (c) => {
    const closed = context.manager.closeSession(c.req.param("id"));
    if (!closed) {
      return toResponse(
        new TunnelError("NotFound", "no terminal session for this profile", {
          details: { profileId: c.req.param("id") },
        }),
      );
    }
    return c.json({ ok: true as const });
  });

  app.get("/api/states", async (c) => {
    try {
      const states = await context.manager.listStates();
      const checked = stateListResponseSchema.safeParse({ states: [...states] });
      if (!checked.success) return toResponse(new TunnelError("InternalError", "state list shape drifted"));
      return c.json(checked.data);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.get("/api/states/:id", async (c) => {
    try {
      const state = await context.manager.getState(c.req.param("id"));
      const checked = tunnelStateSchema.safeParse({ ...state });
      if (!checked.success) return toResponse(new TunnelError("InternalError", "state shape drifted"));
      return c.json(checked.data);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.post("/api/states/:id/start", async (c) => {
    try {
      const state = await context.manager.start(c.req.param("id"));
      return c.json(state);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.post("/api/states/:id/stop", async (c) => {
    try {
      const state = await context.manager.stop(c.req.param("id"));
      return c.json(state);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.post("/api/states/stop-all", async (c) => {
    try {
      const states = await context.manager.stopAll();
      return c.json({ states: [...states] });
    } catch (error) {
      return toResponse(error);
    }
  });

  app.post("/api/states/:id/probe", async (c) => {
    try {
      const state = await context.manager.probe(c.req.param("id"));
      return c.json(state);
    } catch (error) {
      return toResponse(error);
    }
  });

  app.get("/api/ssh-hosts", (c) => {
    try {
      const hosts = readSshConfigHosts();
      const checked = hostListResponseSchema.safeParse({ hosts });
      if (!checked.success) return toResponse(new TunnelError("InternalError", "host list shape drifted"));
      return c.json(checked.data);
    } catch (error) {
      return toResponse(error);
    }
  });

  return app;
}
