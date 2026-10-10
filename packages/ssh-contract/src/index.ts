/**
 * `@ssh-tunnel/contract` — the single source of truth for the tunnel manager.
 *
 * Host-free by construction (imports `zod` only): every front and the daemon
 * share these schemas, so the wire and the types cannot drift apart.
 */
export * from "./errors.js";
export * from "./tunnel.js";
export * from "./routes.js";
