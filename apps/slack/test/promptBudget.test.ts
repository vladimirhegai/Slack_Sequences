import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptDirectorPromptForSlots,
  creationPrompt,
} from "../src/engine/compositionRunner.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { retrieveHyperframesSkillContext } from "../src/agent/skillContext.ts";

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), "../..");

/**
 * SENTINEL_PLAN.md §3 Phase 4 item 2. Two ceilings, one purpose: growing the
 * prompt must require consciously raising a tested number a reviewer sees.
 *
 * 1. `planning-director.md` — the editable base prompt — stays within its
 *    post-Phase-1 byte count + 10%. This one is ENFORCED and passing.
 * 2. The ASSEMBLED slot-author prompt for a fixture job stays at ≤45,000 chars.
 *    Slot mode removes host-owned director chapters and uses a compact,
 *    deterministic skills projection while preserving creative/motion guidance.
 */
const PLANNING_DIRECTOR_BASELINE_BYTES = 37_010; // post-Phase-1 (SENTINEL_REPORT)
const PLANNING_DIRECTOR_BUDGET_BYTES = Math.round(PLANNING_DIRECTOR_BASELINE_BYTES * 1.1); // 40,711
const AUTHOR_PROMPT_TARGET_CHARS = 45_000;
const AUTHOR_PROMPT_REGRESSION_CEILING = AUTHOR_PROMPT_TARGET_CHARS;

function assembledFixturePrompt(): { prompt: string; directorChars: number; skillsChars: number } {
  const brief = [
    "Product: Cursorflow — a command-palette-first deploy console.",
    "What shipped: a command palette runs a deploy, streams build logs in a terminal,",
    "confirms in a modal, updates a stat-card with p95 latency, and a button ships it.",
    "Audience: platform engineers. Tone: crisp-saas. Length: 24s.",
  ].join("\n");
  const draft = buildFallbackComposition({
    product: "Cursorflow",
    whatShipped: "command palette runs a deploy; terminal stream; modal confirm; stat-card; button",
    audience: "platform engineers",
    lengthSec: 24,
  });
  const skills = retrieveHyperframesSkillContext("create", brief);
  const director = fs.readFileSync(path.join(APP_DIR, "prompts", "planning-director.md"), "utf8");
  // An empty project dir keeps `availableAssets` deterministic (no local assets).
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-promptbudget-"));
  try {
    const prompt = creationPrompt({
      brief,
      projectDir,
      skills,
      frameMd: "# Frame token reference line for measurement.\n".repeat(80),
      lockedStoryboard: draft.storyboard,
      slots: true, // the Phase-5 default authoring shape
    });
    return { prompt, directorChars: director.length, skillsChars: skills.text.length };
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
}

describe("Prompt budget — planning-director.md", () => {
  it("stays within the post-Phase-1 byte budget + 10%", () => {
    const bytes = fs.statSync(path.join(APP_DIR, "prompts", "planning-director.md")).size;
    expect(
      bytes,
      `planning-director.md is ${bytes} bytes, over the ${PLANNING_DIRECTOR_BUDGET_BYTES} ` +
        `budget. Deleting a rule made redundant at L0–L2 is fine; ADDING prose means ` +
        `raising this budget in a diff a reviewer sees (SENTINEL.md).`,
    ).toBeLessThanOrEqual(PLANNING_DIRECTOR_BUDGET_BYTES);
  });
});

describe("Slot-mode director-prompt surgery — no contradictory whole-doc contract", () => {
  it("every rewrite anchor still matches planning-director.md (zero misses)", () => {
    const director = fs.readFileSync(path.join(APP_DIR, "prompts", "planning-director.md"), "utf8");
    const misses: string[] = [];
    adaptDirectorPromptForSlots(director, misses);
    expect(
      misses,
      "A planning-director.md edit broke a SLOT_MODE_DIRECTOR_REWRITES anchor — " +
        "update the anchor with the edit so slot mode keeps its surgical rewrite " +
        "(the appended-override fallback is weaker).",
    ).toEqual([]);
  });

  it("the assembled slot prompt carries no whole-document instructions", () => {
    const { prompt } = assembledFixturePrompt();
    // The p7-denseui no-slots attempt + documented slot-envelope drift trace to
    // the base prompt instructing exactly these; slot mode must never see them.
    expect(prompt).not.toContain("Return a complete HTML document");
    expect(prompt).not.toContain("requests only `<index_html>`");
    expect(prompt).not.toContain("initialized synchronously and registered as");
    expect(prompt).not.toContain("The paused timeline must own scene-window opacity");
    expect(prompt).not.toContain("Mark each storyboard scene with");
    // And it does carry the slot response contract.
    expect(prompt).toContain("Response contract (scene slots)");
    // Host-owned reference chapters are removed, while creative/motion craft remains.
    expect(prompt).not.toContain("## Architecture laws");
    expect(prompt).not.toContain("## Hard runtime contract");
    expect(prompt).toContain("## Motion doctrine");
    expect(prompt).toContain("## Continuous spatial world");
    expect(prompt).toContain("## Motion-native components");
  });
});

describe("Prompt budget — assembled author prompt", () => {
  it("assembled slot author prompt for a fixture job is ≤ 45,000 chars", () => {
    const { prompt } = assembledFixturePrompt();
    expect(prompt.length).toBeLessThanOrEqual(AUTHOR_PROMPT_TARGET_CHARS);
  });

  it("holds the assembled prompt at its measured regression ceiling", () => {
    const { prompt } = assembledFixturePrompt();
    // eslint-disable-next-line no-console
    console.log(`[promptBudget] assembled fixture author prompt: ${prompt.length} chars`);
    expect(
      prompt.length,
      `Assembled author prompt grew to ${prompt.length} chars (ceiling ` +
      `${AUTHOR_PROMPT_REGRESSION_CEILING}). If growth is intentional, update the ` +
        `mission target and its rationale in Sentinel docs; otherwise cut it.`,
    ).toBeLessThanOrEqual(AUTHOR_PROMPT_REGRESSION_CEILING);
  });
});
