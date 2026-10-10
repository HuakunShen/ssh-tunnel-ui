/**
 * Contract tests: semantic validation + lifecycle state machine.
 */
import { describe, expect, it } from "vitest";
import type { TunnelProfileInput } from "@ssh-tunnel/contract";
import {
  canTransition,
  findPortConflicts,
  isStoppable,
  startTarget,
  stopTarget,
  validateProfileInput,
} from "@ssh-tunnel/core";

function input(overrides: Partial<TunnelProfileInput> = {}): TunnelProfileInput {
  return {
    name: "demo",
    mode: "local",
    sshTarget: "ufo",
    forwards: [{ kind: "local", bindPort: 18080, targetHost: "127.0.0.1", targetPort: 80 }],
    ...overrides,
  };
}

describe("validateProfileInput", () => {
  it("accepts a well-formed input", () => {
    expect(validateProfileInput(input())).toEqual([]);
  });

  it("rejects blank names and missing forwards", () => {
    const findings = validateProfileInput(input({ name: "  ", forwards: [] }));
    expect(findings.some((f) => f.path === "name" && f.severity === "error")).toBe(true);
    expect(findings.some((f) => f.path === "forwards")).toBe(true);
  });

  it("rejects duplicate local ports inside one profile", () => {
    const findings = validateProfileInput(
      input({
        forwards: [
          { kind: "local", bindPort: 8080, targetHost: "a", targetPort: 80 },
          { kind: "dynamic", bindPort: 8080 },
        ],
      }),
    );
    expect(findings.some((f) => f.message.includes("already used"))).toBe(true);
  });

  it("warns on loopback remote binds and privileged ports", () => {
    const findings = validateProfileInput(
      input({
        forwards: [
          { kind: "remote", bindPort: 8080, targetHost: "127.0.0.1", targetPort: 80 },
          { kind: "local", bindPort: 443, targetHost: "a", targetPort: 443 },
        ],
      }),
    );
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("GatewayPorts"))).toBe(
      true,
    );
    expect(findings.some((f) => f.severity === "warning" && f.message.includes("privileged"))).toBe(
      true,
    );
  });
});

describe("findPortConflicts", () => {
  it("reports ports claimed by two profiles", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const conflicts = findPortConflicts([
      {
        id: "a", name: "a", mode: "local", sshTarget: "ufo",
        forwards: [{ kind: "local", bindPort: 9000, targetHost: "x", targetPort: 80 }],
        createdAt: now, updatedAt: now,
      },
      {
        id: "b", name: "b", mode: "dynamic", sshTarget: "ufo",
        forwards: [{ kind: "dynamic", bindPort: 9000 }],
        createdAt: now, updatedAt: now,
      },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.port).toBe(9000);
  });
});

describe("state machine", () => {
  it("allows start only from stopped/failed", () => {
    expect(startTarget("stopped")).toBe("starting");
    expect(startTarget("failed")).toBe("starting");
    expect(startTarget("running")).toBeNull();
  });

  it("allows stop only from live states", () => {
    expect(stopTarget("running")).toBe("stopping");
    expect(stopTarget("degraded")).toBe("stopping");
    expect(stopTarget("stopped")).toBeNull();
    expect(isStoppable("starting")).toBe(true);
  });

  it("guards illegal jumps", () => {
    expect(canTransition("stopped", "running")).toBe(false);
    expect(canTransition("running", "degraded")).toBe(true);
    expect(canTransition("stopping", "stopped")).toBe(true);
  });
});
