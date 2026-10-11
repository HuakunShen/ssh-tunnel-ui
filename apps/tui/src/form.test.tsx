/**
 * Form unit tests: validation + input conversion are pure functions, and the
 * `TunnelForm` renders all fields via test-renderer. No TTY needed.
 */
import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  EMPTY_FORM,
  TunnelForm,
  toProfileInput,
  validateForm,
} from "./form.js";

describe("validateForm", () => {
  it("accepts a complete local-forward form", () => {
    expect(
      validateForm({ ...EMPTY_FORM, name: "ufo", target: "ufo", localPort: "8080", remoteHost: "127.0.0.1", remotePort: "80" }),
    ).toBeNull();
  });

  it("rejects blank names, targets and bad ports", () => {
    expect(validateForm({ ...EMPTY_FORM, target: "ufo", localPort: "8080" })).toBe("name is required");
    expect(validateForm({ ...EMPTY_FORM, name: "x", localPort: "8080" })).toBe("ssh target is required");
    expect(validateForm({ ...EMPTY_FORM, name: "x", target: "ufo", localPort: "0" })).toBe(
      "local port must be 1–65535",
    );
    expect(
      validateForm({ ...EMPTY_FORM, name: "x", target: "ufo", localPort: "8080", remoteHost: "h", remotePort: "xy" }),
    ).toBe("remote port must be 1–65535");
  });

  it("dynamic mode skips remote host/port", () => {
    expect(
      validateForm({ ...EMPTY_FORM, name: "socks", target: "mini", mode: "dynamic", localPort: "1080" }),
    ).toBeNull();
  });
});

describe("toProfileInput", () => {
  it("builds local / remote / dynamic forwards", () => {
    const local = toProfileInput({ ...EMPTY_FORM, name: "a", target: "ufo", localPort: "8080", remoteHost: "db", remotePort: "5432" });
    expect(local.forwards).toEqual([{ kind: "local", bindPort: 8080, targetHost: "db", targetPort: 5432 }]);
    const remote = toProfileInput({ ...EMPTY_FORM, name: "b", mode: "remote", target: "ufo", localPort: "9090", remoteHost: "127.0.0.1", remotePort: "3000" });
    expect(remote.forwards).toEqual([{ kind: "remote", bindPort: 9090, targetHost: "127.0.0.1", targetPort: 3000 }]);
    const dynamic = toProfileInput({ ...EMPTY_FORM, name: "c", mode: "dynamic", target: "mini", localPort: "1080" });
    expect(dynamic.forwards).toEqual([{ kind: "dynamic", bindPort: 1080 }]);
  });
});

describe("TunnelForm snapshots", () => {
  it("renders all six fields with labels", async () => {
    const setup = await testRender(
      h(TunnelForm, { onSubmit: () => undefined, onCancel: () => undefined }),
      { width: 100, height: 32 },
    );
    await setup.flush();
    const frame = setup.captureCharFrame();
    for (const label of ["Name", "Mode", "SSH target", "Local port", "Remote host", "Remote port"]) {
      expect(frame).toContain(label);
    }
    expect(frame).toContain("new tunnel");
    await setup.dispose();
  });
});
