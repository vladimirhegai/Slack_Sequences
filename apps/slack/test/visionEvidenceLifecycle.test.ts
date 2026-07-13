import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  publishCanonicalVisionEvidence,
  type VisionCriticEvidenceV1,
} from "../src/engine/layoutInspector.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function sha256(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function projectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-evidence-lifecycle-"));
  roots.push(dir);
  return dir;
}

function generation(
  project: string,
  label: string,
  includeBlocking = true,
): VisionCriticEvidenceV1 {
  const draftHash = sha256("draft:" + label);
  const strip = Buffer.from("strip:" + label);
  const blocking = includeBlocking ? Buffer.from("blocking:" + label) : undefined;
  const stripSha256 = sha256(strip);
  const blockingSha256 = blocking ? sha256(blocking) : undefined;
  const evidenceHash = sha256(
    draftHash + "\0" + stripSha256 + "\0" + (blockingSha256 ?? "no-blocking"),
  );
  const dir = path.join(project, "build", "qa", "critic", evidenceHash);
  fs.mkdirSync(dir, { recursive: true });
  const stripPath = path.join(dir, "strip.png");
  const blockingPath = blocking ? path.join(dir, "blocking.png") : undefined;
  const manifestPath = path.join(dir, "evidence.json");
  fs.writeFileSync(stripPath, strip);
  if (blocking && blockingPath) fs.writeFileSync(blockingPath, blocking);
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    draftHash,
    evidenceHash,
    strip: { file: "strip.png", sha256: stripSha256 },
    ...(blockingSha256
      ? { blocking: { file: "blocking.png", sha256: blockingSha256 } }
      : {}),
    stripTimes: [1],
    blockingTimes: blocking ? [1.2] : [],
  }));
  return {
    version: 1,
    draftHash,
    evidenceHash,
    stripPngBase64: strip.toString("base64"),
    stripSha256,
    stripPath,
    manifestPath,
    ...(blocking
      ? {
          blockingPngBase64: blocking.toString("base64"),
          blockingSha256,
          blockingPath,
        }
      : {}),
    stripTimes: [1],
    blockingTimes: blocking ? [1.2] : [],
  };
}

function canonicalPaths(project: string): { strip: string; blocking: string } {
  const dir = path.join(project, "build", "qa", "temporal");
  fs.mkdirSync(dir, { recursive: true });
  return {
    strip: path.join(dir, "strip.png"),
    blocking: path.join(dir, "blocking.png"),
  };
}

describe("canonical vision-evidence publication", () => {
  it("swaps both canonical aliases only from a valid immutable generation", () => {
    const project = projectDir();
    const canonical = canonicalPaths(project);
    fs.writeFileSync(canonical.strip, "old-strip");
    fs.writeFileSync(canonical.blocking, "old-blocking");
    const evidence = generation(project, "candidate");

    publishCanonicalVisionEvidence(project, evidence);

    expect(fs.readFileSync(canonical.strip).toString("base64"))
      .toBe(evidence.stripPngBase64);
    expect(fs.readFileSync(canonical.blocking).toString("base64"))
      .toBe(evidence.blockingPngBase64);
  });

  it("rejects invalid digests and paths without touching either alias", () => {
    const project = projectDir();
    const canonical = canonicalPaths(project);
    fs.writeFileSync(canonical.strip, "baseline-strip");
    fs.writeFileSync(canonical.blocking, "baseline-blocking");
    const evidence = generation(project, "candidate");

    expect(() => publishCanonicalVisionEvidence(project, {
      ...evidence,
      stripSha256: "0".repeat(64),
    })).toThrow(/content address|digest/);
    expect(fs.readFileSync(canonical.strip, "utf8")).toBe("baseline-strip");
    expect(fs.readFileSync(canonical.blocking, "utf8")).toBe("baseline-blocking");

    expect(() => publishCanonicalVisionEvidence(project, {
      ...evidence,
      stripPath: path.join(project, "outside-strip.png"),
    })).toThrow(/path/);
    expect(fs.readFileSync(canonical.strip, "utf8")).toBe("baseline-strip");
    expect(fs.readFileSync(canonical.blocking, "utf8")).toBe("baseline-blocking");
  });

  it("removes a stale blocking alias when the valid generation has no blocking sheet", () => {
    const project = projectDir();
    const canonical = canonicalPaths(project);
    fs.writeFileSync(canonical.strip, "old-strip");
    fs.writeFileSync(canonical.blocking, "old-blocking");
    const evidence = generation(project, "strip-only", false);

    publishCanonicalVisionEvidence(project, evidence);

    expect(fs.readFileSync(canonical.strip).toString("base64"))
      .toBe(evidence.stripPngBase64);
    expect(fs.existsSync(canonical.blocking)).toBe(false);
  });
});
