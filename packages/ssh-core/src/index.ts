/**
 * `@ssh-tunnel/core` — portable domain logic: argv building, semantic
 * validation, lifecycle state machine. Host-free: no `node:*`, no DOM.
 * The host layer (process spawn, sockets, files) is injected via ports.
 */
export * from "./argv.js";
export * from "./validate.js";
export * from "./state-machine.js";
