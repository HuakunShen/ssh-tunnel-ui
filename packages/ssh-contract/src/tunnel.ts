/**
 * Tunnel profile + runtime state schemas. This is the single source of truth
 * every front (TUI, Web, CLI, DSH, VS Code) shares: DTO types are inferred
 * backwards via `z.infer`, so the wire and the types cannot drift apart.
 *
 * Requests use `strictObject` (unknown keys rejected); responses may be read
 * with `.loose()` by clients for forward compatibility.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Forward rules: one discriminated union, discriminant `kind`.
// ---------------------------------------------------------------------------

const bindAddressSchema = z
  .string()
  .min(1)
  .max(255)
  .describe("Bind address: IP, hostname, empty (=loopback), or unix socket path");

const portSchema = z
  .number()
  .int()
  .min(1)
  .max(65535)
  .describe("TCP port 1-65535");

const hostSchema = z.string().min(1).max(255);

export const localForwardSchema = z.strictObject({
  kind: z.literal("local"),
  bindAddress: z.string().max(255).optional(),
  bindPort: portSchema,
  targetHost: hostSchema,
  targetPort: portSchema,
});

export const remoteForwardSchema = z.strictObject({
  kind: z.literal("remote"),
  bindAddress: z.string().max(255).optional(),
  bindPort: portSchema,
  targetHost: hostSchema,
  targetPort: portSchema,
});

export const dynamicForwardSchema = z.strictObject({
  kind: z.literal("dynamic"),
  bindAddress: z.string().max(255).optional(),
  bindPort: portSchema,
});

export const forwardSchema = z.discriminatedUnion("kind", [
  localForwardSchema,
  remoteForwardSchema,
  dynamicForwardSchema,
]);

export type ForwardRule = z.infer<typeof forwardSchema>;

// ---------------------------------------------------------------------------
// Tunnel mode: which ssh data-plane shape a profile uses.
// ---------------------------------------------------------------------------

export const TUNNEL_MODES = [
  "local",
  "remote",
  "dynamic",
  "jump",
  "multi",
] as const;

export type TunnelMode = (typeof TUNNEL_MODES)[number];

export const tunnelModeSchema = z.enum(TUNNEL_MODES);

// ---------------------------------------------------------------------------
// Profile: the persisted, user-named unit. One profile = one `ssh` process.
// ---------------------------------------------------------------------------

const sshOptionSchema = z.strictObject({
  key: z.string().min(1).max(128),
  value: z.string().min(1).max(1024),
});

export const tunnelProfileSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  mode: tunnelModeSchema,
  /** `user@host`, SSH config alias, or full `ssh://` destination. */
  sshTarget: z.string().min(1).max(512),
  sshPort: portSchema.optional(),
  sshUser: z.string().min(1).max(128).optional(),
  identityFile: z.string().min(1).max(1024).optional(),
  /** Bastion hops for `-J hop1,hop2`. Empty = direct. */
  jumpHops: z.array(z.string().min(1).max(512)).max(8).optional(),
  forwards: z.array(forwardSchema).min(1).max(16),
  extraOptions: z.array(sshOptionSchema).max(32).optional(),
  serverAliveInterval: z.number().int().min(0).max(3600).optional(),
  exitOnForwardFailure: z.boolean().optional(),
  clearAllForwardings: z.boolean().optional(),
  /** Default true: `-N` (no remote command). False with `remoteCommand` runs one. */
  noRemoteCommand: z.boolean().optional(),
  remoteCommand: z.string().min(1).max(2048).optional(),
  autoReconnect: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
});

export type TunnelProfile = z.infer<typeof tunnelProfileSchema>;

/** Client-supplied fields for create/update (server stamps id + timestamps). */
export const profileInputSchema = tunnelProfileSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type TunnelProfileInput = z.infer<typeof profileInputSchema>;

// ---------------------------------------------------------------------------
// Runtime state.
// ---------------------------------------------------------------------------

export const TUNNEL_STATUSES = [
  "stopped",
  "starting",
  "running",
  "degraded",
  "failed",
  "stopping",
] as const;

export type TunnelStatus = (typeof TUNNEL_STATUSES)[number];

export const tunnelStatusSchema = z.enum(TUNNEL_STATUSES);

export const forwardHealthSchema = z.strictObject({
  kind: z.enum(["local", "remote", "dynamic"]),
  bindPort: portSchema,
  ok: z.boolean(),
  latencyMs: z.number().nonnegative().optional(),
  detail: z.string().max(500).optional(),
});

export type ForwardHealth = z.infer<typeof forwardHealthSchema>;

export const tunnelStateSchema = z.strictObject({
  profileId: z.string().min(1).max(64),
  status: tunnelStatusSchema,
  pid: z.number().int().positive().optional(),
  startedAt: z.string().optional(),
  lastError: z.string().max(2000).optional(),
  forwards: z.array(forwardHealthSchema),
  /** The exact argv the running process was started with (for inspect). */
  argv: z.array(z.string()).optional(),
});

export type TunnelState = z.infer<typeof tunnelStateSchema>;

// ---------------------------------------------------------------------------
// SSH host inventory (read from the user's own ~/.ssh/config, read-only).
// ---------------------------------------------------------------------------

export const sshHostInfoSchema = z.strictObject({
  alias: z.string().min(1).max(256),
  hostName: z.string().max(512).optional(),
  user: z.string().max(128).optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

export type SshHostInfo = z.infer<typeof sshHostInfoSchema>;

// ---------------------------------------------------------------------------
// API envelopes.
// ---------------------------------------------------------------------------

export const profileListResponseSchema = z.strictObject({
  profiles: z.array(tunnelProfileSchema),
});

export const stateListResponseSchema = z.strictObject({
  states: z.array(tunnelStateSchema),
});

export const hostListResponseSchema = z.strictObject({
  hosts: z.array(sshHostInfoSchema),
});

export const previewResponseSchema = z.strictObject({
  profileId: z.string().min(1).max(64),
  argv: z.array(z.string()),
  command: z.string(),
});

/** A terminal the host can launch a tunnel command in. */
export const terminalTargetSchema = z.strictObject({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(48),
  hint: z.string().max(96),
  platform: z.string().min(1).max(16),
});

export const terminalListResponseSchema = z.strictObject({
  terminals: z.array(terminalTargetSchema),
});

export const launchRequestSchema = z.strictObject({
  terminalId: z.string().min(1).max(32),
});

/**
 * A command handed to a real terminal app. The daemon spawned that app, so
 * `pid` is ours to end — but health still comes from probing the forwarded
 * ports, never from this process.
 */
export const launchResponseSchema = z.strictObject({
  profileId: z.string().min(1).max(64),
  terminalId: z.string().min(1).max(32),
  command: z.string(),
  pid: z.number().int(),
  launchedAt: z.string().min(1),
});

export type TerminalTarget = z.infer<typeof terminalTargetSchema>;

export const healthResponseSchema = z.strictObject({
  ok: z.literal(true),
  version: z.string().min(1).max(32),
  serviceInstanceId: z.string().min(1).max(64),
});

export const CONTRACT_VERSION = "1.0.0";

export { bindAddressSchema };
