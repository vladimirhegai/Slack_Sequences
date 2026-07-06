import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { creationPrompt } from "../src/engine/compositionRunner.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import { retrieveHyperframesSkillContext } from "../src/agent/skillContext.ts";

const APP_DIR = path.resolve(fileURLToPath(import.meta.url), "../..");

/**
 * SENTINEL_PLAN.md §3 Phase 4 item 2. Two ceilings, one purpose: growing the
 * prompt must require consciously raising a tested number a reviewer sees.
 *
 * 1. `planning-director.md` — the editable base prompt — stays within its
 *    post-Phase-1 byte count + 10%. This one is ENFORCED and passing.
 * 2. The ASSEMBLED author prompt for a fixture job — target ≤ 45,000 chars —
 *    is currently unreachable (see the `.todo` and the structural-floor test
 *    below): the base director prompt (~37k) plus the "create" RAG budget
 *    (28k) already exceed 45k before the storyboard JSON, frame.md, component
 *    reference, and skeleton. Reaching it needs structural cuts documented in
 *    SENTINEL.md "Prompt budget", not a quiet ceiling bump. Until then a
 *    regression guard holds the line at the measured level.
 */
const PLANNING_DIRECTOR_BASELINE_BYTES = 37_010; // post-Phase-1 (SENTINEL_REPORT)
const PLANNING_DIRECTOR_BUDGET_BYTES = Math.round(PLANNING_DIRECTOR_BASELINE_BYTES * 1.1); // 40,711
const AUTHOR_PROMPT_TARGET_CHARS = 45_000;
// NOT the target — the current-state anti-growth guard. Lower it as prompt
// surgery lands (Phase 5 scaffold-prose deletion, a skills-budget diet, a
// director-prompt split); never raise it without a written justification in
// SENTINEL.md. The fixture below measures ~81k; the ceiling carries headroom
// for minor deterministic RAG/storyboard drift, not for new prose.
const AUTHOR_PROMPT_REGRESSION_CEILING = 88_000;

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

describe("Prompt budget — assembled author prompt", () => {
  // The target the plan sets. Marked todo (not silently skipped) because it is
  // structurally unreachable this phase — the reduction plan lives in
  // SENTINEL.md "Prompt budget". Flip this to a real `it(...)` the moment the
  // fixture drops below 45k.
  it.todo("assembled author prompt for a fixture job ≤ 45,000 chars (target)");

  it("proves the structural floor: base prompt + create-skills already exceed 45k", () => {
    // Documents WHY the target is a todo: reaching it needs structural cuts, not
    // prose trimming. If this ever fails, the floor moved — reconsider the todo.
    const { directorChars, skillsChars } = assembledFixturePrompt();
    expect(directorChars + skillsChars).toBeGreaterThan(AUTHOR_PROMPT_TARGET_CHARS);
  });

  it("holds the assembled prompt at its measured regression ceiling", () => {
    const { prompt } = assembledFixturePrompt();
    // eslint-disable-next-line no-console
    console.log(`[promptBudget] assembled fixture author prompt: ${prompt.length} chars`);
    expect(
      prompt.length,
      `Assembled author prompt grew to ${prompt.length} chars (ceiling ` +
        `${AUTHOR_PROMPT_REGRESSION_CEILING}). This is the anti-growth guard, not the ` +
        `45k target — if the growth is intentional and justified, raise the ceiling ` +
        `WITH a note in SENTINEL.md; otherwise cut what you added.`,
    ).toBeLessThanOrEqual(AUTHOR_PROMPT_REGRESSION_CEILING);
  });
});
