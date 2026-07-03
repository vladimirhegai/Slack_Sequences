import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-debugflags-"));
  process.env.SLACK_SEQUENCES_DATA_DIR = dataDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SLACK_SEQUENCES_DATA_DIR;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("debug flags", () => {
  it("defaults off, toggles on/off, and persists across module reloads", async () => {
    const flags = await import("../src/debugFlags.ts");
    expect(flags.isDebugEnabled()).toBe(false);
    flags.setDebugEnabled(true);
    expect(flags.isDebugEnabled()).toBe(true);

    vi.resetModules();
    const reloaded = await import("../src/debugFlags.ts");
    expect(reloaded.isDebugEnabled()).toBe(true);
    reloaded.setDebugEnabled(false);
    expect(reloaded.isDebugEnabled()).toBe(false);
  });

  it("treats a corrupt flags file as off", async () => {
    fs.writeFileSync(path.join(dataDir, "debug-flags.json"), "{nope");
    const flags = await import("../src/debugFlags.ts");
    expect(flags.isDebugEnabled()).toBe(false);
  });
});
