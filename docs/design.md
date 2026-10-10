# Design: ssh-tunnel-ui

## Goal

Remember every SSH tunnel; one click applies it, one click stops it. The
`ssh -L/-R/-D/-J` flags are hard to memorize — this manager stores profiles
and shows the exact command it runs, so users learn by seeing.

## Non-goals

- Reimplementing the SSH data plane (stays in system OpenSSH).
- Storing secrets: keys/agents come from the user's own SSH setup; the store
  holds only public profile fields (targets, ports, options).
- Exposing tunnels beyond loopback by default (bind defaults to loopback).

## Architecture: one backend, many thin fronts

```
                +-------------------+
                |  system `ssh -N`   |  data plane (untouched)
                +--------+----------+
                         | spawn / TCP probe / ~/.ssh/config / JSON store
              +----------v-----------+
              | @ssh-tunnel/host-node|  trusted Node host (ports)
              +----------+-----------+
                         |
              +----------v-----------+
              | @ssh-tunnel/service  |  TunnelManager + Hono HTTP API
              +----------+-----------+
                         |
     +---------+---------+---------+---------+
     |         |         |         |         |
   server     CLI       TUI       Web     desktop/DSH/VSCode
  (daemon)  (dual)   (OpenTUI)  (static)   (stubs, same API)
```

Portable packages (`contract`, `core`, `client`) are host-free by
construction; `scripts/check-boundaries.ts` enforces it at `file:line:column`
granularity. Internal packages export TS source directly; only runnable
artifacts (server/cli/tui bundles) go through esbuild.

## Tunnel kinds (all verified live)

| kind | flags | test |
|---|---|---|
| local | `-L [bind:]port:host:hostport` | ufo:22 via 18081, `hostname`=ufo |
| remote | `-R [bind:]port:host:hostport` | ufo:19081 → local echo, `ECHO:hello-remote` |
| dynamic | `-D [bind:]port` | mini:11081, SOCKS5 handshake → ufo banner |
| jump | `-J hop…` + any forward | via ufo → mini, `hostname`=mini |
| multi | several `-L/-R/-D` in one process | unit-tested (argv has all three) |
| windows target | `-L` to OpenSSH_for_Windows | banner `SSH-2.0-OpenSSH_for_Windows_9.5` |

Cross-cutting: `ExitOnForwardFailure` (default on), keepalive defaults,
identity file, `-p`, `-o` passthrough, `-N`/remote command, stop-all,
per-forward TCP probes → `running`/`degraded`.

## Lifecycle

`stopped → starting → running ⇄ degraded → stopping → stopped`,
`failed` re-startable. `startTarget`/`stopTarget` in core decide; the HTTP
layer maps `Conflict`→409 etc. via an exhaustive code→status record. Startup
grace scales with jump hops (`900ms + 4s/hop`); probes retry 3× so slow
listeners don't false-degrade.

## Error model

Closed `TUNNEL_PROBLEM_CODES` (13) + `TunnelError(code)`; clients branch on
`code`, never message. `details` are flat redacted facts (ports, exit codes).

## Fronts share one contract

`packages/ssh-contract` (zod, strict requests / loose responses) → typed
`ssh-client` (injected `fetch`) → TUI, Web (static, zero-dep), CLI
(daemon + `--direct`), Tauri stub, DSH plugin, VS Code stub. Adding a front
= new `apps/` or `integrations/` dir, no domain logic copied.

## Live-test evidence (2026-10-11, this repo)

- daemon `health ok`, Web `200`, `ssh-hosts` lists ufo/mac-mini/rog16-windows.
- 21 tests green (16 core + 5 HTTP); 12 packages `tsc` clean; boundaries clean.
- stop-all frees all ports; store persists 5 profiles across daemon restarts.
