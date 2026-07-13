import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptDirectorPromptForSlots,
  creationPrompt,
} from "../src/engine/compositionRunner.ts";
import {
  AUTHOR_PROMPT_BUDGET_CHARS,
  AUTHOR_PROMPT_FEEDBACK_HEADROOM_CHARS,
  assertAuthorPromptBudget,
  compactLockedDirectorPrompt,
  compactRepairSource,
  isAuthorPromptBudgetError,
} from "../src/engine/runner/prompts.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { retrieveHyperframesSkillContext } from "../src/agent/skillContext.ts";
import { assembleBrief } from "../src/orchestrator.ts";

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), "../..");

/**
 * SENTINEL.md budget contract. Two ceilings, one purpose: growing the
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
const AUTHOR_PROMPT_TARGET_CHARS = AUTHOR_PROMPT_BUDGET_CHARS;
const AUTHOR_PROMPT_REGRESSION_CEILING = AUTHOR_PROMPT_TARGET_CHARS;
const CURRENT_PROOF_D_DIR = path.join(
  APP_DIR,
  ".data",
  "projects",
  "lp3-state-capsule-20260712-d",
);
const CURRENT_PROOF_D_INPUT = path.resolve(
  APP_DIR,
  "../..",
  ".tmp",
  "lp3-state-capsule-20260712.json",
);
const CURRENT_PROOF_D_AVAILABLE =
  fs.existsSync(CURRENT_PROOF_D_DIR) && fs.existsSync(CURRENT_PROOF_D_INPUT);
const PROOF_SPAN_G_DIR = path.join(
  APP_DIR,
  ".data",
  "projects",
  "lp3-state-capsule-20260712-g",
);
const PROOF_SPAN_G_INPUT = path.resolve(
  APP_DIR,
  "../..",
  ".tmp",
  "lp3-state-capsule-20260712-g.json",
);
const PROOF_SPAN_G_AVAILABLE =
  fs.existsSync(PROOF_SPAN_G_DIR) && fs.existsSync(PROOF_SPAN_G_INPUT);

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

  it("keeps full, multi-scene, and large repair payloads under the same ceiling", () => {
    const brief = "Product: Cursorflow. What shipped: deploy console, terminal stream, modal confirm, stat-card, and button. Audience: platform engineers. Length: 24s.";
    const draft = buildFallbackComposition({
      product: "Cursorflow",
      whatShipped: "deploy console; terminal stream; modal confirm; stat-card; button",
      audience: "platform engineers",
      lengthSec: 24,
    });
    const skills = retrieveHyperframesSkillContext("create", brief);
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-promptdiagnostic-"));
    try {
      const full = creationPrompt({
        brief,
        projectDir,
        skills,
        frameMd: "# Frame\n".repeat(80),
        lockedStoryboard: draft.storyboard,
        compact: true,
      });
      const multiSceneStoryboard = Array.from({ length: 10 }, (_, index) => ({
        ...draft.storyboard[index % draft.storyboard.length]!,
        id: `scene-${index + 1}`,
        startSec: index * 2.4,
      }));
      const multiScene = creationPrompt({
        brief,
        projectDir,
        skills,
        frameMd: "# Frame\n".repeat(80),
        lockedStoryboard: multiSceneStoryboard,
        slots: true,
      });
      const repair = creationPrompt({
        brief,
        projectDir,
        skills,
        lockedStoryboard: draft.storyboard,
        scratch: {
          storyboard: draft.storyboard,
          html: `${"x".repeat(80_000)}<div data-part="repair-target">${"y".repeat(40_000)}</div>`,
        },
        validationFeedback: ['dead_gsap_target: data-part="repair-target"'],
        compact: true,
        structuredPatches: true,
      });
      expect(full.length).toBeLessThanOrEqual(AUTHOR_PROMPT_TARGET_CHARS);
      expect(multiScene.length).toBeLessThanOrEqual(AUTHOR_PROMPT_TARGET_CHARS);
      expect(repair.length).toBeLessThanOrEqual(AUTHOR_PROMPT_TARGET_CHARS);
      assertAuthorPromptBudget(full, "author source");
      assertAuthorPromptBudget(multiScene, "author source");
      assertAuthorPromptBudget(repair, "author patch");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("fits optional author skills around a production-shaped locked plan", () => {
    const draft = buildFallbackComposition({
      product: "CurrentProof",
      whatShipped: "one metric develops across five scenes into one approval surface",
      audience: "release engineers",
      lengthSec: 20,
    });
    const seed = draft.storyboard[0]!;
    const storyboard = Array.from({ length: 5 }, (_, index) => ({
      ...seed,
      id: `metric-state-${index + 1}`,
      title: `Release readiness develops to ${41 + index * 12}%`,
      purpose: "Preserve one typed continuity metric without resetting at a cut",
      foreground: "A glass release-readiness metric inside one measured product station",
      background: "A restrained structural rail behind the primary product surface",
      cameraIntent: "Hold on the one focal station while local component state develops",
      continuityAnchor: "release-readiness-metric",
      startSec: index * 4,
      durationSec: 4,
      components: [{
        version: 1 as const,
        id: "release-readiness",
        kind: "stat-card" as const,
        role: "hero" as const,
        entityId: "release-readiness-metric",
      }],
      beats: [{
        version: 1 as const,
        id: `metric-count-${index + 1}`,
        sceneId: `metric-state-${index + 1}`,
        component: "release-readiness",
        kind: "count" as const,
        atSec: index * 4 + 0.5,
        value: 41 + index * 12,
      }],
    }));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-prompt-fit-"));
    try {
      const baseSkills = retrieveHyperframesSkillContext("create", "glass metric approval");
      const prompt = creationPrompt({
        brief: "CurrentProof carries one release-readiness metric through five scenes.",
        projectDir,
        skills: { ...baseSkills, text: `${baseSkills.text}\n\n${"Optional author reference. ".repeat(1_200)}` },
        frameMd: "# Frame\nDark structural basis with one bright metric focal.\n".repeat(80),
        lockedStoryboard: storyboard,
        slots: true,
      });
      expect(prompt.length).toBeLessThanOrEqual(AUTHOR_PROMPT_TARGET_CHARS);
      expect(prompt).toContain("metric-state-5");
      expect(prompt).toContain("Frame design capsule");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("compacts planner-only scene prose when a locked slot prompt consumes feedback headroom", () => {
    const draft = buildFallbackComposition({
      product: "Headroom",
      whatShipped: "one continuity metric develops across five scenes",
      audience: "release engineers",
      lengthSec: 20,
    });
    const seed = draft.storyboard[0]!;
    const plannerOnly = "incoming planner paperwork ".repeat(60);
    const storyboard = Array.from({ length: 5 }, (_, index) => ({
      ...seed,
      id: `proof-${index + 1}`,
      title: `Proof ${index + 1}`,
      purpose: "planner purpose already compiled into the locked contracts ".repeat(24),
      incomingIdea: plannerOnly,
      foreground: `Visible continuity metric ${index + 1}`,
      background: "Restrained product field behind the metric",
      cameraIntent: "host-owned lens paperwork ".repeat(60),
      continuityAnchor: "release-readiness",
      outgoingCut: "host-owned cut paperwork ".repeat(60),
      startSec: index * 4,
      durationSec: 4,
      moments: [{
        version: 1 as const,
        id: `visible-moment-${index + 1}`,
        sceneId: `proof-${index + 1}`,
        atSec: index * 4 + 1,
        title: "Planner moment title",
        visualState: `visible-state-${index + 1}`,
        change: "The continuity metric develops without resetting.",
        motionIntent: "ui-state" as const,
        importance: "primary" as const,
      }],
    }));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-prompt-headroom-"));
    try {
      const brief = "Headroom carries one release-readiness metric across five scenes.";
      const prompt = creationPrompt({
        brief,
        projectDir,
        skills: retrieveHyperframesSkillContext("create", brief),
        frameMd: "# Frame\nDark product field with one bright continuity metric.\n".repeat(40),
        lockedStoryboard: storyboard,
        slots: true,
      });
      expect(prompt.length).toBeLessThanOrEqual(
        AUTHOR_PROMPT_TARGET_CHARS - AUTHOR_PROMPT_FEEDBACK_HEADROOM_CHARS,
      );
      expect(prompt).toContain("visible-state-5");
      expect(prompt).not.toContain(plannerOnly);
      expect(prompt).toContain("Scene interior templates");
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it.runIf(CURRENT_PROOF_D_AVAILABLE)(
    "recomposes the exact CurrentProof D initial and full re-author with feedback headroom",
    () => {
      const input = JSON.parse(fs.readFileSync(
        CURRENT_PROOF_D_INPUT,
        "utf8",
      )) as Parameters<typeof assembleBrief>[0];
      const brief = assembleBrief(input);
      const storyboard = (JSON.parse(fs.readFileSync(
        path.join(CURRENT_PROOF_D_DIR, "planning", "storyboard.json"),
        "utf8",
      )) as { storyboard: ReturnType<typeof buildFallbackComposition>["storyboard"] }).storyboard;
      const firstFindings = (JSON.parse(fs.readFileSync(
        path.join(
          CURRENT_PROOF_D_DIR,
          "planning",
          "attempts",
          "author-1-static-rejected.json",
        ),
        "utf8",
      )) as { findings: string[] }).findings;
      const validationFeedback = [
        ...firstFindings,
        "The proposed patch was rejected atomically because it made the last valid scratch fail static validation:",
        ...firstFindings,
      ];
      const skills = retrieveHyperframesSkillContext("create", brief);
      const frameMd = fs.readFileSync(path.join(CURRENT_PROOF_D_DIR, "frame.md"), "utf8");
      const slotPrompt = creationPrompt({
        brief,
        projectDir: CURRENT_PROOF_D_DIR,
        skills,
        frameMd,
        lockedStoryboard: storyboard,
        slots: true,
      });
      const prompt = creationPrompt({
        brief,
        projectDir: CURRENT_PROOF_D_DIR,
        skills,
        frameMd,
        lockedStoryboard: storyboard,
        validationFeedback,
        compact: true,
      });
      const ceilingWithHeadroom =
        AUTHOR_PROMPT_TARGET_CHARS - AUTHOR_PROMPT_FEEDBACK_HEADROOM_CHARS;
      expect(slotPrompt.length).toBeLessThanOrEqual(ceilingWithHeadroom);
      expect(prompt.length).toBeLessThanOrEqual(ceilingWithHeadroom);
      expect(prompt).toContain("metric-resolves-91");
      expect(prompt).toContain("Mandatory scene skeleton");
      expect(prompt).toContain("Frame design capsule");
      expect(prompt.match(/progress beat "rule-draw-41"/g)).toHaveLength(1);
    },
  );

  it.runIf(PROOF_SPAN_G_AVAILABLE)(
    "recomposes the exact ProofSpan G final full re-author below the hard cap",
    () => {
      const input = JSON.parse(fs.readFileSync(
        PROOF_SPAN_G_INPUT,
        "utf8",
      )) as Parameters<typeof assembleBrief>[0];
      const brief = assembleBrief(input);
      const storyboard = (JSON.parse(fs.readFileSync(
        path.join(PROOF_SPAN_G_DIR, "planning", "storyboard.json"),
        "utf8",
      )) as { storyboard: ReturnType<typeof buildFallbackComposition>["storyboard"] }).storyboard;
      const firstFinding = (JSON.parse(fs.readFileSync(
        path.join(
          PROOF_SPAN_G_DIR,
          "planning",
          "attempts",
          "author-1-static-rejected.json",
        ),
        "utf8",
      )) as { findings: string[] }).findings[0]!;
      const validationFeedback = [
        firstFinding,
        "The proposed patch was rejected atomically because it made the last valid scratch fail static validation:",
        firstFinding,
      ];
      const prompt = creationPrompt({
        brief,
        projectDir: PROOF_SPAN_G_DIR,
        skills: retrieveHyperframesSkillContext("create", brief),
        frameMd: fs.readFileSync(path.join(PROOF_SPAN_G_DIR, "frame.md"), "utf8"),
        lockedStoryboard: storyboard,
        validationFeedback,
        compact: true,
        structuredPatches: true,
      });

      expect(prompt.length).toBeLessThanOrEqual(
        AUTHOR_PROMPT_TARGET_CHARS - AUTHOR_PROMPT_FEEDBACK_HEADROOM_CHARS,
      );
      expect(prompt).toContain("approval-press");
      expect(prompt).toContain("Ready state held with ambient UI breathing");
      expect(prompt).toContain("Mandatory scene skeleton");
      expect(prompt).toContain("Frame design capsule");
      expect(prompt).toContain("Motion-native components — locked recovery");
      expect(prompt).toContain("Cinematography — locked recovery");
      expect(prompt).toContain(firstFinding);
      assertAuthorPromptBudget(prompt, "author source");
    },
  );

  it("keeps repair excerpts exact and includes the reported late source", () => {
    const source = `${"x".repeat(70_000)}<div data-part="repair-target">${"y".repeat(40_000)}</div>`;
    const compact = compactRepairSource(source, ['data-part="repair-target"']);
    expect(compact.length).toBeLessThanOrEqual(30_000);
    expect(compact).toContain('<div data-part="repair-target">');
    expect(compact).toContain("omitted exact source context");
  });

  it("compacts the locked whole-document director without dropping creative guidance", () => {
    const director = fs.readFileSync(path.join(APP_DIR, "prompts", "planning-director.md"), "utf8");
    const compact = compactLockedDirectorPrompt(director);
    expect(compact.length).toBeLessThan(director.length / 2);
    expect(compact).not.toContain("## Architecture laws");
    expect(compact).not.toContain("## Hard runtime contract");
    expect(compact).toContain("## Motion doctrine");
    expect(compact).toContain("Full-document response contract");
  });

  it("rejects an oversized author request before a provider call", () => {
    let error: unknown;
    try {
      assertAuthorPromptBudget("x".repeat(AUTHOR_PROMPT_TARGET_CHARS + 1), "author patch");
    } catch (caught) {
      error = caught;
    }
    expect(isAuthorPromptBudgetError(error)).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/hard author prompt budget/);
    expect(() => assertAuthorPromptBudget("x".repeat(AUTHOR_PROMPT_TARGET_CHARS + 1), "storyboard"))
      .not.toThrow();
  });
});
