import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { validateStoryboardPlan } from "../src/engine/compositionRunner.ts";
import {
  assetBriefContext,
  assetBriefPlanningOffer,
  assetPacksRoot,
  clearAssetBrief,
  loadAssetBrief,
  preparedLunaAssetPack,
  reserveLunaAssetPack,
  saveAssetBrief,
  storeReferenceImages,
  type ChannelAssetBrief,
  type ChannelLunaAssetPackReceiptV1,
} from "../src/assetBrief.ts";
import { ASSET_LIBRARY } from "../src/engine/assets/index.ts";

let tempDir: string;
let previousDataDir: string | undefined;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-brief-"));
  previousDataDir = process.env.SLACK_SEQUENCES_DATA_DIR;
  process.env.SLACK_SEQUENCES_DATA_DIR = tempDir;
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.SLACK_SEQUENCES_DATA_DIR;
  else process.env.SLACK_SEQUENCES_DATA_DIR = previousDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function brief(over: Partial<ChannelAssetBrief> = {}): ChannelAssetBrief {
  return {
    version: 1,
    channel: "C123",
    notes: "we're a terminal-first devtool, keep it moody",
    palette: { accent: "#FF8A5C", background: "#120D0A", colors: ["#120D0A", "#FF8A5C"] },
    refs: [],
    imageCount: 2,
    createdAt: "2026-07-09T00:00:00.000Z",
    ...over,
  };
}

describe("asset brief store", () => {
  it("round-trips one brief per channel and clears it", () => {
    expect(loadAssetBrief("C123")).toBeUndefined();
    saveAssetBrief(brief());
    expect(loadAssetBrief("C123")?.palette.accent).toBe("#FF8A5C");
    saveAssetBrief(brief({ notes: "replaced" })); // re-run replaces, never appends
    expect(loadAssetBrief("C123")?.notes).toBe("replaced");
    expect(clearAssetBrief("C123")).toBe(true);
    expect(loadAssetBrief("C123")).toBeUndefined();
    expect(clearAssetBrief("C123")).toBe(false);
  });

  it("stores reference images under a channel-scoped directory", () => {
    const refs = storeReferenceImages("C123", [
      { name: "home page.png", buffer: Buffer.from("a") },
      { name: "../evil.png", buffer: Buffer.from("b") },
    ]);
    expect(refs).toHaveLength(2);
    for (const ref of refs) {
      expect(fs.existsSync(ref)).toBe(true);
      expect(path.resolve(ref).startsWith(path.resolve(tempDir))).toBe(true);
    }
  });

  it("resolves only the current versioned receipt inside the host-owned pack root", () => {
    const channel = "C-PACK";
    const first = reserveLunaAssetPack(channel);
    const firstRun = path.join(first.projectDir, "worker-runs", "0001-create");
    fs.mkdirSync(path.join(firstRun, "deliverables"), { recursive: true });
    fs.writeFileSync(path.join(firstRun, "deliverables", "asset-pack.json"), "{}\n");
    const receipt: ChannelLunaAssetPackReceiptV1 = {
      version: 1,
      id: first.id,
      storageKey: first.storageKey,
      latestRunDir: "worker-runs/0001-create",
      fingerprint: "a".repeat(64),
      materializedFingerprint: "b".repeat(64),
      workerJobId: "asset-pack-unit",
      workerRunCount: 1,
      threadId: "thread-unit",
      createdAt: "2026-07-13T00:00:00.000Z",
    };
    saveAssetBrief(brief({ channel, assetPack: receipt }));

    const stored = loadAssetBrief(channel)!;
    expect(stored.assetPack).toEqual(receipt);
    expect(path.resolve(first.projectDir).startsWith(path.resolve(assetPacksRoot()))).toBe(true);
    expect(preparedLunaAssetPack(stored)).toMatchObject({
      deliverablesDir: path.join(firstRun, "deliverables"),
      approvedRoot: path.resolve(assetPacksRoot()),
      receipt,
    });

    const second = reserveLunaAssetPack(channel);
    const secondRun = path.join(second.projectDir, "worker-runs", "0001-create");
    fs.mkdirSync(path.join(secondRun, "deliverables"), { recursive: true });
    const replacement = {
      ...receipt,
      id: second.id,
      storageKey: second.storageKey,
      latestRunDir: "worker-runs/0001-create",
      fingerprint: "c".repeat(64),
      createdAt: "2026-07-13T00:01:00.000Z",
    } satisfies ChannelLunaAssetPackReceiptV1;
    saveAssetBrief(brief({ channel, assetPack: replacement }));

    expect(second.storageKey).not.toBe(first.storageKey);
    expect(preparedLunaAssetPack(loadAssetBrief(channel)!)?.deliverablesDir)
      .toBe(path.join(secondRun, "deliverables"));
    expect(fs.existsSync(first.projectDir)).toBe(true);

    const unsupportedVersion = {
      ...stored,
      assetPack: { ...receipt, version: 2 },
    } as unknown as ChannelAssetBrief;
    expect(preparedLunaAssetPack(unsupportedVersion)).toBeUndefined();
    expect(preparedLunaAssetPack({
      ...stored,
      assetPack: { ...receipt, storageKey: "../outside" },
    })).toBeUndefined();
    expect(preparedLunaAssetPack({
      ...stored,
      assetPack: { ...receipt, latestRunDir: "../../outside" },
    })).toBeUndefined();
  });

  it("clears raw references and every versioned pack for the channel", () => {
    const channel = "C-CLEAR";
    const refs = storeReferenceImages(channel, [
      { name: "product.png", buffer: Buffer.from("product") },
    ]);
    const first = reserveLunaAssetPack(channel);
    const second = reserveLunaAssetPack(channel);
    saveAssetBrief(brief({
      channel,
      refs,
      imageCount: 1,
      assetPack: {
        version: 1,
        id: second.id,
        storageKey: second.storageKey,
        latestRunDir: "worker-runs/0001-create",
        fingerprint: "d".repeat(64),
        materializedFingerprint: "e".repeat(64),
        workerJobId: "asset-pack-clear",
        workerRunCount: 1,
        threadId: "thread-clear",
        createdAt: "2026-07-13T00:00:00.000Z",
      },
    }));

    expect(clearAssetBrief(channel)).toBe(true);
    expect(loadAssetBrief(channel)).toBeUndefined();
    expect(fs.existsSync(refs[0]!)).toBe(false);
    expect(fs.existsSync(first.projectDir)).toBe(false);
    expect(fs.existsSync(second.projectDir)).toBe(false);
  });
});

describe("assetBriefContext", () => {
  it("commits accent, canvas tone, and the user's notes as prose", () => {
    const context = assetBriefContext(brief());
    expect(context).toContain("#FF8A5C");
    expect(context).toContain("Treat it as evidence, not a quota");
    expect(context).toContain("dark UI");
    expect(context).toContain("terminal-first devtool");
  });
});

describe("assetBriefPlanningOffer", () => {
  const flag = "SLACK_SEQUENCES_ASSETS";
  let previousFlag: string | undefined;
  beforeAll(() => { previousFlag = process.env[flag]; });
  afterAll(() => {
    if (previousFlag === undefined) delete process.env[flag];
    else process.env[flag] = previousFlag;
  });

  it("is empty when the asset library is explicitly disabled", () => {
    process.env[flag] = "0";
    expect(assetBriefPlanningOffer(brief())).toBe("");
  });

  it("offers 4 real asset kinds, declare-by-default, with the accent prefilled", () => {
    process.env[flag] = "1";
    const offer = assetBriefPlanningOffer(brief({ notes: undefined }));
    const kinds = [...offer.matchAll(/"asset-([\w-]+)"/g)].map((match) => match[1]);
    const libraryIds = new Set(ASSET_LIBRARY.map((asset) => asset.id));
    const offeredIds = new Set(kinds);
    expect(offeredIds.size).toBe(4);
    for (const id of offeredIds) expect(libraryIds.has(id!)).toBe(true);
    expect(offer).toContain("DECLARE, never draw");
    expect(offer).toContain("DEFAULT");
    expect(offer).toContain('"plugins":[');
    expect(offer).toContain('{"name":"accent","value":"#FF8A5C"}');
    expect(offer).toContain("Drop an");
  });

  it("lets brief notes outrank default slots deterministically", () => {
    process.env[flag] = "1";
    const offer = assetBriefPlanningOffer(
      brief({ notes: "our deploy pipeline dashboard for the whole team" }),
    );
    expect(offer).toContain("asset-team-medallion");
    expect(offer).toContain("asset-flow-node");
    // Still capped at 4 distinct kinds.
    const kinds = new Set([...offer.matchAll(/"asset-([\w-]+)"/g)].map((match) => match[1]));
    expect(kinds.size).toBe(4);
  });

  it("omits the accent prefill when the palette carries none", () => {
    process.env[flag] = "1";
    const offer = assetBriefPlanningOffer(
      brief({ palette: { colors: ["#101010"] } }),
    );
    expect(offer).not.toContain('"name":"accent"');
    expect(offer).toContain('"asset-');
  });
});

/* ---------------------------------------------- duration is never a veto */

function scenes(durations: number[]): DirectScene[] {
  let startSec = 0;
  return durations.map((durationSec, index) => {
    const scene: DirectScene = {
      id: `s-${index + 1}`,
      title: `Scene ${index + 1}`,
      purpose: "prove",
      startSec,
      durationSec,
    };
    startSec += durationSec;
    return scene;
  });
}

describe("duration never vetoes (owner call 2026-07-09)", () => {
  it("a plan far under the requested runtime produces NO duration finding", () => {
    // Duration lives in the prompt's template scaffold, not in a gate — a
    // time miss must never burn a storyboard attempt.
    const errors = validateStoryboardPlan(scenes([4, 5, 4]), { targetDurationSec: 30 });
    expect(errors.some((error) => /duration/i.test(error) && error.includes("30"))).toBe(false);
    expect(errors.some((error) => error.startsWith("pacing/duration:"))).toBe(false);
  });
});
