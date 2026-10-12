/**
 * Endpoint derivation rules: which forwards are worth offering as a link, and
 * what text that link copies.
 */
import { describe, expect, it } from "vitest";
import {
  endpointSummary,
  localForwardEndpoint,
  profileEndpoints,
} from "../../packages/ssh-core/src/endpoint.js";
import type { ForwardRule } from "../../packages/ssh-contract/src/tunnel.js";

const local = (over: Partial<Extract<ForwardRule, { kind: "local" }>> = {}): ForwardRule => ({
  kind: "local",
  bindPort: 6171,
  targetHost: "127.0.0.1",
  targetPort: 6171,
  ...over,
});

describe("localForwardEndpoint", () => {
  it("defaults to localhost when no bind address is given", () => {
    expect(localForwardEndpoint(local())).toEqual({
      endpoint: "localhost:6171",
      url: "http://localhost:6171",
      port: 6171,
    });
  });

  it("treats a blank bind address as absent", () => {
    expect(localForwardEndpoint(local({ bindAddress: "  " }))?.endpoint).toBe("localhost:6171");
  });

  it("uses an explicit bind address when the user pinned one", () => {
    expect(localForwardEndpoint(local({ bindAddress: "127.0.0.1" }))?.endpoint).toBe(
      "127.0.0.1:6171",
    );
  });

  it("builds a browsable http url, never a shell-escaped one", () => {
    const endpoint = localForwardEndpoint(local({ bindAddress: "::1" }));
    expect(endpoint?.url).toBe("http://::1:6171");
    // No quoting, no scheme surprises: the raw string is pasteable.
    expect(endpoint?.url).not.toContain("'");
  });

  it("offers nothing for a SOCKS5 forward", () => {
    expect(
      localForwardEndpoint({ kind: "dynamic", bindPort: 11080 }),
    ).toBeUndefined();
  });
});

describe("profileEndpoints", () => {
  it("skips remote forwards, whose socket lives on the far machine", () => {
    const forwards: ForwardRule[] = [
      local(),
      { kind: "remote", bindPort: 8080, targetHost: "10.0.0.5", targetPort: 80 },
    ];
    expect(profileEndpoints(forwards).map((e) => e.endpoint)).toEqual(["localhost:6171"]);
  });

  it("keeps every local forward in profile order", () => {
    const forwards: ForwardRule[] = [
      local({ bindPort: 8888, bindAddress: "127.0.0.1" }),
      local({ bindPort: 6171 }),
    ];
    expect(profileEndpoints(forwards).map((e) => e.endpoint)).toEqual([
      "127.0.0.1:8888",
      "localhost:6171",
    ]);
  });

  it("returns nothing for a profile of only unlinkable forwards", () => {
    const forwards: ForwardRule[] = [
      { kind: "dynamic", bindPort: 11080 },
      { kind: "remote", bindPort: 80, targetHost: "10.0.0.5", targetPort: 80 },
    ];
    expect(profileEndpoints(forwards)).toEqual([]);
  });
});

describe("endpointSummary", () => {
  it("joins endpoints into one pasteable line", () => {
    const summary = endpointSummary(
      profileEndpoints([local({ bindPort: 6171 }), local({ bindPort: 18888 })]),
    );
    expect(summary).toBe("localhost:6171, localhost:18888");
  });

  it("is an empty string when there is nothing to paste", () => {
    expect(endpointSummary([])).toBe("");
  });
});
