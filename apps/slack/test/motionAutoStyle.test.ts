/**
 * Host auto-derivation of the MD3/MD4/MD6 creative styles (2026-07-07,
 * md-audit gap). MD3 (headline text FX), MD4 (animated gradeShift), and MD6
 * (playful pops) shipped correct + tested, but the production storyboard
 * planner (GLM z-ai/glm-5.2) reliably declares the STRUCTURE and under-reaches
 * for the OPTIONAL `style`/`gradeShift` fields — md-audit-probe-3b/4 published
 * ZERO styled beats and ZERO gradeShift even when the brief demanded them,
 * while the claude-code-cli probe-1 filled them richly. The fix makes the host
 * DERIVE those fields from data the storyboard already carries, at parse, each
 * feeding its existing discipline governor. These tests pin the three
 * derivations as units and compose them in the exact `parseStoryboard` order
 * over a probe-4-shaped plan.
 */
import { describe, expect, it } from "vitest";
import {
  COMPACT_POP_KINDS,
  MAX_POP_OPENS_PER_SCENE,
  autoStyleCompactPops,
  degradeExcessAssembles,
  degradeOpenPopStyles,
  type ComponentBeatIntentV1,
  type SceneComponentSpecV1,
} from "../src/engine/componentContract.ts";
import { autoStyleHeadlineReveals } from "../src/engine/compositionRunner.ts";
import {
  GRADE_SHIFT_MIN_AFTERMATH_SEC,
  MAX_GRADE_SHIFTS_PER_FILM,
  deriveGradeShifts,
  dropUnusableGradeShifts,
} from "../src/engine/gradeShift.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";

/* ------------------------------------------------------------- fixtures */

function scene(
  overrides: Partial<DirectScene> & Pick<DirectScene, "id" | "startSec" | "durationSec">,
): DirectScene {
  return { title: overrides.id, purpose: "test", ...overrides };
}

function comp(id: string, kind: SceneComponentSpecV1["kind"]): SceneComponentSpecV1 {
  return { version: 1, id, kind };
}

function beat(
  id: string,
  component: string,
  kind: ComponentBeatIntentV1["kind"],
  atSec: number,
  extra: Partial<ComponentBeatIntentV1> = {},
): ComponentBeatIntentV1 {
  return { version: 1, id, sceneId: "s", component, kind, atSec, ...extra };
}

function moment(
  id: string,
  atSec: number,
  importance: "primary" | "supporting",
  title: string,
  extra: { change?: string; visualState?: string } = {},
): NonNullable<DirectScene["moments"]>[number] {
  return {
    version: 1,
    id,
    sceneId: "s",
    atSec,
    title,
    visualState: extra.visualState ?? title,
    change: extra.change ?? title,
    motionIntent: "resolve",
    importance,
  };
}

/* ------------------------------------------------- MD6 auto compact pop */

describe("autoStyleCompactPops (MD6 host derivation)", () => {
  it("styles a style-less open on every compact acknowledgment kind", () => {
    const result = autoStyleCompactPops([
      scene({
        id: "s",
        startSec: 0,
        durationSec: 6,
        components: [comp("t", "toast"), comp("b", "button"), comp("m", "stat-card")],
        beats: [beat("b1", "t", "open", 1), beat("b2", "b", "open", 2), beat("b3", "m", "open", 3)],
      }),
    ]);
    expect(result.scenes[0]?.beats?.map((entry) => entry.style)).toEqual(["pop", "pop", "pop"]);
    expect(result.applied).toHaveLength(3);
  });

  it("never styles an open on a non-compact kind, and never a non-open beat", () => {
    const result = autoStyleCompactPops([
      scene({
        id: "s",
        startSec: 0,
        durationSec: 6,
        components: [comp("win", "app-window"), comp("card", "stat-card")],
        beats: [beat("open-win", "win", "open", 1), beat("count-card", "card", "count", 2, { value: 40 })],
      }),
    ]);
    expect(result.scenes[0]?.beats?.map((entry) => entry.style)).toEqual([undefined, undefined]);
    expect(result.applied).toEqual([]);
  });

  it("never overrides an explicit style", () => {
    const result = autoStyleCompactPops([
      scene({
        id: "s",
        startSec: 0,
        durationSec: 4,
        components: [comp("t", "toast")],
        beats: [beat("b1", "t", "open", 1, { style: "pop" })],
      }),
    ]);
    // Idempotent: the derivation left the already-explicit style untouched.
    expect(result.applied).toEqual([]);
    expect(result.scenes[0]?.beats?.[0]?.style).toBe("pop");
  });

  it("hands its output to the cap governor: three compact pops become two", () => {
    const derived = autoStyleCompactPops([
      scene({
        id: "s",
        startSec: 0,
        durationSec: 6,
        components: [comp("a", "toast"), comp("b", "button"), comp("c", "stat-card")],
        beats: [beat("p1", "a", "open", 1), beat("p2", "b", "open", 2), beat("p3", "c", "open", 3)],
      }),
    ]);
    const capped = degradeOpenPopStyles(derived.scenes);
    expect(capped.scenes[0]?.beats?.map((entry) => entry.style)).toEqual(["pop", "pop", undefined]);
    expect(MAX_POP_OPENS_PER_SCENE).toBe(2);
  });

  it("keeps toast/button/stat-card among the compact kinds it targets", () => {
    for (const kind of ["toast", "button", "stat-card", "toggle", "avatar-stack"] as const) {
      expect(COMPACT_POP_KINDS.has(kind)).toBe(true);
    }
    expect(COMPACT_POP_KINDS.has("app-window")).toBe(false);
    expect(COMPACT_POP_KINDS.has("modal")).toBe(false);
  });
});

/* ------------------------------------------- MD3 auto headline reveal */

describe("autoStyleHeadlineReveals (MD3 host derivation)", () => {
  const headlineScene = (over: Partial<DirectScene> = {}): DirectScene =>
    scene({
      id: "resolve",
      startSec: 16.5,
      durationSec: 3,
      components: [comp("wordmark", "headline")],
      beats: [beat("name", "wordmark", "type", 16.6, { text: "STEADY" })],
      moments: [moment("m", 16.6, "primary", "Alert fragments converge into the wordmark")],
      ...over,
    });

  it("defaults a style-less headline type beat to a refined reveal", () => {
    // A single headline with no coinciding primary at a provable hold still
    // gets `rise`; only the assemble PROMOTION needs the primary + hold.
    const result = autoStyleHeadlineReveals([
      headlineScene({ moments: [moment("m", 16.6, "supporting", "wordmark types in")] }),
    ]);
    expect(result.storyboard[0]?.beats?.[0]?.style).toBe("rise");
  });

  it("promotes the strongest primary-coinciding headline to assemble with a provable hold", () => {
    const result = autoStyleHeadlineReveals([headlineScene()]);
    expect(result.storyboard[0]?.beats?.[0]?.style).toBe("assemble");
    // The assemble survives its cap governor (headline-kind, on-primary, first).
    const capped = degradeExcessAssembles(result.storyboard);
    expect(capped.scenes[0]?.beats?.[0]?.style).toBe("assemble");
    expect(capped.dropped).toEqual([]);
  });

  it("promotes only ONE — the latest lock — and leaves the rest rise", () => {
    const result = autoStyleHeadlineReveals([
      scene({
        id: "s1",
        startSec: 0,
        durationSec: 4,
        components: [comp("h1", "headline")],
        beats: [beat("t1", "h1", "type", 0.4, { text: "PROBLEM" })],
        moments: [moment("a", 0.5, "primary", "problem headline lands")],
      }),
      headlineScene(),
    ]);
    const styles = result.storyboard.flatMap((entry) => entry.beats?.map((b) => b.style) ?? []);
    expect(styles).toEqual(["rise", "assemble"]);
  });

  it("stays rise (never trips pacing/assemble) when the lock-hold is too tight", () => {
    // A camera full move starts right after the lock → nextFramingChange is
    // immediate → the assemble hold is < 1.2s, so the host must NOT promote.
    const tight = headlineScene({
      durationSec: 3,
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", startSec: 16.5, durationSec: 0.4 },
          { version: 1, move: "push-in", toRegion: "hero", startSec: 17.1, durationSec: 1.2, zoom: 1.3 },
        ],
      },
    });
    const result = autoStyleHeadlineReveals([tight]);
    expect(result.storyboard[0]?.beats?.[0]?.style).toBe("rise");
  });

  it("never overrides an explicit style, and never touches non-headline type beats", () => {
    const result = autoStyleHeadlineReveals([
      scene({
        id: "s",
        startSec: 0,
        durationSec: 5,
        components: [comp("term", "terminal"), comp("h", "headline")],
        beats: [
          beat("cmd", "term", "type", 1, { text: "npm run build" }),
          beat("name", "h", "type", 3, { text: "SHIPFAST", style: "typewriter" }),
        ],
        moments: [moment("m", 3, "primary", "wordmark")],
      }),
    ]);
    const styles = result.storyboard[0]?.beats?.map((entry) => entry.style);
    expect(styles).toEqual([undefined, "typewriter"]);
    expect(result.applied).toEqual([]);
  });
});

/* --------------------------------------------- MD4 auto grade shift */

describe("deriveGradeShifts (MD4 host derivation)", () => {
  const turnScene = (title: string, importance: "primary" | "supporting" = "primary"): DirectScene =>
    scene({
      id: "the-turn",
      startSec: 7,
      durationSec: 5,
      moments: [moment("turn", 8.3, importance, title)],
    });

  it("mechanizes the planner's own words: a primary 'world turns warm' → warm shift", () => {
    const result = deriveGradeShifts([turnScene("One-click resolve — world turns warm")]);
    expect(result.storyboard[0]?.gradeShift).toMatchObject({ version: 1, atSec: 8.3, toGrade: "warm" });
    expect(result.derived).toHaveLength(1);
    // The derived shift survives the discipline governor (aftermath, coincidence).
    const disciplined = dropUnusableGradeShifts(result.storyboard);
    expect(disciplined.storyboard[0]?.gradeShift?.toGrade).toBe("warm");
    expect(disciplined.dropped).toEqual([]);
  });

  it("reads cold and noir tokens too", () => {
    expect(
      deriveGradeShifts([turnScene("The system freezes — everything goes cold")])
        .storyboard[0]?.gradeShift?.toGrade,
    ).toBe("cold");
    expect(
      deriveGradeShifts([turnScene("The screen falls to noir as the incident hits")])
        .storyboard[0]?.gradeShift?.toGrade,
    ).toBe("noir");
  });

  it("only fires on primary moments, never supporting", () => {
    const result = deriveGradeShifts([turnScene("world turns warm", "supporting")]);
    expect(result.storyboard[0]?.gradeShift).toBeUndefined();
    expect(result.derived).toEqual([]);
  });

  it("never overrides a planner-declared gradeShift", () => {
    const declared = turnScene("world turns warm");
    declared.gradeShift = { version: 1, atSec: 9, toGrade: "cold" };
    const result = deriveGradeShifts([declared]);
    expect(result.storyboard[0]?.gradeShift).toMatchObject({ toGrade: "cold" });
    expect(result.derived).toEqual([]);
  });

  it("does not derive from a temperature word with no aftermath, and skips to a viable later moment", () => {
    // A warm moment 0.5s before the scene ends has no room; a later scan finds none,
    // so nothing is derived (degrade-never-veto).
    const noRoom = scene({
      id: "flash",
      startSec: 7,
      durationSec: 5,
      moments: [moment("late", 12 - 0.5, "primary", "world turns warm")],
    });
    expect(deriveGradeShifts([noRoom]).storyboard[0]?.gradeShift).toBeUndefined();
    expect(GRADE_SHIFT_MIN_AFTERMATH_SEC).toBe(1.2);

    const twoMoments = scene({
      id: "the-turn",
      startSec: 7,
      durationSec: 5,
      moments: [
        moment("early", 11.8, "primary", "a warm glimmer flickers"),
        moment("mid", 8.3, "primary", "the world warms fully"),
      ],
    });
    // The 11.8s moment has < 1.2s aftermath and is skipped; the 8.3s one anchors it.
    expect(deriveGradeShifts([twoMoments]).storyboard[0]?.gradeShift?.atSec).toBe(8.3);
  });

  it("does not derive from a non-temperature moment", () => {
    expect(
      deriveGradeShifts([turnScene("the resolve button is pressed")]).storyboard[0]?.gradeShift,
    ).toBeUndefined();
  });

  it("ignores bare 'cool' — everyday SaaS copy, not a temperature turn", () => {
    expect(
      deriveGradeShifts([turnScene("cool insights keep your team calm")]).storyboard[0]?.gradeShift,
    ).toBeUndefined();
    // The inflected turn verb still counts.
    expect(
      deriveGradeShifts([turnScene("the dashboard cools as alerts clear")])
        .storyboard[0]?.gradeShift?.toGrade,
    ).toBe("cold");
  });

  it("auto-derives at most ONE shift per film — the earliest turn — leaving the 2nd budget slot for the planner", () => {
    const scenes = ["a", "b", "c"].map((id, index) =>
      scene({
        id,
        startSec: index * 5,
        durationSec: 5,
        moments: [moment(`${id}-turn`, index * 5 + 1, "primary", "world turns warm")],
      }),
    );
    const derived = deriveGradeShifts(scenes);
    expect(derived.derived).toHaveLength(1);
    expect(derived.storyboard[0]?.gradeShift?.atSec).toBe(1); // the earliest scene
    expect(derived.storyboard.slice(1).every((entry) => !entry.gradeShift)).toBe(true);
    // A planner-declared shift still gets its slot; auto adds only its one on top.
    const withDeclared = [
      // atSec coincides with scene a's moment (at 1s) so the governor keeps it.
      { ...scenes[0]!, gradeShift: { version: 1 as const, atSec: 1, toGrade: "cold" as const } },
      ...scenes.slice(1),
    ];
    const mixed = deriveGradeShifts(withDeclared);
    const kept = dropUnusableGradeShifts(mixed.storyboard).storyboard.filter((s) => s.gradeShift).length;
    expect(kept).toBeLessThanOrEqual(MAX_GRADE_SHIFTS_PER_FILM);
    expect(kept).toBe(2); // the declared cold + one auto warm
  });
});

/* ---------------------------------------- integration: the parse pipeline */

describe("the parse-order composition (probe-4 shape, styles now appear)", () => {
  it("turns a style-less GLM plan into pop + rise/assemble + gradeShift", () => {
    // A minimized md-audit-probe-4 plan: the STRUCTURE GLM reliably declares,
    // with every optional style/gradeShift left blank (the shipped-invisible gap).
    const raw: DirectScene[] = [
      scene({
        id: "the-turn",
        startSec: 7,
        durationSec: 5,
        components: [comp("resolve-btn", "button"), comp("all-clear-toast", "toast")],
        beats: [
          beat("set", "resolve-btn", "press", 8.3, { toState: "resolved" }),
          beat("toast-open", "all-clear-toast", "open", 8.8),
        ],
        moments: [
          moment("turn", 8.3, "primary", "One-click resolve — world turns warm", {
            change: "the frame warms",
          }),
          moment("pop", 8.8, "primary", "All-clear toast pops with playful energy"),
        ],
      }),
      scene({
        id: "steady-resolve",
        startSec: 16.5,
        durationSec: 3,
        components: [comp("steady-wordmark", "headline"), comp("cta-btn", "button")],
        beats: [
          beat("name", "steady-wordmark", "type", 16.6, { text: "STEADY" }),
          beat("cta-open", "cta-btn", "open", 17.7),
        ],
        moments: [
          moment("wordmark", 16.6, "primary", "Alert fragments converge into Steady wordmark"),
          moment("cta", 17.7, "primary", "CTA button lands in warm negative space"),
        ],
      }),
    ];

    // Exactly the order parseStoryboard runs the derivations + governors.
    const a = autoStyleCompactPops(raw);
    const b = degradeOpenPopStyles(a.scenes);
    const c = autoStyleHeadlineReveals(b.scenes);
    const d = degradeExcessAssembles(c.storyboard);
    const e = deriveGradeShifts(d.scenes);
    const f = dropUnusableGradeShifts(e.storyboard);
    const out = f.storyboard;

    const styleOf = (sceneId: string, beatId: string): string | undefined =>
      out.find((s) => s.id === sceneId)?.beats?.find((entry) => entry.id === beatId)?.style;

    // MD6: both compact opens popped.
    expect(styleOf("the-turn", "toast-open")).toBe("pop");
    expect(styleOf("steady-resolve", "cta-open")).toBe("pop");
    // MD3: the wordmark rises and assembles (the film's one loud gesture).
    expect(styleOf("steady-resolve", "name")).toBe("assemble");
    const assembles = out.flatMap((s) => s.beats ?? []).filter((entry) => entry.style === "assemble");
    expect(assembles).toHaveLength(1);
    // MD4: the temperature turn the planner narrated is now an animated shift.
    const shift = out.find((s) => s.id === "the-turn")?.gradeShift;
    expect(shift).toMatchObject({ toGrade: "warm", atSec: 8.3 });
  });
});
