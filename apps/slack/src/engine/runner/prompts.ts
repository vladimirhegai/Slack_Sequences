import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CompleteOptions } from "@sequences/platform/providers";
import type { RetrievedSkillContext } from "../../agent/skillContext.ts";
import type { DirectCompositionDraft, DirectScene } from "../directComposition.ts";
import { resolveCutPlan } from "../cutContract.ts";
import { sceneScopes } from "../cameraContract.ts";
import {
  componentAuthoringReference,
  type ComponentKind,
} from "../componentContract.ts";
import { frameCapsule } from "../frameDesign.ts";
import { recordSentinelDegradation } from "../sentinelTelemetry.ts";
import { sentinelSkeletonEnabled } from "../sentinelFlags.ts";
import type { ParsedSceneSlots } from "../sceneSlots.ts";
import {
  CAMERA_CELL_STRIDE_X,
  CAMERA_CELL_STRIDE_Y,
  MAX_REPAIR_PATCHES,
  regexpEscape,
} from "./repairs.ts";
import {
  buildSceneSkeletons,
  buildSceneSlotInteriors,
} from "./scaffold.ts";
import {
  cutSignatureBoundary,
  findingSignature,
} from "./findingSignatures.ts";
import type { DirectCompositionArgs } from "./types.ts";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DIRECTOR_PROMPT = fs.readFileSync(
  path.join(APP_DIR, "prompts", "planning-director.md"),
  "utf8",
);


export const COMPOSITION_SOURCE_BUDGET_CHARS = 38_000;
/** Hard ceiling for every source-authoring and source-repair request. */
export const AUTHOR_PROMPT_BUDGET_CHARS = 45_000;
/** Space reserved for deterministic findings on a production-shaped locked plan. */
export const AUTHOR_PROMPT_FEEDBACK_HEADROOM_CHARS = 512;
const REPAIR_SOURCE_CONTEXT_CHARS = 30_000;
const BOUNDED_INITIAL_SKILL_BUDGET_CHARS = 24_000;
const COMPACT_SKILL_BUDGET_CHARS = 16_000;
// LP-3 `lp3-state-capsule-20260712-a` produced a valid five-scene typed plan
// whose slot prompt was 46,602 chars. The scene templates and locked plan are
// load-bearing; the shared skill capsule is optional reference material and is
// already present upstream at planning time. Keep only its compact lead here
// so production-shaped typed plans retain headroom for deterministic feedback.
const SLOT_SKILL_BUDGET_CHARS = 2_000;

export class AuthorPromptBudgetError extends Error {
  readonly code = "AUTHOR_PROMPT_BUDGET";

  constructor(stage: string, promptChars: number) {
    super(
      `${stage} prompt is ${promptChars} chars; the hard author prompt budget is ` +
        `${AUTHOR_PROMPT_BUDGET_CHARS} chars. Compact the composed context before calling the provider.`,
    );
    this.name = "AuthorPromptBudgetError";
  }
}

export function isAuthorPromptBudgetError(error: unknown): error is AuthorPromptBudgetError {
  return error instanceof AuthorPromptBudgetError ||
    (error instanceof Error && (error as Error & { code?: string }).code === "AUTHOR_PROMPT_BUDGET");
}
function compactSkillText(text: string, budgetChars = COMPACT_SKILL_BUDGET_CHARS): string {
  const compacted = text
    .replace(/<(blueprint|motion-rule)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
  if (compacted.length <= budgetChars) return compacted;
  const paragraphEnd = compacted.lastIndexOf("\n\n", budgetChars);
  return compacted.slice(0, paragraphEnd >= Math.floor(budgetChars * 0.8) ? paragraphEnd : budgetChars);
}
function boundedInitialSkillText(text: string): string {
  const compacted = text.replace(/\n{3,}/g, "\n\n");
  if (compacted.length <= BOUNDED_INITIAL_SKILL_BUDGET_CHARS) return compacted;
  const paragraphEnd = compacted.lastIndexOf("\n\n", BOUNDED_INITIAL_SKILL_BUDGET_CHARS);
  return compacted.slice(
    0,
    paragraphEnd >= Math.floor(BOUNDED_INITIAL_SKILL_BUDGET_CHARS * 0.8)
      ? paragraphEnd
      : BOUNDED_INITIAL_SKILL_BUDGET_CHARS,
  );
}
export function availableAssets(projectDir: string): string {
  const assetsDir = path.join(projectDir, "assets");
  if (!fs.existsSync(assetsDir)) return "No project assets are available.";
  const files = fs.readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `- assets/${entry.name}`);
  return files.length ? files.join("\n") : "No project assets are available.";
}

/**
 * The author prompt is the expensive input-side budget. Keep the check next
 * to the prompt builder so every paid author/patch seam can enforce the same
 * ceiling before a provider request is made.
 */
export function assertAuthorPromptBudget(prompt: string, stage: string): void {
  if (!/^(author source|author patch|critique patch)$/i.test(stage)) return;
  if (prompt.length <= AUTHOR_PROMPT_BUDGET_CHARS) return;
  throw new AuthorPromptBudgetError(stage, prompt.length);
}

function repairPromptNeedles(findings: readonly string[]): string[] {
  const candidates = new Set<string>();
  for (const finding of findings) {
    for (const match of finding.matchAll(/(?:["'`])([^"'`\r\n]{3,96})(?:["'`])/g)) {
      candidates.add(match[1]!);
    }
    for (const match of finding.matchAll(/(?:data-[a-z0-9-]+|[#.]?[a-z_][a-z0-9_-]{3,})/gi)) {
      candidates.add(match[0]!);
    }
  }
  return [...candidates]
    .filter((needle) => needle.length >= 3)
    .sort((a, b) => b.length - a.length);
}

/**
 * Repair patches only need exact source windows around the reported defect.
 * Sending a 120k HTML document to fix one selector made the repair prompt the
 * largest input in the run. The returned windows are byte-exact slices of the
 * current source; the marker is prompt-only and never reaches the patcher.
 */
export function compactRepairSource(
  html: string,
  findings: readonly string[],
  budgetChars = REPAIR_SOURCE_CONTEXT_CHARS,
): string {
  if (html.length <= budgetChars) return html;

  type Range = { start: number; end: number; priority: number };
  const ranges: Range[] = [
    { start: 0, end: Math.min(html.length, 4_000), priority: 1 },
    { start: Math.max(0, html.length - 4_000), end: html.length, priority: 1 },
  ];
  const needles = repairPromptNeedles(findings);
  for (const needle of needles.slice(0, 48)) {
    let from = 0;
    let hits = 0;
    while (hits < 4) {
      const at = html.indexOf(needle, from);
      if (at < 0) break;
      ranges.push({
        start: Math.max(0, at - 1_400),
        end: Math.min(html.length, at + needle.length + 1_400),
        priority: 3,
      });
      from = at + needle.length;
      hits += 1;
    }
  }
  // When a finding contains no source token, retain a few evenly-spaced exact
  // windows so a patch can still discover the relevant structure without the
  // old whole-document payload.
  if (ranges.length === 2) {
    const window = 2_000;
    for (let index = 1; index <= 8; index += 1) {
      const center = Math.round((html.length * index) / 9);
      ranges.push({
        start: Math.max(0, center - window / 2),
        end: Math.min(html.length, center + window / 2),
        priority: 1,
      });
    }
  }

  const selected: Range[] = [];
  let selectedChars = 0;
  for (const range of [...ranges].sort((a, b) => b.priority - a.priority || a.start - b.start)) {
    const length = range.end - range.start;
    if (selectedChars + length > budgetChars) continue;
    selected.push(range);
    selectedChars += length;
  }
  selected.sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of selected) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      previous.priority = Math.max(previous.priority, range.priority);
    } else {
      merged.push({ ...range });
    }
  }
  const marker = "\n<!-- omitted exact source context; patch only text visible in these slices -->\n";
  let output = merged.map((range) => html.slice(range.start, range.end)).join(marker);
  if (output.length > budgetChars) output = output.slice(0, budgetChars);
  return output;
}

/** Prompt-only projection: host contracts are already present in the scaffold. */
function authorStoryboardPromptProjection(
  scene: DirectScene,
  compactRecovery = false,
): Record<string, unknown> {
  const projected = authorStoryboardProjection(scene);
  const {
    id,
    title,
    purpose,
    incomingIdea,
    foreground,
    background,
    cameraIntent,
    continuityAnchor,
    startSec,
    durationSec,
    blueprint,
    rules,
    outgoingCut,
    moments,
  } = projected;
  if (compactRecovery) {
    // A full-document recovery already carries the exact scene skeleton and
    // host-owned camera/cut/continuity bindings. Keep the creative scene thesis
    // plus every visible moment, but omit the planner's duplicate incoming,
    // lens, cut, moment-id, and motion-taxonomy prose. CurrentProof D proved
    // that resending those parallel descriptions can make the non-optional
    // locked context exceed the 45k preflight after all skills are removed.
    return {
      id,
      title,
      foreground,
      background,
      continuityAnchor,
      startSec,
      durationSec,
      moments: moments?.map(({ atSec, visualState, change, importance }) => ({
        atSec,
        visualState,
        change,
        importance,
      })),
    };
  }
  return {
    id,
    title,
    purpose,
    incomingIdea,
    foreground,
    background,
    cameraIntent,
    continuityAnchor,
    startSec,
    durationSec,
    blueprint,
    rules,
    outgoingCut,
    moments: moments?.map(({ version, id: momentId, atSec, title: momentTitle, visualState, change, motionIntent, importance }) => ({
      version,
      id: momentId,
      atSec,
      title: momentTitle,
      visualState,
      change,
      motionIntent,
      importance,
    })),
  };
}

function uniqueValidationFeedback(findings: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  return (findings ?? []).filter((finding) => {
    const signature = findingSignature(finding);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

/**
 * The author-facing view of one locked-storyboard scene: plugin-lowered
 * components and beats collapse back into their one-line `plugins`
 * declaration (the host injects the whole unit — an author who sees N lowered
 * tiles WILL author N duplicate roots), while everything author-owned passes
 * through untouched. Exported for tests.
 */
export function authorStoryboardProjection<T extends Partial<DirectScene>>(scene: T): T {
  const pluginComponents = new Set(
    (scene.components ?? []).flatMap((component) => (component.pluginUid ? [component.id] : [])),
  );
  if (!pluginComponents.size) return scene;
  const components = (scene.components ?? []).filter(
    (component) => !component.pluginUid,
  );
  const beats = (scene.beats ?? []).filter(
    (beat) => !pluginComponents.has(beat.component),
  );
  return {
    ...scene,
    ...(components.length ? { components } : { components: undefined }),
    ...(beats.length ? { beats } : { beats: undefined }),
  };
}

/**
 * The markup contract for exactly the component kinds these scenes declare.
 * Empty when no scene declares components, so plain films pay no prompt cost.
 */
function componentReferenceFor(scenes: DirectScene[] | undefined): string {
  const kinds = new Set<ComponentKind>();
  for (const scene of scenes ?? []) {
    for (const component of scene.components ?? []) {
      // Plugin-owned components are host-injected; the author never writes
      // their markup, so their kinds cost no authoring-reference budget.
      if (!component.pluginUid) kinds.add(component.kind);
    }
  }
  return kinds.size ? componentAuthoringReference(kinds) : "";
}

/**
 * Deterministic placement text for scenes whose storyboard pinned camera
 * stations to world grid cells. Free placement is the main source of
 * clipping and off-camera stations; exact rects remove the guesswork
 * without any schema change on the author's side.
 */
function worldLayoutGuidance(scenes: DirectScene[]): string {
  const blocks = scenes
    .filter((scene) => scene.worldLayout?.length)
    .map((scene) => {
      const cells = scene.worldLayout!;
      const xs = cells.map((entry) => entry.cell[0]);
      const ys = cells.map((entry) => entry.cell[1]);
      // Cell [0,0] is the entry framing and always part of the plane.
      const minX = Math.min(...xs, 0);
      const minY = Math.min(...ys, 0);
      const planeW = (Math.max(...xs, 0) - minX) * CAMERA_CELL_STRIDE_X + 1920;
      const planeH = (Math.max(...ys, 0) - minY) * CAMERA_CELL_STRIDE_Y + 1080;
      const rows = cells.map(({ region, cell, fitScale }) => {
        const scale = Math.min(1, Math.max(0.55, fitScale ?? 1));
        const width = Math.round(1400 * scale);
        const height = Math.round(800 * scale);
        const left = (cell[0] - minX) * CAMERA_CELL_STRIDE_X + 260 +
          Math.round((1400 - width) / 2);
        const top = (cell[1] - minY) * CAMERA_CELL_STRIDE_Y + 140 +
          Math.round((800 - height) / 2);
        return `  - data-region="${region}": position:absolute; left:${left}px; top:${top}px; ` +
          `width:${width}px; height:${height}px — keep its content inside with at least an 8% inner margin`;
      });
      return [
        `- scene "${scene.id}": size its data-camera-world plane exactly ` +
          `${planeW}x${planeH}px and place each station at these rects:`,
        ...rows,
      ].join("\n");
    });
  if (!blocks.length) return "";
  return [
    "## World-layout station map (deterministic placement)",
    "The locked storyboard pinned each camera station to a viewport-sized grid",
    "cell. Use these exact plane sizes and station rects verbatim — they",
    "guarantee stations never clip each other or drift half out of frame:",
    ...blocks,
  ].join("\n");
}

/**
 * Small always-on layout reminders derived from the locked storyboard —
 * the cheap deterministic guardrails that otherwise cost a repair round.
 */
function lockedLayoutGuidance(scenes: DirectScene[]): string {
  const lines = [
    "## Layout guidance (derived from the locked storyboard)",
    "- Keep primary content inside the 5% safe area of its framing. Content at",
    "  a camera station must fit that station's box; never let two stations'",
    "  content overlap on the plane.",
  ];
  const morphPairs = scenes.flatMap((scene) =>
    (scene.beats ?? [])
      .filter((beat) => beat.kind === "morph" && beat.morphTo)
      .map((beat) => `${beat.component}→${beat.morphTo}`)
  );
  if (morphPairs.length) {
    lines.push(
      `- Morph twins (${[...new Set(morphPairs)].join(", ")}) need comparable box`,
      "  shapes, corner radii, and visual weight so the FLIP reads as one object",
      "  transforming rather than a jump.",
    );
  }
  const shapePairs = scenes.flatMap((scene) =>
    (scene.cut?.style === "morph" || scene.cut?.style === "shape-match") &&
      scene.cut.focalPartOut && scene.cut.focalPartIn
      ? [`${scene.cut.focalPartOut}→${scene.cut.focalPartIn}`]
      : []
  );
  if (shapePairs.length) {
    lines.push(
      `- Morph focal parts (${[...new Set(shapePairs)].join(", ")}) must keep`,
      "  comparable aspect ratios and border radii (within ~2.5×) and light",
      "  subtrees (≤60 nodes) or the boundary degrades to a swipe at bind",
      "  time. Keep both parts on-frame at their scene's entry framing.",
    );
  }
  const focusScenes = scenes.filter((scene) =>
    scene.camera?.path.some((move) => move.focus)
  );
  if (focusScenes.length) {
    lines.push(
      `- Scenes ${focusScenes.map((scene) => `"${scene.id}"`).join(", ")} plan a rack-focus`,
      "  pull: build each with 2+ data-depth layers (context plane ~0.3, payoff",
      "  on the world plane) and author any focus.part as a scene-scoped",
      "  data-part. The rig owns all blur.",
    );
  }
  const orbitScenes = scenes.filter((scene) =>
    scene.camera?.path.some((move) => move.move === "orbit")
  );
  if (orbitScenes.length) {
    lines.push(
      `- Scenes ${orbitScenes.map((scene) => `"${scene.id}"`).join(", ")} orbit in 3D:`,
      "  keep them graphic (logo, hero UI, marks) rather than long copy, and",
      "  author no perspective/rotateY/transform-style of your own.",
    );
  }
  const hasSimultaneousBeats = scenes.some((scene) => {
    const times = (scene.beats ?? []).map((beat) => beat.atSec).sort((a, b) => a - b);
    return times.some((time, index) => index >= 2 && time - times[index - 2]! <= 0.1);
  });
  if (hasSimultaneousBeats) {
    lines.push(
      "- Three or more component beats land together: lay their components on a",
      "  shared grid with one consistent gap, so the cascade settles as a set.",
    );
  }
  return lines.join("\n");
}

/**
 * A machine-readable endpoint checklist for bridged-cut findings. A compact
 * patch shown only the failing side routinely edits the wrong scene or
 * deletes the healthy endpoint while "fixing" the broken one (the 2026-07-04
 * stall): show both endpoints with live present/missing status and the one
 * required action.
 */
function bridgedCutRepairChecklist(
  findings: string[],
  scenes: DirectScene[],
  html: string,
): string {
  const failing = new Set(
    findings
      .map((finding) => cutSignatureBoundary(findingSignature(finding)))
      .filter((boundary): boundary is string => Boolean(boundary)),
  );
  if (!failing.size) return "";
  const scopes = new Map(sceneScopes(html).map((scene) => [scene.id, scene.scope]));
  const status = (part: string, sceneId: string): string => {
    const pattern = new RegExp(
      `\\bdata-part\\s*=\\s*(["'])${regexpEscape(part)}\\1`,
      "i",
    );
    return pattern.test(scopes.get(sceneId) ?? "") ? "present" : "MISSING";
  };
  const rows = resolveCutPlan(scenes).cuts.flatMap((cut) => {
    if (!failing.has(`${cut.fromScene}->${cut.toScene}`)) return [];
    if (!cut.focalPartOut || !cut.focalPartIn) return [];
    return [
      `- ${cut.style} ${cut.fromScene} -> ${cut.toScene}`,
      `  outgoing: data-part="${cut.focalPartOut}" in scene "${cut.fromScene}" ` +
        `[${status(cut.focalPartOut, cut.fromScene)}]`,
      `  incoming: data-part="${cut.focalPartIn}" in scene "${cut.toScene}" ` +
        `[${status(cut.focalPartIn, cut.toScene)}]`,
    ];
  });
  if (!rows.length) return "";
  return [
    "## Bridged-cut endpoint checklist",
    "Each cut below carries one focal element across its boundary and binds",
    "scene-scoped on BOTH sides. Add the missing data-part attribute to exactly",
    "one existing focal element already inside the named scene — the element",
    "that visually plays that role. Never create a new element for it, never",
    "edit the side marked present, and never remove any other data-part,",
    "data-region, or data-component attribute while doing so.",
    ...rows,
  ].join("\n");
}


/** Prompt lines showing each scene's interior template for the slot path. */
function slotSceneTemplates(storyboard: DirectScene[]): string[] {
  const interiors = buildSceneSlotInteriors(storyboard);
  const lines = [
    "## Scene interior templates (fill each; the host owns the wrappers)",
    "The host owns the document chassis, every <section> wrapper (its id, timing,",
    "and track), the paused GSAP timeline, its registration, and every runtime,",
    "JSON island, and compile seam. You author only the shared film style, each",
    "scene's INTERIOR html, and each scene's timeline statements. For each scene",
    "the template below is the host contract: keep its data-camera-world plane,",
    "data-region stations, component roots (data-part/data-component), and focal",
    "carriers; fill and restyle the … placeholders and placeholder copy. Never",
    "author a <section>, <html>, <head>, <body>, a gsap.timeline, a",
    "window.__timelines registration, or a JSON island.",
  ];
  for (const scene of storyboard) {
    lines.push(
      "",
      `<scene_html id="${scene.id}">`,
      interiors.get(scene.id) ?? "…compose this scene's interior…",
      "</scene_html>",
    );
  }
  return lines;
}

/** The scene-slot response contract (replaces the single <index_html>). */
function slotResponseContract(storyboard: DirectScene[]): string {
  const ids = storyboard.map((scene) => scene.id).join(", ");
  return [
    "## Response contract (scene slots)",
    "Return these tags and nothing else — no <index_html>, no storyboard_json,",
    "no <html>/<head>/<body>, no prose or Markdown fences:",
    "- exactly one <film_style>…</film_style>: the shared <style> payload (design",
    "  tokens, shared classes) used across every scene. Do not repeat per-scene",
    "  styles the film style already covers.",
    "- one <scene_html id=\"<scene-id>\">…</scene_html> per scene: the INTERIOR of",
    "  that scene only (no <section> wrapper). Fill its template.",
    "- one <scene_script id=\"<scene-id>\">…</scene_script> per scene: the GSAP",
    "  statements for that scene, appended into a host-owned (tl) => { … } function.",
    "  Call tl.to/tl.from/tl.fromTo/tl.set and pass every absolute composition",
    "  time as the final position argument. Never call global gsap.to/from/fromTo/set",
    "  or use delay as a clock. Include the scene's",
    "  entrances and information beats on INTERIOR elements. The host owns the",
    "  stage (root sizing, absolute scene stacking) and scene-window visibility",
    "  (each scene is revealed at its start and cleared at its end) — do NOT",
    "  author opacity sets on the scene wrapper itself, and do NOT create a",
    "  timeline, register it, seek it, or call any SequencesX.compile.",
    "  Each scene's statements run in their own function scope, so never rely on a",
    "  variable declared in another scene.",
    `Author every scene, in order: ${ids}.`,
    "Keep each scene's html + script focused; the whole response must stay under",
    "the output-size limit above.",
  ].join("\n");
}

/**
 * The director prompt's whole-document bullets, each with its slot-mode
 * replacement. In slot mode the host owns the chassis, section wrappers, the
 * paused timeline, and scene-window visibility — the base prompt telling the
 * author to build exactly those things is what produced the documented
 * "slot-envelope drift" (and the p7-denseui attempt that returned no slots at
 * all). Exact-match surgery, not prose appended after a contradiction: the
 * model must never see both instructions.
 *
 * Every entry MUST keep matching `prompts/planning-director.md` byte-for-byte —
 * `test/promptBudget.test.ts` fails if an anchor goes stale, so a prompt edit
 * that would silently resurrect the contradiction fails CI instead.
 */
export const SLOT_MODE_DIRECTOR_REWRITES: ReadonlyArray<{ find: string; replace: string }> = [
  {
    find:
      "- Return a complete HTML document with one root carrying\n" +
      "  `data-composition-id`, `data-width`, `data-height`, and finite\n" +
      "  `data-duration`.",
    replace:
      "- The host owns the document chassis: the root element and its\n" +
      "  `data-composition-id`, `data-width`, `data-height`, and `data-duration`\n" +
      "  are assembled deterministically. Author only the requested scene slots.",
  },
  {
    find:
      "- Use one paused GSAP timeline, initialized synchronously and registered as\n" +
      '  `window.__timelines["<composition-id>"]` after all tweens are authored.',
    replace:
      "- The host creates, registers, and seeks the single paused GSAP timeline;\n" +
      "  your `<scene_script>` statements are appended into it. Never create or\n" +
      "  register a timeline yourself.",
  },
  {
    find:
      '- Mark each storyboard scene with `class="scene clip"`, a stable `id`,\n' +
      "  `data-scene`, `data-start`, `data-duration`, and `data-track-index`.",
    replace:
      "- The host emits every scene `<section>` wrapper with its `id`,\n" +
      "  `data-scene`, timing, and track attributes. Never author a `<section>`\n" +
      "  wrapper yourself.",
  },
  {
    find:
      "- The paused timeline must own scene-window opacity so exactly the intended\n" +
      "  scene(s) are visible at every seeked time. Initialize all scene wrappers\n" +
      "  explicitly, reveal them at their `data-start`, and clear them at the end of\n" +
      "  their window; never rely on DOM order to cover inactive scenes.",
    replace:
      "- The host owns scene-window visibility: each scene is revealed at its\n" +
      "  start and cleared at the end of its window deterministically. Never\n" +
      "  author opacity sets on a scene wrapper; animate interior elements only.",
  },
  {
    find:
      "Return exactly these two tags and nothing else when no locked storyboard is\n" +
      "provided. When `<locked_storyboard_json>` is present, the job prompt overrides\n" +
      "this contract and requests only `<index_html>`.",
    replace:
      "The job prompt's scene-slot response contract overrides this section:\n" +
      "return one `<film_style>` plus per-scene `<scene_html>`/`<scene_script>`\n" +
      "tags — never `<index_html>` or a complete document.",
  },
];

/**
 * Rewrite the whole-document contract bullets for slot mode. A stale anchor
 * must never sink a live paid call, so a miss degrades to an explicit
 * precedence block appended after the director text (weaker than surgery, but
 * unambiguous) plus a stderr warning; `test/promptBudget.test.ts` asserts zero
 * misses so the drift is caught in CI, not in production.
 */
export function adaptDirectorPromptForSlots(
  prompt: string,
  misses?: string[],
): string {
  let adapted = prompt;
  let missed = false;
  for (const { find, replace } of SLOT_MODE_DIRECTOR_REWRITES) {
    if (!adapted.includes(find)) {
      missed = true;
      misses?.push(find);
      process.stderr.write(
        `[author] slot-mode director rewrite anchor no longer matches ` +
          `planning-director.md: "${find.slice(0, 60)}…" — update ` +
          `SLOT_MODE_DIRECTOR_REWRITES with the edit\n`,
      );
      continue;
    }
    adapted = adapted.replace(find, replace);
  }
  if (missed) {
    recordSentinelDegradation("slot-director-rewrite-fallback");
    adapted += [
      "",
      "",
      "## SLOT-MODE PRECEDENCE (overrides any contradicting rule above)",
      "The host owns the document chassis, every scene <section> wrapper, the",
      "single paused registered timeline, and scene-window visibility. Return",
      "ONLY <film_style> plus per-scene <scene_html>/<scene_script> tags —",
      "never <index_html>, a complete document, a timeline registration, or",
      "opacity sets on a scene wrapper.",
    ].join("\n");
  }
  return adapted;
}

/**
 * Slot mode does not need the base prompt's whole-document architecture/runtime
 * chapters: the host emits and validates that machinery. Remove those chapters
 * after anchor-checked contradiction surgery, retaining all creative, motion,
 * camera, component, cut, typography, color, and spatial-direction guidance.
 */
export function slotDirectorPrompt(prompt: string, misses?: string[]): string {
  const adapted = adaptDirectorPromptForSlots(prompt, misses);
  const precedenceMarker = "## SLOT-MODE PRECEDENCE";
  const precedenceAt = adapted.indexOf(precedenceMarker);
  const precedence = precedenceAt >= 0 ? adapted.slice(precedenceAt) : "";
  const body = precedenceAt >= 0 ? adapted.slice(0, precedenceAt) : adapted;
  const compact = body
    .replace(
      /## Storyboard moments[\s\S]*?(?=## Typed boundary cuts)/,
      [
        "## Storyboard moments",
        "Make every locked moment visibly true at its exact atSec using an interior",
        "state change, typed component beat, camera arrival, or cut. Do not retime it.",
        "",
      ].join("\n"),
    )
    .replace(
      /## Typed boundary cuts[\s\S]*?(?=## Continuous spatial world)/,
      [
        "## Typed boundary cuts",
        "The host compiles the locked cut graph. Preserve every named data-part",
        "endpoint and design matched silhouettes when the cut style asks for one.",
        "",
      ].join("\n"),
    )
    .replace(
      /## The Sequences ease library[\s\S]*?(?=## Cinematography)/,
      [
        "## Sequences easing",
        "Use the supplied seq* eases or standard GSAP eases; never invent an ease name.",
        "",
      ].join("\n"),
    )
    .replace(
      /## Architecture laws[\s\S]*?(?=## Spatial intent)/,
      "",
    )
    .replace(
      /## Spatial intent[\s\S]*?(?=## Hard runtime contract)/,
      [
        "## Spatial intent",
        "Treat locked worldLayout cells and camera stations as composition guides.",
        "Keep named data-region/data-part/data-component bindings intact. Animate",
        "interior elements only; the host owns camera, cuts, components, interactions,",
        "scene windows, runtime compilation, and the shared timeline.",
        "",
      ].join("\n"),
    )
    .replace(
      /## Hard runtime contract[\s\S]*$/,
      "",
    )
    .trim();
  const compacted = compactHostOwnedDirectorChapters(compact);
  return precedence ? `${compacted}\n\n${precedence}` : compacted;
}

function compactHostOwnedDirectorChapters(text: string): string {
  return text
    .replace(
      /## Continuous spatial world[\s\S]*?(?=## Motion-native components)/,
      [
        "## Continuous spatial world",
        "Use the locked data-camera-world plane and named data-region stations exactly as",
        "scaffolded. Keep product surfaces inside those bindings; the host owns camera",
        "motion, focal carriers, cuts, and interaction actors.",
        "",
      ].join("\n"),
    )
    .replace(
      /## Anti-patterns[\s\S]*?(?=## Spatial intent)/,
      [
        "## Anti-patterns",
        "Avoid generic SaaS gradients, repeated card grids, guessed coordinates, and",
        "ambient motion on copy that is meant to be read.",
        "",
      ].join("\n"),
    );
}

/**
 * Whole-document recovery still has to return `<index_html>`, but the locked
 * storyboard and scaffold already carry the camera, cut, component, and
 * runtime contracts. Keep the creative chapters and a short document seam;
 * do not resend the host's full contract encyclopedia on every repair.
 */
export function compactLockedDirectorPrompt(prompt: string, misses?: string[]): string {
  const compact = slotDirectorPrompt(prompt, misses)
    // Whole-document recovery already receives canonical component markup in
    // its mandatory skeleton plus the exact kind-scoped authoring reference.
    // Likewise, the host re-injects the selected cinematography kit. The base
    // chapters are useful during planning, but resending their full runtime
    // encyclopedias made ProofSpan G's final recovery prompt 46,522 chars even
    // after every optional skill byte and planner-only field were removed.
    // Retain the author-owned decisions and ownership boundary in compact form.
    .replace(
      /## Motion-native components[^\n]*[\s\S]*?(?=## Sequences easing)/,
      [
        "## Motion-native components — locked recovery",
        "The mandatory skeleton already contains each canonical component root and",
        "internal fill element. Fill its visible copy/content and style its placement;",
        "never delete, rename, duplicate, or re-animate a data-component/data-part root.",
        "The host compiles every locked component beat and interaction. Author only",
        "secondary interior polish that does not repeat those state changes.",
        "",
      ].join("\n"),
    )
    .replace(
      /## Cinematography[^\n]*[\s\S]*?(?=## Color)/,
      [
        "## Cinematography — locked recovery",
        "Use the supplied material/keylight/grade classes to reinforce the focal",
        "hierarchy; never redeclare the host light kit. Camera motion, depth, focus,",
        "grain, bloom, and vignette remain host-owned and seek-safe.",
        "",
      ].join("\n"),
    )
    .trim();
  return [
    compact,
    "",
    "## Full-document response contract",
    "Return exactly one <index_html> tag containing the complete document and nothing",
    "else. The host re-injects the locked typed plan after authoring; keep every",
    "scaffolded scene id, data-region, data-part, data-component, and timing intact.",
  ].join("\n");
}

export function creationPrompt(args: {
  brief: string;
  projectDir: string;
  skills: RetrievedSkillContext;
  frameMd?: string;
  current?: DirectCompositionDraft;
  revisionInstruction?: string;
  validationFeedback?: string[];
  scratch?: DirectCompositionDraft;
  lockedStoryboard?: DirectScene[];
  compact?: boolean;
  structuredPatches?: boolean;
  /** Sentinel Phase 2: request scene-addressable slots, not one <index_html>. */
  slots?: boolean;
}): string {
  const validationFeedback = uniqueValidationFeedback(args.validationFeedback);
  if (args.scratch) {
    const cutChecklist = bridgedCutRepairChecklist(
      validationFeedback,
      args.lockedStoryboard ?? args.scratch.storyboard,
      args.scratch.html,
    );
    const scratchContext = compactRepairSource(
      args.scratch.html,
      validationFeedback,
    );
    return [
      "SYSTEM: You are a precise HTML/CSS/GSAP repair engineer.",
      "Make the smallest exact source edits that resolve every listed finding. Preserve",
      "the art direction, copy, timing, scene graph, host bindings, and unrelated source.",
      "The host owns typed camera, cut, component, interaction, timeline, and runtime",
      "contracts: never retime or rename them, delete a data-part/data-region/",
      "data-component root, or duplicate typed motion. Reflow load-bearing text; do",
      "not annotate it away. For layout findings prefer the existing flow containers",
      "and measured station rects over guessed offsets. For motion/liveness findings",
      "use seek-safe child/component beats at explicit times, never wrapper activity.",
      "",
      "## Deterministic findings to repair",
      ...validationFeedback.map((issue) => `- ${issue}`),
      "",
      ...(cutChecklist ? [cutChecklist, ""] : []),
      "## Scratch HTML",
      "Only exact source excerpts are shown when the document exceeds the input budget;",
      "patch searches must be copied from the excerpts, never invented.",
      "<scratch_index_html>",
      scratchContext,
      "</scratch_index_html>",
      "",
      "## Response contract",
      args.structuredPatches
        ? `Return only a JSON object with a "patches" array of 1-${MAX_REPAIR_PATCHES} edits.`
        : `Return only <patches_json> containing a JSON array of 1-${MAX_REPAIR_PATCHES} edits.`,
      'Each edit is {"search":"exact unique substring from the current scratch","replace":"replacement"}.',
      "Edits run sequentially. Keep each search as short as possible while still unique.",
      "Use JSON escaping correctly. Do not return storyboard_json, index_html, Markdown, comments,",
      "explanations, or a rewritten document. The complete response must stay under 12,000 characters.",
    ].join("\n");
  }
  const current = args.current
    ? [
        "## Current canonical composition",
        "<current_storyboard>",
        JSON.stringify(args.current.storyboard, null, 2),
        "</current_storyboard>",
        "<current_index_html>",
        args.current.html,
        "</current_index_html>",
      ].join("\n")
    : "";
  const revision = args.revisionInstruction
    ? `## Revision request\n${args.revisionInstruction}\nPreserve what works and make this one coherent transactional revision.`
    : "";
  const feedback = validationFeedback.length
    ? [
        "## Deterministic validation feedback",
        "The previous scratch draft was not published. Repair every item below while preserving its visual thesis:",
        "For a deliberate entrance/exit or decorative overlap, add the narrowest",
        "matching data-layout-allow-* annotation to its moving wrapper. Hard",
        "clipped_text/text_box_overflow findings must be reflowed or resized;",
        "do not merely annotate load-bearing text.",
        "For motion/liveness findings, add a real mid-shot or back-half",
        "information beat with explicit timeline timing on a child/component or",
        "data-camera-world wrapper. Do not animate the scene wrapper itself.",
        "For storyboard/moments findings, author the promised changed state at",
        "the named atSec (a cut, camera arrival, interaction, or positioned",
        "component beat) instead of removing or retiming the moment.",
        ...validationFeedback.map((issue) => `- ${issue}`),
      ].join("\n")
    : "";
  const lockedStoryboardBlock = (compactProjection: boolean): string => args.lockedStoryboard
    ? [
        "## Locked storyboard and cut graph",
        "This plan was created and deterministically validated in a prior pass.",
        "Author every shot as a distinct scene. Match its ids and timings exactly;",
        "do not merge shots or redesign the cut graph while writing source.",
        "<locked_storyboard_json>",
        // Host-normalization notes are operator paperwork (STORYBOARD.md),
        // not authoring instructions — keep them out of the paid prompt.
        // Plugin-owned components/beats are likewise host business: the author
        // seeing them invites double-authoring the units the host injects, so
        // the projection collapses each unit back to its one-line declaration.
        JSON.stringify(args.lockedStoryboard.map((scene) =>
          authorStoryboardPromptProjection(scene, compactProjection)
        )),
        "</locked_storyboard_json>",
        "",
        // The host already knows the exact scene shells; handing them over
        // verbatim removes the whole authored-N-scenes-against-an-M-scene-plan
        // failure class (a live run burned a full paid attempt on 10 scenes
        // vs a 5-scene plan). The author spends budget on interiors only.
        // Sentinel Phase 2 (slots): the host owns the section wrapper, chassis,
        // and timeline; the author fills each scene's interior template.
        // Phase 1 (skeleton): full shells copied verbatim. Else: bare shells.
        ...(args.slots
          ? slotSceneTemplates(args.lockedStoryboard)
          : sentinelSkeletonEnabled()
          ? [
              "## Mandatory scene skeleton (copy verbatim; fill the interiors)",
              "Your <body> must contain EXACTLY these scene shells, in this order,",
              "with these exact tags. Copy each shell verbatim — its section",
              "wrapper, any data-camera-world plane, data-region stations,",
              "component roots (data-part/data-component), and focal-part carriers",
              "are the host contract. Fill and restyle the interiors (the … marks",
              "and placeholder copy); never add, remove, split, merge, or retime a",
              "scene, and never delete a data-camera-world, data-region, data-part,",
              "or data-component attribute the shell already carries:",
              ...buildSceneSkeletons(args.lockedStoryboard),
            ]
          : [
              "## Mandatory scene skeleton (copy verbatim)",
              "Your <body> must contain EXACTLY these scene shells, in this order, with",
              "these exact id/data-scene/data-start/data-duration values — copy each tag",
              "verbatim (you may add layout classes and fill the interior), and never",
              "add, remove, split, merge, or retime a scene:",
              ...args.lockedStoryboard.map((scene) =>
                `<section id="${scene.id}" class="scene clip" data-scene="${scene.id}" ` +
                `data-start="${scene.startSec}" data-duration="${scene.durationSec}" ` +
                `data-track-index="1">…your scene content…</section>`
              ),
            ]),
        ...(!args.slots ? [worldLayoutGuidance(args.lockedStoryboard)] : []),
        ...(!args.slots ? [lockedLayoutGuidance(args.lockedStoryboard)] : []),
      ].join("\n")
    : "";
  const lockedResponse = args.lockedStoryboard
    ? args.slots
      ? slotResponseContract(args.lockedStoryboard)
      : [
          "## Builder response override",
          "The storyboard already exists. Return exactly one <index_html> tag with",
          "the complete document and nothing else. Do not repeat storyboard_json.",
        ].join("\n")
    : "";
  const frame = args.frameMd
    ? [
        "## Frame design capsule (art direction + deterministic constraints)",
        "Start from this capsule. Preserve its color topology, committed brand",
        "hue/font families, embedded-font requirement, and contrast thresholds.",
        "Its recommended tints and spatial tokens may be adjusted deliberately as",
        "the document allows. Treat its material profile and motion signature as",
        "binding taste while keeping exact choreography and composition inventive.",
        "<frame_capsule>",
        frameCapsule(args.frameMd),
        "</frame_capsule>",
      ].join("\n")
    : "";
  // Slot templates already contain the exact host component roots. Repeating
  // the full catalog here only restates the typed contract and consumed most
  // of the budget in the six-scene incident; whole-document recovery retains
  // the reference because it still authors the outer document.
  const componentReference = args.slots
    ? ""
    : componentReferenceFor(args.lockedStoryboard ?? args.current?.storyboard);
  const directorPrompt = args.slots
    ? slotDirectorPrompt(DIRECTOR_PROMPT)
    : args.lockedStoryboard || args.compact
      ? compactLockedDirectorPrompt(DIRECTOR_PROMPT)
      : DIRECTOR_PROMPT;
  const selectedSkillText = args.slots
    ? compactSkillText(args.skills.text, SLOT_SKILL_BUDGET_CHARS)
    : args.compact
    ? compactSkillText(args.skills.text)
    : args.lockedStoryboard
    ? boundedInitialSkillText(args.skills.text)
    : args.skills.text;
  const compose = (authorSkillText: string, compactProjection: boolean): string => [
    "SYSTEM:",
    directorPrompt,
    "",
    authorSkillText,
    "",
    componentReference,
    "## Job brief and trusted evidence",
    args.brief,
    "",
    frame,
    "## Available project-local assets",
    availableAssets(args.projectDir),
    "",
    "## Output-size contract",
    `The entire response must stay under ${COMPOSITION_SOURCE_BUDGET_CHARS.toLocaleString("en-US")} characters.`,
    "Match the locked storyboard's scene count exactly when one is supplied;",
    "otherwise default to 4-6 scenes and lean on camera worlds for density.",
    "Scenes sharing one data-camera-world with several data-region stations are",
    "cheaper than extra full scenes — reuse CSS classes and shared primitives.",
    "Do not paste brief paragraphs into the frame. Product facts are evidence;",
    "turn them into terse labels, values, UI states, and short claims. A product",
    "beat requested in the brief must become visible component behavior, not a",
    "sentence describing that behavior.",
    "Spend the motion budget on information change: component state, camera",
    "arrival, object continuity, chart/trace resolution, cursor action, and",
    "kinetic type. Underlines, dividers, fades, glows, and ambient drift are",
    "supporting polish and never the main event of a storyboard moment.",
    "No comments, duplicated per-scene styles, embedded data URLs, verbose SVG",
    "paths, or explanatory text. Completeness outranks ornamental source volume.",
    args.compact
      ? "This is a compact recovery pass: finish the complete document well before the limit."
      : "",
    lockedStoryboardBlock(compactProjection),
    current,
    revision,
    feedback,
    lockedResponse,
  ].filter(Boolean).join("\n\n");
  const promptTarget = AUTHOR_PROMPT_BUDGET_CHARS - AUTHOR_PROMPT_FEEDBACK_HEADROOM_CHARS;
  let compactProjection = Boolean(args.compact);
  let fittedSkillText = selectedSkillText;
  let prompt = compose(fittedSkillText, compactProjection);
  if (args.lockedStoryboard && prompt.length > promptTarget && fittedSkillText) {
    // Typed plans and host scaffolds vary substantially by scene. A fixed
    // skill allowance passed the synthetic S6.1 fixture but failed two real
    // LP-3 plans. Fit the optional author reference to the remaining budget;
    // the full skill context already informed planning, while the locked plan,
    // frame capsule, and scaffold are the source-authoring contract.
    const overflow = prompt.length - promptTarget;
    const fittedBudget = Math.max(0, fittedSkillText.length - overflow);
    fittedSkillText = compactSkillText(fittedSkillText, fittedBudget);
    prompt = compose(fittedSkillText, compactProjection);
  }
  if (args.lockedStoryboard && prompt.length > promptTarget && !compactProjection) {
    // A plan can consume the headroom after every optional skill byte is gone
    // (CurrentProof D's first slot prompt was 44,829 chars). Keep every scene,
    // timing, visible moment, frame capsule, and scaffold, but collapse the
    // parallel planner descriptions already compiled into host contracts.
    compactProjection = true;
    prompt = compose(fittedSkillText, compactProjection);
  }
  return prompt;
}
/**
 * A compact continuation prompt for a truncated or contract-violating slot
 * response: keep every completed scene, re-request only the named scenes.
 * Carries the shared film style already produced (so the tail matches) and
 * only those scenes' interior templates — far cheaper than re-authoring the
 * whole film. When `repairNotes` is set this is a scaffold repair, not a
 * truncation: the defective scene's own html/script ride along as the
 * minimal-edit baseline (the storyboard findings-retry lesson — carrying the
 * artifact forward converges where re-draws whack-a-mole).
 */
export function slotContinuationPrompt(
  args: DirectCompositionArgs,
  filmStyle: string | undefined,
  missing: DirectScene[],
  repairNotes?: Map<string, string[]>,
  previousSlots?: ParsedSceneSlots,
  repairPurpose: "scaffold" | "validation" | "critique" = "scaffold",
): string {
  const noteHeader = (sceneId: string): string =>
    repairPurpose === "scaffold"
      ? `Host-contract findings for scene "${sceneId}" (restore these bindings):`
      : repairPurpose === "critique"
        ? `Creative critique notes for scene "${sceneId}" (apply as the smallest local edit):`
        : `Validation findings for scene "${sceneId}" (make the smallest correction):`;
  const interiors = buildSceneSlotInteriors(args.lockedStoryboard ?? []);
  const templates = missing.flatMap((scene) => {
    const notes = repairNotes?.get(scene.id) ?? [];
    const previous = previousSlots?.scenes.get(scene.id);
    return [
      "",
      ...(notes.length
        ? [
            noteHeader(scene.id),
            ...notes.map((note) => `- ${note}`),
          ]
        : []),
      ...(previous?.html?.trim()
        ? [
            "Your previous interior for this scene (keep its content and copy;",
            "change ONLY what the findings above require):",
            `<previous_scene_html id="${scene.id}">`,
            previous.html,
            "</previous_scene_html>",
          ]
        : []),
      ...(previous?.script?.trim()
        ? [
            "Your previous scene script (keep its motion unless a finding requires a change):",
            `<previous_scene_script id="${scene.id}">`,
            previous.script,
            "</previous_scene_script>",
          ]
        : []),
      `<scene_html id="${scene.id}">`,
      interiors.get(scene.id) ?? "…compose this scene's interior…",
      "</scene_html>",
    ];
  });
  const intro = repairNotes
    ? repairPurpose === "scaffold"
      ? "Some scenes came back without host-contract bindings the template carried. The" +
        "\nother scenes are kept; re-author ONLY the scenes below, keeping each template's" +
        "\ndata-camera-world plane, data-region stations, and component roots" +
        "\n(data-part/data-component) exactly as given."
      : repairPurpose === "critique"
        ? "The film shipped, but the continuity critic asked for small local improvements." +
          "\nEvery unlisted scene is locked and kept byte-for-byte. Re-author ONLY the listed" +
          "\nscenes as minimal edits; preserve their copy, visual thesis, host bindings, and" +
          "\nmotion unless a critique note calls for a change."
        : "The assembled film has scene-local validation findings. Every unlisted scene is" +
          "\nlocked and kept byte-for-byte. Re-author ONLY the listed scenes as minimal edits;" +
          "\npreserve their copy, visual thesis, host bindings, and motion unless a finding" +
          "\nexplicitly requires a change."
    : "The previous response was cut off. The completed scenes are kept; author ONLY" +
      "\nthe missing scenes below, matching the established film style exactly.";
  return [
    "SYSTEM: You are the HyperFrames author finishing a partly-written launch film.",
    intro,
    "",
    "## Job brief and trusted evidence",
    args.brief,
    "",
    ...(filmStyle
      ? ["## Established film style (already applied; reuse its classes/tokens)", "<film_style>", filmStyle, "</film_style>", ""]
      : []),
    "## Missing scene interior templates",
    ...templates,
    "",
    "## Response contract",
    "Return ONLY these tags, nothing else:",
    ...missing.flatMap((scene) => [
      `- one <scene_html id="${scene.id}">…interior…</scene_html>`,
      `- one <scene_script id="${scene.id}">…GSAP statements for a host-owned (tl) => { … }…</scene_script>`,
    ]),
    "Absolute times inside each scene window, beats on interior elements only —",
    "call tl.to/tl.from/tl.fromTo/tl.set with the absolute time as the final",
    "position argument; never global gsap.to/from/fromTo/set or delay-as-clock. ",
    "the host owns the stage and scene-window visibility. Do not author opacity",
    "sets on the scene wrapper, create/register a timeline, or call any compile.",
  ].join("\n");
}
export const CRITIC_MAX_DIRECTIVES = 5;

export const CRITIC_RESPONSE_FORMAT: NonNullable<CompleteOptions["responseFormat"]> = {
  type: "json_schema",
  json_schema: {
    name: "sequences_critique",
    strict: true,
    schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["ship", "repair"] },
        directives: {
          type: "array",
          maxItems: CRITIC_MAX_DIRECTIVES,
          items: { type: "string" },
        },
      },
      required: ["verdict", "directives"],
      additionalProperties: false,
    },
  },
};

export function parseCritique(raw: string): string[] {
  const source = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  if (start < 0) return [];
  let value: unknown;
  try {
    value = JSON.parse(source.slice(start, source.lastIndexOf("}") + 1));
  } catch {
    return [];
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const object = value as Record<string, unknown>;
  if (object.verdict !== "repair" || !Array.isArray(object.directives)) return [];
  return object.directives
    .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    .map((entry) => entry.trim().slice(0, 300))
    .slice(0, CRITIC_MAX_DIRECTIVES);
}
