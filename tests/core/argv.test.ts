/**
 * Contract tests: argv builder covers the whole SSH forwarding surface.
 * Pure functions, no I/O — the same suite guards every front.
 */
import { describe, expect, it } from "vitest";
import type { TunnelProfile } from "@ssh-tunnel/contract";
import { buildSshArgv, localBindPorts } from "@ssh-tunnel/core";

function baseProfile(overrides: Partial<TunnelProfile> = {}): TunnelProfile {
  return {
    id: "t-test",
    name: "test",
    mode: "local",
    sshTarget: "ufo",
    forwards: [{ kind: "local", bindPort: 18080, targetHost: "127.0.0.1", targetPort: 80 }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildSshArgv", () => {
  it("builds a basic local forward with safe defaults", () => {
    const { argv, command } = buildSshArgv(baseProfile());
    expect(argv).toContain("-L");
    expect(argv).toContain("18080:127.0.0.1:80");
    expect(argv).toContain("-N");
    expect(argv).toContain("ufo");
    expect(argv).toContain("ExitOnForwardFailure=yes");
    expect(command.startsWith("ssh ")).toBe(true);
  });

  it("supports remote forwards", () => {
    const { argv } = buildSshArgv(
      baseProfile({
        mode: "remote",
        forwards: [{ kind: "remote", bindPort: 19090, targetHost: "127.0.0.1", targetPort: 3000 }],
      }),
    );
    expect(argv).toContain("-R");
    expect(argv).toContain("19090:127.0.0.1:3000");
  });

  it("supports dynamic SOCKS forwards", () => {
    const { argv } = buildSshArgv(
      baseProfile({
        mode: "dynamic",
        forwards: [{ kind: "dynamic", bindPort: 11080 }],
      }),
    );
    expect(argv).toContain("-D");
    expect(argv).toContain("11080");
  });

  it("supports jump hops combined with forwards", () => {
    const { argv } = buildSshArgv(
      baseProfile({ mode: "jump", jumpHops: ["bastion", "inner:2222"] }),
    );
    const jumpIndex = argv.indexOf("-J");
    expect(jumpIndex).toBeGreaterThan(-1);
    expect(argv[jumpIndex + 1]).toBe("bastion,inner:2222");
  });

  it("supports multiple mixed forwards in one process", () => {
    const { argv } = buildSshArgv(
      baseProfile({
        mode: "multi",
        forwards: [
          { kind: "local", bindPort: 18081, targetHost: "db", targetPort: 5432 },
          { kind: "remote", bindPort: 19091, targetHost: "127.0.0.1", targetPort: 8080 },
          { kind: "dynamic", bindPort: 11081 },
        ],
      }),
    );
    expect(argv.filter((a) => a === "-L")).toHaveLength(1);
    expect(argv.filter((a) => a === "-R")).toHaveLength(1);
    expect(argv.filter((a) => a === "-D")).toHaveLength(1);
  });

  it("passes identity file, port, user, and extra options through", () => {
    const { argv } = buildSshArgv(
      baseProfile({
        sshTarget: "example.com",
        sshUser: "deploy",
        sshPort: 2222,
        identityFile: "/home/u/.ssh/id_ed25519",
        extraOptions: [{ key: "GatewayPorts", value: "yes" }],
      }),
    );
    expect(argv).toContain("-i");
    expect(argv).toContain("-p");
    expect(argv).toContain("deploy@example.com");
    expect(argv).toContain("GatewayPorts=yes");
  });

  it("bind addresses render into specs", () => {
    const { argv } = buildSshArgv(
      baseProfile({
        forwards: [
          { kind: "local", bindAddress: "0.0.0.0", bindPort: 18082, targetHost: "svc", targetPort: 80 },
        ],
      }),
    );
    expect(argv).toContain("0.0.0.0:18082:svc:80");
  });
});

describe("localBindPorts", () => {
  it("collects only local + dynamic ports", () => {
    const ports = localBindPorts(
      baseProfile({
        forwards: [
          { kind: "local", bindPort: 1111, targetHost: "a", targetPort: 1 },
          { kind: "remote", bindPort: 2222, targetHost: "b", targetPort: 2 },
          { kind: "dynamic", bindPort: 3333 },
        ],
      }),
    );
    expect([...ports].sort((a, b) => a - b)).toEqual([1111, 3333]);
  });
});
