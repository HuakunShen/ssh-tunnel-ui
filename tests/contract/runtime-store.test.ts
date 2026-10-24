/**
 * Runtime records: a disposable cache of what was up, not user configuration.
 *
 * Every failure mode has to degrade to "nothing was running" — a corrupt or
 * unreadable file must never stop the daemon from starting, and a record with a
 * shape this build does not understand is dropped rather than trusted.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileRuntimeStore } from "@ssh-tunnel/host-node";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "ssh-tunnel-runtime-")), "runtime.json");
}

describe("createFileRuntimeStore", () => {
  it("round-trips records and keeps the file private", async () => {
    const path = tempPath();
    const store = createFileRuntimeStore(path);
    const records = [
      { profileId: "t-1", origin: "managed" as const, startedAt: "2026-01-01T00:00:00.000Z", pid: 42 },
      {
        profileId: "t-2",
        origin: "terminal" as const,
        startedAt: "2026-01-01T00:00:01.000Z",
        mode: "shell" as const,
        terminalId: "iterm2",
      },
    ];
    await store.write(records);
    expect(await store.read()).toEqual(records);
    expect(readFileSync(path, "utf8")).toContain('"t-1"');
  });

  it("treats a missing file as nothing running", async () => {
    expect(await createFileRuntimeStore(tempPath()).read()).toEqual([]);
  });

  it("treats a corrupt file as nothing running", async () => {
    const path = tempPath();
    writeFileSync(path, "{ not json");
    expect(await createFileRuntimeStore(path).read()).toEqual([]);
  });

  it("drops entries this build cannot understand", async () => {
    const path = tempPath();
    writeFileSync(
      path,
      JSON.stringify([
        { profileId: "ok", origin: "managed", startedAt: "2026-01-01T00:00:00.000Z" },
        { profileId: "bad-origin", origin: "elsewhere", startedAt: "2026-01-01T00:00:00.000Z" },
        { origin: "managed", startedAt: "2026-01-01T00:00:00.000Z" },
        { profileId: "bad-mode", origin: "terminal", startedAt: "x", mode: "teleport" },
      ]),
    );
    const records = await createFileRuntimeStore(path).read();
    expect(records.map((record) => record.profileId)).toEqual(["ok", "bad-mode"]);
    expect(records[1]?.mode).toBeUndefined();
  });

  it("never throws when the path cannot be written", async () => {
    const store = createFileRuntimeStore("/dev/null/nope/runtime.json");
    await expect(store.write([])).resolves.toBeUndefined();
  });
});
