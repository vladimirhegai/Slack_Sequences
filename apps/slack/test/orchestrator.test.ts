import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROVIDERS,
  type AgentProvider,
} from "@sequences/platform/providers";
import {
  assembleBrief,
  canResumeFailedProject,
  createVideo,
} from "../src/orchestrator.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";

const roots: string[] = [];
const originalOpenRouter = PROVIDERS["openrouter-api"];

afterEach(() => {
  PROVIDERS["openrouter-api"] = originalOpenRouter;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("Slack create orchestration", () => {
  it("treats requested length as a flexible pacing center", () => {
    const brief = assembleBrief({
      product: "Relay",
      whatShipped: "Release Command Center",
      lengthSec: 15,
      context: "Show search, rollback, and the error-rate chart.",
    });
    expect(brief).toContain("12-18 seconds is acceptable");
    expect(brief).toContain("not a literal edit");
    expect(brief).toContain("never paste the launch paragraph onto a card");
  });

  it("resumes only explicit failed, uncommitted paid-artifact recovery", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-resume-guard-"));
    roots.push(dir);
    initializeProject(dir, { name: "Relay", brandName: "Relay", seedScreenshot: false });
    expect(canResumeFailedProject(dir, "latest")).toBe(false);
    fs.writeFileSync(path.join(dir, "FAILURE.md"), "failed storyboard", "utf8");
    expect(canResumeFailedProject(dir)).toBe(false);
    expect(canResumeFailedProject(dir, "latest")).toBe(true);

    const compositionDir = path.join(dir, "composition");
    fs.mkdirSync(compositionDir, { recursive: true });
    fs.writeFileSync(path.join(compositionDir, "index.html"), "<div></div>", "utf8");
    fs.writeFileSync(path.join(compositionDir, "manifest.json"), "{}", "utf8");
    expect(canResumeFailedProject(dir, "latest")).toBe(false);
  });

  it("does not disguise provider failure as a generic creative result", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-orchestrator-test-"));
    roots.push(root);
    vi.stubEnv("SLACK_SEQUENCES_DATA_DIR", root);
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK", "0");
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "failing OpenRouter",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete: async () => {
        throw new Error("OpenRouter HTTP 403: key limit exceeded");
      },
    };
    PROVIDERS["openrouter-api"] = provider;

    // Fail-loud: surface the full diagnostic (stage + reason + artifact paths),
    // never a generic film. The message is the consolidated failure report.
    const error = (await createVideo({
      jobId: "relay-failed-provider",
      product: "Relay",
      whatShipped: "Release Command Center",
      provider: "openrouter-api",
      render: false,
      preferMcp: false,
    }).catch((thrown) => thrown)) as Error;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/no video or storyboard was published/i);
    expect(error.message).toMatch(/Failed stage: storyboard-plan/i);
    // No generic video was published …
    expect(
      fs.existsSync(path.join(root, "projects", "relay-failed-provider", "composition")),
    ).toBe(false);
    // … and the full diagnostic was persisted for a fixing agent to read.
    expect(
      fs.existsSync(path.join(root, "projects", "relay-failed-provider", "FAILURE.md")),
    ).toBe(true);
  });
});
