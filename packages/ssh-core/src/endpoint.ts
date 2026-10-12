/**
 * Endpoint derivation: turning a forward rule into something a human or a
 * browser can actually use.
 *
 * Host-free and pure, like the rest of `ssh-core`: no DOM, no `node:*`.
 */

import type { ForwardRule } from "@ssh-tunnel/contract";

/** A loopback listener a program on this machine can connect to. */
export interface LocalEndpoint {
  /** What the user types or pastes: `localhost:6171`. */
  readonly endpoint: string;
  /** The same thing as a URL, for a browser or an `<a href>`. */
  readonly url: string;
  /** The port the local socket listens on. */
  readonly port: number;
}

const LOOPBACK = "localhost";

/**
 * The browsable endpoint of a forward, when one exists.
 *
 * A local forward (`ssh -L`) listens on this machine, so its bind port is the
 * one to hand out. It exists whether or not the tunnel is running — the socket
 * is the destination to point a browser at either way.
 */
export function localForwardEndpoint(forward: ForwardRule): LocalEndpoint | undefined {
  // A remote forward binds its listener on the far machine, so nothing on this
  // host answers on that port: there is no local socket to open or paste.
  // A SOCKS5 forward is a proxy, not a web server: likewise nothing to open.
  // Only `ssh -L` gives a loopback listener a program here can connect to.
  if (forward.kind !== "local") {
    return undefined;
  }
  const address = forward.bindAddress?.trim();
  const host = address === undefined || address.length === 0 ? LOOPBACK : address;
  return {
    endpoint: `${host}:${forward.bindPort}`,
    // The bind address is user input: only ever emit a scheme we recognise.
    url: `http://${host}:${forward.bindPort}`,
    port: forward.bindPort,
  };
}

/**
 * Every endpoint worth showing as a link for one profile.
 *
 * A remote forward (`ssh -R`) binds on the far side of the connection, so
 * there is no local port to open — the browser-facing list deliberately skips
 * it rather than linking to a dead `localhost`.
 */
export function profileEndpoints(
  forwards: readonly ForwardRule[],
): readonly LocalEndpoint[] {
  return forwards
    .map(localForwardEndpoint)
    .filter((endpoint): endpoint is LocalEndpoint => endpoint !== undefined);
}

/**
 * The shared text for every endpoint in a profile: one line you can paste
 * anywhere that accepts a `host:port` — a terminal, a browser bar, a database
 * client's connection field.
 */
export function endpointSummary(forwardEndpoints: readonly LocalEndpoint[]): string {
  return forwardEndpoints.map((endpoint) => endpoint.endpoint).join(", ");
}
