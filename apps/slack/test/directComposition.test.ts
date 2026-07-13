import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProviderOutputTruncatedError,
  type AgentProvider,
} from "@sequences/platform/providers";
import {
  applyCompositionRepair,
  applyDeterministicSourceRepairs,
  addressedPartsForLayoutRepair,
  autoStyleSemanticHighlights,
  completeStoryboardWorldLayouts,
  inferStoryboardPlanRequirements,
  injectLayoutIntentHints,
  injectWorldLayoutStyles,
  normalizeWorldLayout,
  parseCompositionResponse,
  parseStoryboardResponse,
  quarantineFailedInteractions,
  reconcileInteractionTargets,
  requestDirectComposition,
  requestStoryboardPlan,
  retimeUnmotivatedTimeRamps,
  criticSkippableCleanDraft,
  earlyLeastBadPublishReason,
  stagnantPolishShipReason,
  stagnantPolishSignature,
  browserQualityPenalty,
  correctLoadBearingContainment,
  repairContrastAaIssues,
  correctLayoutOverflow,
  correctSparseFraming,
  evaluateLoadBearingContainmentAdoption,
  sourceRetryFeedbackForBrowserQa,
  storyboardFindingDecision,
  unresolvedHardBrowserFindings,
  repairStationPositioning,
  injectBrandBase,
  brandBaseStyleBlock,
  StoryboardValidationError,
  auditDisplayTypeBudget,
  injectDisplayTypeMoments,
} from "../src/engine/compositionRunner.ts";
import {
  reconcileChatBeatTargets,
  repairCompositionWashoutIssues,
  retireOversizedDiagonalHairlines,
} from "../src/engine/runner/repairs.ts";
import { resolveTimeRampPlan, timeRampHoldWindow } from "../src/engine/timeRamp.ts";
import {
  commitDirectComposition,
  hasDirectComposition,
  isCssVarFontFamilyArtifact,
  isFloatingPointClipOverlap,
  isFloatingPointGsapTweenOverlap,
  loadDirectComposition,
  momentSubjectPart,
  storyboardMarkdown,
  undoDirectComposition,
  validateDirectComposition,
  type DirectCompositionDraft,
} from "../src/engine/directComposition.ts";
import { resolveMomentContract, type StoryboardMomentV1 } from "../src/engine/storyboardMoments.ts";
import { normalizeStoryboardPluginDeclarations } from "../src/engine/pluginContract.ts";
import {
  dropUnusableGradeShifts,
  normalizeStoryboardGradeShift,
} from "../src/engine/gradeShift.ts";
import {
  inspectDirectComposition,
  publishCanonicalVisionEvidence,
  visionCriticDraftHash,
  type DirectBrowserQaResult,
  type DirectLayoutIssue,
} from "../src/engine/layoutInspector.ts";
import { applyContinuityCritique } from "../src/engine/runner/ladder.ts";
import { runInSentinelContext } from "../src/engine/sentinelTelemetry.ts";
import { OPENROUTER_VISION_CRITIC_MODEL } from "../src/engine/modelPolicy.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { initializeProject } from "../src/engine/projectTemplates.ts";
import { buildJobFrame } from "../src/engine/frameDesign.ts";
import { injectCinemaKit } from "../src/engine/cinemaKit.ts";
import { injectCameraRuntimeTag, resolveCameraPlan } from "../src/engine/cameraContract.ts";
import { injectComponentKit } from "../src/engine/componentContract.ts";
import { buildFallbackComposition } from "../src/engine/fallbackComposition.ts";
import {
  assembleSlotComposition,
  extractSceneSlots,
} from "../src/engine/sceneSlots.ts";

// The authoring-loop suites below prove the LEGACY whole-doc path, which stays
// supported behind `SLACK_SEQUENCES_SENTINEL_SKELETON=0` /
// `SLACK_SEQUENCES_SENTINEL_SLOTS=0` for one release after the 2026-07-06
// default flip (their mocked provider responses are whole-doc `<index_html>`
// artifacts). Default-ON slot/skeleton coverage lives in
// test/sceneSlots.test.ts, test/sceneSlots.browser.test.ts,
// test/promptBudget.test.ts, and the live probe set.
process.env.SLACK_SEQUENCES_SENTINEL_SKELETON = "0";
process.env.SLACK_SEQUENCES_SENTINEL_SLOTS = "0";
// This suite proves the legacy whole-document author ladder with byte-exact
// expected HTML. Continuity default-on injection has its own graph/runtime
// suites; keep these fixtures on the explicit one-release rollback path.
process.env.SLACK_SEQUENCES_CONTINUITY_GRAPH = "0";
process.env.SLACK_SEQUENCES_ENVIRONMENT = "0";

/** Every published draft carries the host-injected runtimes and kits. */
function withHostInjections(html: string): string {
  const withRootTiming = html.replace(
    /<[a-z][\w:-]*\b(?=[^>]*\bdata-composition-id\s*=)[^>]*>/i,
    (tag) => {
      if (/\bdata-start\s*=/.test(tag)) return tag;
      return tag.replace(/\s*\/?>$/, (suffix) =>
        suffix.includes("/") ? ` data-start="0" />` : ` data-start="0">`
      );
    },
  );
  const withCinemaProfile = withRootTiming.replace(
    /<[a-z][\w:-]*\b(?=[^>]*\bdata-composition-id\s*=)[^>]*>/i,
    (tag) => {
      const className = "cinema-profile-cinematic";
      const classes = /\bclass\s*=\s*(["'])([^"']*)\1/i.exec(tag);
      if (classes) {
        if (classes[2]!.split(/\s+/).includes(className)) return tag;
        return tag.slice(0, classes.index) +
          `class=${classes[1]}${classes[2]} ${className}${classes[1]}` +
          tag.slice(classes.index + classes[0].length);
      }
      return tag.replace(/>$/, ` class="${className}">`);
    },
  );
  return injectCinemaKit(injectComponentKit(injectCameraRuntimeTag(withCinemaProfile)));
}

vi.mock("../src/engine/layoutInspector.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/engine/layoutInspector.ts")>();
  return {
    ...actual,
    publishCanonicalVisionEvidence: vi.fn(),
    inspectDirectComposition: vi.fn(async () => ({
    ok: true,
    strictOk: true,
    samples: [0, 2, 4, 6, 8],
    continuousMotion: {
      version: 1,
      advisory: true,
      sampleHz: 5,
      frame: { width: 1920, height: 1080 },
      samples: [],
      reversals: [],
      jerkMarkers: [],
      quietWindows: [],
      settleWindows: [],
      scenes: [],
      summary: {
        sampleCount: 5,
        focalFoundSamples: 5,
        minimumVisibleFraction: 1,
        meanVisibleFraction: 1,
        minimumOccupancyFraction: 0.1,
        meanOccupancyFraction: 0.1,
        offframeSamples: 0,
        tinyFocalSamples: 0,
        peakSpeed: 0.1,
        peakAcceleration: 0.2,
        peakJerk: 0.3,
        reversalCount: 0,
        jerkMarkerCount: 0,
        maxIndependentMotionCount: 1,
        meanIndependentMotionCount: 0.5,
        settleWindowCount: 1,
        measuredSettleWindowCount: 1,
        settledByWindowEndCount: 1,
        quietWindowCount: 0,
        maxQuietWindowSec: 0,
      },
      advisories: [],
    },
    issues: [],
    errors: [],
    warnings: [],
    })),
  };
});

const defaultInspectImplementation = vi.mocked(inspectDirectComposition).getMockImplementation()!;

describe("chat beat target repair", () => {
  const chatScene = (): DirectScene => ({
    id: "slack-brief-entry",
    title: "Brief entered",
    purpose: "Enter the release brief and stream the response",
    startSec: 3.5,
    durationSec: 5,
    components: [{ version: 1, id: "slack-chat", kind: "chat", role: "hero" }],
    beats: [
      {
        version: 1,
        id: "brief-swap",
        sceneId: "slack-brief-entry",
        component: "slack-chat",
        kind: "swap",
        atSec: 4.4,
        text: "Draft the v2.0 launch story",
      },
      {
        version: 1,
        id: "response-stream",
        sceneId: "slack-brief-entry",
        component: "slack-chat",
        kind: "stream",
        atSec: 5.8,
        text: "Retrieving permission-scoped context…",
      },
    ],
  });
  const customChat = `
<section data-scene="slack-brief-entry">
  <div data-part="slack-chat" data-component="chat">
    <div class="slack-msg self">Draft the v2.0 launch story</div>
    <div class="slack-input" data-part="chat-input">Draft the v2.0 launch story</div>
    <div class="slack-msg ai" data-part="ai-response">Retrieving permission-scoped context…</div>
  </div>
</section>`;

  it("binds exact authored chat input/response children once without hiding the root", () => {
    const first = reconcileChatBeatTargets(customChat, [chatScene()]);
    expect(first.repairs).toBe(2);
    expect(first.html).toContain('data-part="chat-input" data-cmp-text="1"');
    expect(first.html).toContain('data-part="ai-response" data-cmp-stream="1"');
    expect(first.html).not.toMatch(/data-part="slack-chat"[^>]*data-cmp-(?:text|stream)/);
    expect(reconcileChatBeatTargets(first.html, [chatScene()])).toEqual({
      html: first.html,
      repairs: 0,
    });
  });

  it("leaves canonical and ambiguous chat internals byte-identical", () => {
    const canonical = customChat
      .replace('data-part="chat-input"', 'class="cmp-text" data-part="chat-input"')
      .replace('data-part="ai-response"', 'class="cmp-msg cmp-ai" data-part="ai-response"');
    expect(reconcileChatBeatTargets(canonical, [chatScene()])).toEqual({
      html: canonical,
      repairs: 0,
    });

    const streamOnly = chatScene();
    streamOnly.beats = streamOnly.beats?.filter((beat) => beat.kind === "stream");
    const ambiguous = customChat.replace(
      '</div>\n</section>',
      '<div data-part="assistant-response">Retrieving permission-scoped context…</div></div>\n</section>',
    );
    expect(reconcileChatBeatTargets(ambiguous, [streamOnly])).toEqual({
      html: ambiguous,
      repairs: 0,
    });
  });
});

describe("oversized diagonal hairline repair", () => {
  const diagonal = [
    '<svg class="hairline" data-part="accent-hairline" data-layout-important="1"',
    ' style="position:absolute;left:0;top:0;width:1920px;height:1080px"',
    ' viewBox="0 0 1920 1080">',
    '  <path d="M 360 280 L 1560 800" />',
    '</svg>',
  ].join("\n");

  it("retires only the paint of a canvas-scale diagonal while preserving its contract target", () => {
    const first = retireOversizedDiagonalHairlines(diagonal);
    expect(first.repairs).toBe(1);
    expect(first.html).toContain('data-part="accent-hairline"');
    expect(first.html).toContain('data-layout-important="1"');
    expect(first.html).toContain('data-sequences-retired-diagonal-hairline="1"');
    expect(first.html).toContain('style="stroke-opacity:0!important"');
    expect(first.html).toContain('d="M 360 280 L 1560 800"');
    expect(retireOversizedDiagonalHairlines(first.html)).toEqual({
      html: first.html,
      repairs: 0,
    });
  });

  it("leaves bounded rules, component charts, and host geometry byte-identical", () => {
    const fixtures = [
      diagonal.replace('L 1560 800', 'L 860 300'),
      diagonal.replace('M 360 280 L 1560 800', 'M 360 540 L 1560 540'),
      diagonal.replace('<svg class="hairline"', '<svg class="hairline" data-component="chart"'),
      diagonal.replace('<svg class="hairline"', '<svg class="hairline" data-sequences-host="1"'),
    ];
    for (const fixture of fixtures) {
      expect(retireOversizedDiagonalHairlines(fixture)).toEqual({
        html: fixture,
        repairs: 0,
      });
    }
  });
});

describe("S6.11 bounded live-create attempt economy", () => {
  afterEach(() => {
    vi.mocked(inspectDirectComposition)
      .mockReset()
      .mockImplementation(defaultInspectImplementation);
  });
  it("banks the ProofLane J advisory shape after one source response and skips the critic", async () => {
    const dir = projectDir();
    const value = draft();
    const qa: DirectBrowserQaResult = {
      ok: true,
      strictOk: false,
      samples: [0.6, 12.8, 18.2],
      issues: [{
        code: "stale_asset_lingers",
        severity: "warning",
        time: 12.8,
        selector: "#approval-shell",
        sceneId: "proof",
        part: "approval-shell",
        message: "parent shell remains behind its child readiness stat",
        source: "sequences",
      }, {
        code: "camera_blocking_landing",
        severity: "warning",
        time: 18.2,
        selector: "#ready-headline",
        sceneId: "payoff",
        part: "ready-headline",
        message: "ensemble station occupancy is above its preferred range",
        source: "sequences",
      }, {
        code: "camera_blocking_unsettled",
        severity: "warning",
        time: 0.6,
        selector: "#hook-title",
        sceneId: "hook",
        part: "hook-title",
        message: "opener is still settling at the sampled landing",
        source: "sequences",
      }],
      loadBearingContainment: [{
        sceneId: "payoff",
        part: "ready-headline",
        detector: "camera-blocking",
        time: 18.2,
        found: true,
        opacity: 1,
        visibleFraction: 1,
        requiredVisibleFraction: 0.85,
      }],
      errors: [],
      warnings: [
        "stale_asset_lingers #approval-shell: parent shell remains behind child stat",
        "camera_blocking_landing #ready-headline: ensemble occupancy preference",
        "camera_blocking_unsettled #hook-title: opener still settling",
      ],
    };
    expect(unresolvedHardBrowserFindings(qa)).toEqual([]);
    expect(sourceRetryFeedbackForBrowserQa(qa)).toEqual([]);
    vi.mocked(inspectDirectComposition).mockReset().mockResolvedValue(qa);
    const complete = vi.fn().mockResolvedValue(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "ProofLane bounded author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    const result = await runInSentinelContext(dir, () => requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    }));

    expect(result.attempts).toBe(1);
    expect(result.earlyShipReason).toBe("runtime-valid-no-hard-bank");
    expect(result.browserQa?.warnings).toEqual(qa.warnings);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("permits at most one paid repair for a still-off-frame typed focal", async () => {
    const dir = projectDir();
    const value = draft();
    const hardQa: DirectBrowserQaResult = {
      ok: true,
      strictOk: false,
      samples: [2],
      issues: [{
        code: "spatial_focal_offframe",
        severity: "error",
        time: 2,
        selector: "#sell-btn-el",
        sceneId: "hook",
        part: "sell-btn",
        message: "typed primary remains partly outside the frame",
        source: "sequences",
      }],
      loadBearingContainment: [{
        sceneId: "hook",
        part: "sell-btn",
        detector: "primary-moment",
        time: 2,
        found: true,
        opacity: 1,
        visibleFraction: 0.4,
        requiredVisibleFraction: 0.85,
      }],
      errors: [],
      warnings: ["spatial_focal_offframe #sell-btn-el: typed primary is off frame"],
    };
    vi.mocked(inspectDirectComposition).mockReset().mockResolvedValue(hardQa);
    const complete = vi.fn()
      .mockResolvedValueOnce(response(value))
      .mockResolvedValueOnce(patchResponse("Ship with nerve.", "Ship with resolve."));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "bounded hard repair",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    await expect(runInSentinelContext(dir, () => requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    }))).rejects.toThrow(/failed after 2 source attempt/);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("keeps runtime exceptions and missing timelines fail-loud within two calls", async () => {
    const value = draft();
    const runtimeDir = projectDir();
    vi.mocked(inspectDirectComposition).mockReset().mockResolvedValue({
      ok: false,
      strictOk: false,
      samples: [],
      issues: [],
      errors: ["runtime_bind_exception: composition never registered its timeline"],
      warnings: [],
    });
    const runtimeComplete = vi.fn()
      .mockResolvedValueOnce(response(value))
      .mockResolvedValueOnce(response(value));
    const provider = (complete: typeof runtimeComplete): AgentProvider => ({
      id: "openrouter-api",
      label: "bounded hard runtime",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    });
    await expect(runInSentinelContext(runtimeDir, () => requestDirectComposition(provider(runtimeComplete), {
      brief: "Launch Relay",
      projectDir: runtimeDir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    }))).rejects.toThrow(/runtime_bind_exception/);
    expect(runtimeComplete).toHaveBeenCalledTimes(2);

    const timelineDir = projectDir();
    const noTimeline = draft();
    noTimeline.html = noTimeline.html.replace(
      'window.__timelines["relay-launch"] = tl;',
      "// missing registered timeline",
    );
    const timelineComplete = vi.fn()
      .mockResolvedValueOnce(response(noTimeline))
      .mockResolvedValueOnce(patchResponse("Ship with nerve.", "Ship with resolve."));
    await expect(runInSentinelContext(timelineDir, () => requestDirectComposition(provider(timelineComplete), {
      brief: "Launch Relay",
      projectDir: timelineDir,
      skills: skills(),
      lockedStoryboard: noTimeline.storyboard,
    }))).rejects.toThrow(/failed after 2 source attempt/);
    expect(timelineComplete).toHaveBeenCalledTimes(2);
  });

  it("accepts storyboard taste residue on the first response and caps hard replans at two", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_SHAPE_HINT", "0");
    vi.stubEnv("SLACK_SEQUENCES_SHARED_PLANNING_CACHE", "0");
    const advisoryDir = projectDir();
    const advisoryPlan = storyboard().map((scene) => ({
      ...scene,
      foreground: "the same deliberately coherent foreground",
      cameraIntent: "one restrained framing language",
    }));
    const advisoryComplete = vi.fn().mockResolvedValue(
      `<storyboard_json>${JSON.stringify(advisoryPlan)}</storyboard_json>`,
    );
    const provider = (complete: typeof advisoryComplete): AgentProvider => ({
      id: "openrouter-api",
      label: "bounded storyboard",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    });
    const accepted = await runInSentinelContext(advisoryDir, () => requestStoryboardPlan(
      provider(advisoryComplete),
      {
        brief: "Launch Relay",
        projectDir: advisoryDir,
        skills: skills(),
      },
    ));
    expect(accepted).toHaveLength(advisoryPlan.length);
    expect(advisoryComplete).toHaveBeenCalledTimes(1);

    const hardDir = projectDir();
    const invalid = `<storyboard_json>${JSON.stringify([storyboard()[0]])}</storyboard_json>`;
    const hardComplete = vi.fn().mockResolvedValue(invalid);
    await expect(runInSentinelContext(hardDir, () => requestStoryboardPlan(
      provider(hardComplete),
      {
        brief: "Launch Relay",
        projectDir: hardDir,
        skills: skills(),
      },
    ))).rejects.toThrow(/storyboard must contain 3-10 distinct shots/);
    expect(hardComplete).toHaveBeenCalledTimes(2);
  });
});

const roots: string[] = [];

beforeEach(() => {
  // The small-agent shape hint rides in parallel with the concept pass and
  // would shift these call-count-sensitive specs; it has its own test file.
  vi.stubEnv("SLACK_SEQUENCES_SHAPE_HINT", "0");
  // The source rescue rung adds a provider call on exhausted-author paths and
  // would shift call-count-sensitive specs; its own spec re-enables it.
  vi.stubEnv("SLACK_SEQUENCES_SOURCE_RESCUE_MODEL", "none");
  // The shared planning cache would bleed identical-brief plans across specs
  // (and test runs); its own spec re-enables it inside a private base dir.
  vi.stubEnv("SLACK_SEQUENCES_SHARED_PLANNING_CACHE", "0");
});

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("floating-point clip-overlap filter", () => {
  const finding = (message: string) => ({
    code: "overlapping_clips_same_track",
    severity: "error" as const,
    message,
  });

  it("drops the IEEE-754 phantom overlap that burned the 2026-07-03 live create", () => {
    expect(isFloatingPointClipOverlap(finding(
      "Track 1: clip ending at 11.600000000000001s overlaps with clip starting at 11.6s. " +
        "Overlapping clips on the same track cause rendering conflicts.",
    ))).toBe(true);
  });

  it("keeps genuine overlaps and unrelated findings", () => {
    expect(isFloatingPointClipOverlap(finding(
      "Track 1: clip ending at 12.4s overlaps with clip starting at 11.6s. " +
        "Overlapping clips on the same track cause rendering conflicts.",
    ))).toBe(false);
    expect(isFloatingPointClipOverlap({
      code: "timed_element_missing_clip_class",
      severity: "error" as const,
      message: "clip ending at 11.600000000000001s overlaps with clip starting at 11.6s",
    })).toBe(false);
  });

  it("drops only sub-reporting-precision GSAP endpoint overlap artifacts", () => {
    expect(isFloatingPointGsapTweenOverlap({
      code: "overlapping_gsap_tweens",
      severity: "warning" as const,
      message:
        'GSAP tweens overlap on "#metric" for scale between 13.70s and 13.70s.',
    })).toBe(true);
    expect(isFloatingPointGsapTweenOverlap({
      code: "overlapping_gsap_tweens",
      severity: "warning" as const,
      message:
        'GSAP tweens overlap on "#metric" for scale between 13.70s and 13.72s.',
    })).toBe(false);
    expect(isFloatingPointGsapTweenOverlap({
      code: "timeline_track_too_dense",
      severity: "warning" as const,
      message: "between 13.70s and 13.70s",
    })).toBe(false);
  });
});

describe("css-var font-family artifact filter", () => {
  const finding = (message: string) => ({
    code: "font_family_without_font_face",
    severity: "warning" as const,
    message,
  });

  it("drops the kit CSS var() indirection the pinned linter splits into phantom families", () => {
    expect(isCssVarFontFamilyArtifact(finding(
      "Font families used without @font-face declaration: var(--font-mono, monospace), " +
        "var(--font-display, inherit). These are not in the auto-resolved font list, " +
        "so the renderer cannot supply them automatically.",
    ))).toBe(true);
  });

  it("keeps findings that name at least one real missing family", () => {
    expect(isCssVarFontFamilyArtifact(finding(
      "Font families used without @font-face declaration: Comic Sans MS, " +
        "var(--font-display, inherit). These are not in the auto-resolved font list, " +
        "so the renderer cannot supply them automatically.",
    ))).toBe(false);
    expect(isCssVarFontFamilyArtifact(finding(
      "Font families used without @font-face declaration: Neue Machina. " +
        "These are not in the auto-resolved font list, so the renderer cannot " +
        "supply them automatically.",
    ))).toBe(false);
    expect(isCssVarFontFamilyArtifact({
      code: "overlapping_clips_same_track",
      severity: "warning" as const,
      message: "Font families used without @font-face declaration: var(--font-mono, monospace). These are not…",
    })).toBe(false);
  });
});

describe("world-layout station map normalization", () => {
  it("keeps valid stations and drops junk entry-by-entry", () => {
    expect(normalizeWorldLayout([
      { region: "hero-claim", cell: [0, 0] },
      { region: "metric-wall", cell: [1, 0] },
      { region: "Bad Region", cell: [0, 1] }, // not kebab-case
      { region: "too-far", cell: [3, 0] }, // out of range
      { region: "fractional", cell: [0.5, 0] }, // not an integer
      { region: "metric-wall", cell: [0, -1] }, // duplicate region
      { region: "same-cell", cell: [1, 0] }, // duplicate cell
      "junk",
    ], true)).toEqual([
      { region: "hero-claim", cell: [0, 0] },
      { region: "metric-wall", cell: [1, 0] },
    ]);
  });

  it("drops the map entirely without a camera path or when malformed", () => {
    expect(normalizeWorldLayout([{ region: "hero", cell: [0, 0] }], false)).toEqual([]);
    expect(normalizeWorldLayout({ region: "hero" }, true)).toEqual([]);
    expect(normalizeWorldLayout(undefined, true)).toEqual([]);
  });
});

describe("momentSubjectPart (WS7 thumbnail subject resolution)", () => {
  const moment = (evidence: StoryboardMomentV1["evidence"]): StoryboardMomentV1 => ({
    version: 1,
    id: "m",
    sceneId: "s",
    atSec: 1,
    title: "t",
    visualState: "",
    change: "",
    motionIntent: "",
    importance: "primary",
    ...(evidence ? { evidence } : {}),
  });

  it("resolves the bound data-part from component and interaction evidence", () => {
    expect(momentSubjectPart(moment({
      kind: "component", detail: "component:count→latency-stat", startSec: 1, endSec: 1.5,
    }))).toBe("latency-stat");
    expect(momentSubjectPart(moment({
      kind: "interaction", detail: "interaction:click→cta-button", startSec: 1, endSec: 1.3,
    }))).toBe("cta-button");
  });

  it("returns undefined for camera/cut/tween moments and selector-shaped targets", () => {
    // Camera/cut moments have no single data-part subject (pixel path handles them).
    expect(momentSubjectPart(moment({
      kind: "camera", detail: "camera:pan→metrics", startSec: 1, endSec: 1.8,
    }))).toBeUndefined();
    expect(momentSubjectPart(moment({
      kind: "cut", detail: "scene-start", startSec: 1, endSec: 1.08,
    }))).toBeUndefined();
    // A tween's target is a raw selector, not a clean data-part id.
    expect(momentSubjectPart(moment({
      kind: "tween", detail: "gsap.fromTo→#lk-title .line b", startSec: 1, endSec: 1.7,
    }))).toBeUndefined();
    // Unbound moment.
    expect(momentSubjectPart(moment(undefined))).toBeUndefined();
  });
});

describe("deterministic interaction target reconciliation", () => {
  const interaction = {
    version: 1 as const,
    id: "click-signal",
    sceneId: "one",
    cursorId: "pointer",
    targetPart: "active-signal-node",
    action: "click" as const,
    startSec: 1,
    arriveSec: 2,
    from: "frame:bottom-right" as const,
    path: "human" as const,
    aimX: 0.5,
    aimY: 0.5,
    feedback: "none" as const,
  };

  it("binds a missing semantic target to the one exact element id", () => {
    const source =
      '<section data-scene="one"><div data-part="signal-node"></div>' +
      '<div id="active-signal-node" data-part="signal-node"></div>' +
      '<div data-part="signal-node"></div></section>';
    const result = reconcileInteractionTargets(source, [interaction]);
    expect(result.repairs).toBe(1);
    expect(result.html).toContain(
      'id="active-signal-node" data-part="active-signal-node"',
    );
  });

  it("keeps genuinely ambiguous semantic candidates untouched", () => {
    const source =
      '<section data-scene="one"><div data-part="signal-node-left"></div>' +
      '<div data-part="signal-node-right"></div></section>';
    const result = reconcileInteractionTargets(source, [interaction]);
    expect(result).toEqual({ html: source, repairs: 0 });
  });

  it("never borrows a plausible target from a different scene", () => {
    const source =
      '<section data-scene="one"><div data-part="other"></div></section>' +
      '<section data-scene="two"><div id="active-signal-node" data-part="signal-node"></div></section>';
    const result = reconcileInteractionTargets(source, [interaction]);
    expect(result).toEqual({ html: source, repairs: 0 });
  });

  it("makes an exact id the unique target when the authored part was duplicated", () => {
    const source =
      '<section data-scene="one"><div data-part="active-signal-node"></div>' +
      '<div id="active-signal-node" data-part="active-signal-node"></div></section>';
    const result = reconcileInteractionTargets(source, [interaction]);
    expect(result.repairs).toBe(1);
    expect(result.html).toContain('data-part="active-signal-node-aux-1"');
    expect(result.html.match(/data-part="active-signal-node"/g)).toHaveLength(1);
  });
});

function projectDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-direct-test-"));
  roots.push(dir);
  initializeProject(dir, { name: "Relay", brandName: "Relay", seedScreenshot: true });
  return dir;
}

describe("deterministic direct fallback", () => {
  it("builds a statically valid flow-first composition from untrusted brief text", async () => {
    const dir = projectDir();
    const fallback = buildFallbackComposition({
      product: 'RADAR <script>alert("x")</script>',
      whatShipped: "One operational view & faster decisions",
      audience: "product teams",
      lengthSec: 20,
    });
    const validation = await validateDirectComposition(dir, fallback);
    expect(validation.errors).toEqual([]);
    expect(fallback.html).toContain("layout-editorial-left");
    expect(fallback.html).toContain("data-camera-world");
    expect(fallback.html).toContain("layout-center-stack");
    expect(fallback.html).not.toContain("<script>alert");
  });

  it("skins the safe film with the locked plan's own copy on a source-author failure", async () => {
    const dir = projectDir();
    const plan: DirectScene[] = [
      {
        id: "s1",
        title: "The incident hits at 02:14",
        purpose: "Open on the alert storm",
        startSec: 0,
        durationSec: 7,
        moments: [{
          version: 1,
          sceneId: "s1",
          id: "m1",
          atSec: 2,
          title: "PagerDuty lights up",
          visualState: "Alerts cascade across the board",
          change: "Every service goes red at once",
          motionIntent: "reveal",
          importance: "primary",
        }],
      },
      { id: "s2", title: "One-click rollback", purpose: "Land the payoff", startSec: 7, durationSec: 8 },
      {
        id: "s3",
        title: "Back to green <in seconds>",
        purpose: "Resolve to calm",
        startSec: 15,
        durationSec: 7,
      },
    ];
    const skinned = buildFallbackComposition({
      product: "PulseDeck",
      whatShipped: "one-click rollback from any deploy",
      audience: "SREs",
      lengthSec: 22,
      plan,
    });
    // Hook line = first scene's primary-moment title; proof caption = its
    // declared change; promise = the last scene's title. Generic filler is gone.
    expect(skinned.html).toContain("PagerDuty lights up");
    expect(skinned.html).toContain("Every service goes red at once");
    expect(skinned.html).not.toContain("Live in your workspace today");
    expect(skinned.html).not.toContain("From shipped to shown");
    // Untrusted plan copy is escaped just like the brief fields.
    expect(skinned.html).toContain("Back to green &lt;in seconds&gt;");
    expect(skinned.html).not.toContain("Back to green <in seconds>");
    // The proven 3-shot structure and its bespoke brief anchors are unchanged.
    const validation = await validateDirectComposition(dir, skinned);
    expect(validation.errors).toEqual([]);
    expect(skinned.html).toContain("layout-editorial-left");
    expect(skinned.html).toContain("data-camera-world");
    expect(skinned.html).toContain("layout-center-stack");
    expect(skinned.html).toContain(">PulseDeck<");
  });

  it("stays byte-identical to the generic reel when no usable plan is passed", () => {
    const base = {
      product: "PulseDeck",
      whatShipped: "one-click rollback from any deploy",
      audience: "SREs",
      lengthSec: 22,
    };
    const noPlan = buildFallbackComposition(base);
    const emptyPlan = buildFallbackComposition({ ...base, plan: [] });
    // The plan param is a pure no-op when empty: same bytes, generic filler intact.
    expect(emptyPlan.html).toBe(noPlan.html);
    expect(noPlan.html).toContain("Live in your workspace today");
    expect(noPlan.html).toContain("Shipped &middot; verified &middot; in the channel");
    expect(noPlan.html).toContain("From shipped to shown");
  });
});

function draft(accent = "#8b5cf6"): DirectCompositionDraft {
  return {
    storyboard: [
      {
        id: "hook",
        title: "The trace arrives",
        purpose: "Open on the release",
        startSec: 0,
        durationSec: 4,
        blueprint: "kinetic-type-beats",
        rules: ["kinetic-beat-slam"],
        outgoingCut: "The violet rail continues",
      },
      {
        id: "payoff",
        title: "One-click rollback",
        purpose: "Land the product payoff",
        startSec: 4,
        durationSec: 4,
        blueprint: "cta-morph-press",
        rules: ["physics-press-reaction"],
        outgoingCut: "Hold on the CTA",
      },
    ],
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <script src="gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #08090d; }
    #root { --space-safe: 72px; position: relative; width: 1920px; height: 1080px; overflow: hidden; color: #f8fafc; font-family: Inter, Arial, sans-serif; }
    .scene { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; }
    .panel { width: 1320px; padding: 96px; border: 1px solid ${accent}; border-radius: 40px; background: #10131d; }
    h1 { margin: 0; font-size: 124px; line-height: .95; }
    p { margin: 28px 0 0; font-size: 42px; color: ${accent}; }
  </style>
</head>
<body>
  <main id="root" data-composition-id="relay-launch" data-width="1920" data-height="1080" data-duration="8">
    <section id="hook" class="scene clip" data-scene="hook" data-start="0" data-duration="4" data-track-index="1">
      <div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="hook-title">Trace the impossible.</h1><p>Relay v2</p></div>
    </section>
    <section id="payoff" class="scene clip" data-scene="payoff" data-start="4" data-duration="4" data-track-index="1">
      <div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">Rollback in one click.</h1><p>Ship with nerve.</p></div>
    </section>
  </main>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.set("#hook", { opacity: 1 }, 0);
    tl.set("#hook", { opacity: 0 }, 3.99);
    tl.set("#payoff", { opacity: 1 }, 4);
    tl.set("#payoff", { opacity: 0 }, 8);
    tl.fromTo("#hook-title", { y: 90, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" }, 0.2);
    tl.fromTo("#payoff-title", { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: "back.out(1.6)" }, 4.2);
    window.__timelines["relay-launch"] = tl;
  </script>
</body>
</html>`,
  };
}

function response(value: DirectCompositionDraft): string {
  return `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>
<index_html>${value.html}</index_html>`;
}

function patchResponse(search: string, replace: string): string {
  return `<patches_json>${JSON.stringify([{ search, replace }])}</patches_json>`;
}

function skills() {
  return {
    skillNames: [],
    blueprintIds: [],
    ruleIds: [],
    capabilityIds: [],
    registryVersion: "test",
    text: "",
  };
}

function storyboard(): DirectCompositionDraft["storyboard"] {
  return [
    {
      id: "problem-signal",
      title: "Signal",
      purpose: "Expose the launch problem",
      incomingIdea: "A noisy trace arrives",
      foreground: "Diagonal trace rail and split headline",
      background: "Dark grid with violet atmosphere",
      cameraIntent: "Locked wide frame with a short lateral push",
      continuityAnchor: "The violet trace exits frame right",
      outgoingCut: "Match the trace into the product rail",
      startSec: 0,
      durationSec: 3,
      blueprint: "kinetic-type-beats",
      capabilityIds: ["grain-overlay"],
    },
    {
      id: "product-proof",
      title: "Proof",
      purpose: "Show the product resolving the trace",
      incomingIdea: "The trace becomes a product route",
      foreground: "Product window with highlighted rollback path",
      background: "Offset technical grid and metadata",
      cameraIntent: "Push through the product window toward the action",
      continuityAnchor: "The action button becomes the final lockup chip",
      outgoingCut: "Scale-match the action into the brand close",
      startSec: 3,
      durationSec: 3,
      blueprint: "cursor-ui-demo",
      capabilityIds: ["ui-3d-reveal"],
    },
    {
      id: "brand-close",
      title: "Close",
      purpose: "Resolve on the launch promise",
      incomingIdea: "The action becomes the brand promise",
      foreground: "Asymmetric logo lockup and CTA rail",
      background: "Quiet violet field with registration marks",
      cameraIntent: "Settle from a close crop into a held wide lockup",
      continuityAnchor: "The CTA rail holds for the end frame",
      outgoingCut: "End on a clean held frame",
      startSec: 6,
      durationSec: 3,
      blueprint: "logo-assemble-lockup",
      capabilityIds: ["logo-outro"],
    },
  ];
}

describe("host-owned scene-timing re-base (LESS_FALLBACKS lever 10)", () => {
  it("shifts nested beat/camera/interaction/moment times with their re-based scene", () => {
    const scenes = storyboard();
    // The model fumbled the addition: scene 2 starts 1.3s late in its own
    // frame (and scene 3 follows it), with every nested time authored against
    // that wrong frame. Re-basing must carry the choreography along instead of
    // re-timing it inside the scene.
    const raw = [
      scenes[0],
      {
        ...scenes[1],
        startSec: 4.3,
        components: [{ version: 1, id: "ops-window", kind: "app-window" }],
        beats: [{
          version: 1,
          id: "fill-ops",
          sceneId: "product-proof",
          component: "ops-window",
          kind: "rows",
          atSec: 5.3, // 1.0s into the authored frame
        }],
        camera: {
          version: 1,
          path: [
            // Starts after the interaction's settled result so the 2026-07-08
            // retimeCameraOverInteractions normalizer has nothing to fix here —
            // this test isolates the re-base arithmetic.
            { version: 1, move: "pan", toRegion: "stage", startSec: 6.0, durationSec: 0.8 },
          ],
        },
        interactions: [{
          version: 1,
          id: "press-cta",
          sceneId: "product-proof",
          targetPart: "ops-window",
          action: "click",
          startSec: 4.8,
          arriveSec: 5.4,
        }],
        moments: [{
          version: 1,
          id: "m-ops-rows",
          sceneId: "product-proof",
          atSec: 5.5,
          title: "Alerts fill the window",
          visualState: "rows visible",
          change: "the alert rows arrive",
          motionIntent: "ui-state",
          importance: "primary",
        }],
      },
      { ...scenes[2], startSec: 7.3 },
    ];
    const parsed = parseStoryboardResponse(
      `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`,
    );
    expect(parsed[1]!.startSec).toBe(3);
    expect(parsed[2]!.startSec).toBe(6);
    // Every nested time moved by the -1.3s delta: same offsets inside the scene.
    expect(parsed[1]!.beats![0]!.atSec).toBeCloseTo(4.0, 3);
    expect(parsed[1]!.camera!.path[0]!.startSec).toBeCloseTo(4.7, 3);
    expect(parsed[1]!.interactions![0]!.startSec).toBeCloseTo(3.5, 3);
    expect(parsed[1]!.interactions![0]!.arriveSec).toBeCloseTo(4.1, 3);
    // Look the declared moment up by id — the moment top-up may add
    // synthesized siblings around it.
    const moment = parsed[1]!.moments!.find((entry) => entry.id === "m-ops-rows")!;
    expect(moment.atSec).toBeCloseTo(4.2, 3);
  });

  it("leaves nested times byte-identical when the authored arithmetic is right", () => {
    const scenes = storyboard();
    const raw = [
      scenes[0],
      {
        ...scenes[1],
        components: [{ version: 1, id: "ops-window", kind: "app-window" }],
        beats: [{
          version: 1,
          id: "fill-ops",
          sceneId: "product-proof",
          component: "ops-window",
          kind: "rows",
          atSec: 4.0,
        }],
      },
      scenes[2],
    ];
    const parsed = parseStoryboardResponse(
      `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`,
    );
    expect(parsed[1]!.startSec).toBe(3);
    expect(parsed[1]!.beats![0]!.atSec).toBe(4.0);
  });
});

describe("unsupported component beats degrade at parse (fallback-elimination)", () => {
  function planWith(beats: object[], moments: object[] = []) {
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            components: [
              { version: 1, id: "alerts-table", kind: "table" },
              { version: 1, id: "latency-stat", kind: "stat-card" },
              { version: 1, id: "action-bar", kind: "button" },
            ],
            beats,
            moments,
          }
        : scene
    );
    return parseStoryboardResponse(`<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`);
  }

  it("converts a text arrival on the wrong kind to a universal swap", () => {
    const parsed = planWith([{
      version: 1,
      id: "bad-type",
      sceneId: "product-proof",
      component: "alerts-table",
      kind: "type",
      atSec: 3.5,
      text: "rollback checkout",
    }]);
    const beat = parsed[1]!.beats!.find((entry) => entry.id === "bad-type")!;
    expect(beat.kind).toBe("swap");
    expect(beat.text).toBe("rollback checkout");
  });

  it("converts rows on a stat-card to count when a value exists, else highlight", () => {
    const withValue = planWith([{
      version: 1,
      id: "bad-rows",
      sceneId: "product-proof",
      component: "latency-stat",
      kind: "rows",
      atSec: 3.5,
      value: 98,
    }]);
    expect(withValue[1]!.beats!.find((entry) => entry.id === "bad-rows")!.kind).toBe("count");
    const withoutValue = planWith([{
      version: 1,
      id: "bad-rows-2",
      sceneId: "product-proof",
      component: "latency-stat",
      kind: "rows",
      atSec: 3.5,
    }]);
    expect(withoutValue[1]!.beats!.find((entry) => entry.id === "bad-rows-2")!.kind)
      .toBe("highlight");
  });

  it("degrades even a LOAD-BEARING text arrival to swap (same text, same time — evidence survives)", () => {
    // Phase-5 hardening: the 2026-07-06 probes repeatedly died on a
    // load-bearing `type` on a non-text kind. A swap carries the SAME text on
    // the SAME component at the SAME second, so the anchored moment keeps its
    // evidence beat and its claim — this degrade is safe even load-bearing.
    const parsed = planWith(
      [{
        version: 1,
        id: "bad-type",
        sceneId: "product-proof",
        component: "alerts-table",
        kind: "type",
        atSec: 3.5,
        text: "rollback checkout",
      }],
      [{
        version: 1,
        id: "m-typed-query",
        sceneId: "product-proof",
        atSec: 3.8,
        title: "Query lands",
        visualState: "typed query visible",
        change: "the query arrives",
        motionIntent: "type-on",
        importance: "primary",
      }],
    );
    const beat = parsed[1]!.beats!.find((entry) => entry.id === "bad-type")!;
    expect(beat.kind).toBe("swap");
    expect(beat.text).toBe("rollback checkout");
    expect(parsed[1]!.moments!.some((entry) => entry.id === "m-typed-query")).toBe(true);
  });

  it("converts load-bearing rows on a button to the same control's active state", () => {
    const parsed = planWith(
      [{
        version: 1,
        id: "dashboard-populates",
        sceneId: "product-proof",
        component: "action-bar",
        kind: "rows",
        atSec: 4.2,
      }],
      [{
        version: 1,
        id: "m-dashboard-populates",
        sceneId: "product-proof",
        atSec: 4.3,
        title: "Action bar activates on dashboard",
        visualState: "The dashboard action surface becomes active",
        change: "The consolidated dashboard comes alive",
        motionIntent: "ui-state",
        importance: "primary",
      }],
    );
    const beat = parsed[1]!.beats!.find((entry) => entry.id === "dashboard-populates")!;
    expect(beat.kind).toBe("set-state");
    expect(beat.toState).toBe("active");
  });

  it("keeps a load-bearing NON-text unsupported beat blocking (a moment anchors on it)", () => {
    // A non-text/non-numeric analog (highlight) changes the visual channel, so
    // evidence a declared moment binds to is never silently rewritten — the
    // findings-retry stays the delivery mechanism there.
    expect(() =>
      planWith(
        [{
          version: 1,
          id: "bad-chart",
          sceneId: "product-proof",
          component: "latency-stat",
          kind: "chart",
          atSec: 3.5,
        }],
        [{
          version: 1,
          id: "m-charted",
          sceneId: "product-proof",
          atSec: 3.8,
          title: "Chart grows",
          visualState: "bars visible",
          change: "the chart draws",
          motionIntent: "ui-state",
          importance: "primary",
        }],
      )
    ).toThrow(/uses "chart" on a stat-card component/);
  });

  it("accepts a plan clean except for pacing on late attempts (degrade-never-veto)", () => {
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            components: [{ version: 1, id: "ops-window", kind: "app-window" }],
            // One dense window introduced at 90% of the scene: a pure
            // pacing/holds violation on an otherwise valid plan.
            beats: [{
              version: 1,
              id: "late-rows",
              sceneId: "product-proof",
              component: "ops-window",
              kind: "rows",
              atSec: 5.7,
            }],
          }
        : scene
    );
    const response = `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`;
    expect(() => parseStoryboardResponse(response)).toThrow(/pacing\/holds/);
    const accepted = parseStoryboardResponse(response, {}, { degradePacingFindings: true });
    expect(accepted).toHaveLength(3);
    // Non-pacing findings keep their teeth under the same option.
    const broken = raw.map((scene, index) => (index === 2 ? { ...scene, id: raw[0]!.id } : scene));
    expect(() =>
      parseStoryboardResponse(
        `<storyboard_json>${JSON.stringify(broken)}</storyboard_json>`,
        {},
        { degradePacingFindings: true },
      )
    ).toThrow(/duplicated/);
  });

  it("never touches supported beats", () => {
    const parsed = planWith([{
      version: 1,
      id: "good-rows",
      sceneId: "product-proof",
      component: "alerts-table",
      kind: "rows",
      atSec: 3.5,
    }]);
    expect(parsed[1]!.beats!.find((entry) => entry.id === "good-rows")!.kind).toBe("rows");
  });
});

describe("semantic highlight style reconciliation", () => {
  it("turns an explicitly named measured underline into the underline runtime style", () => {
    const scene = storyboard()[1]!;
    const result = autoStyleSemanticHighlights([{
      ...scene,
      components: [{ version: 1, id: "exception-table", kind: "table" }],
      beats: [{
        version: 1,
        id: "px-482-underline",
        sceneId: scene.id,
        component: "exception-table",
        kind: "highlight",
        item: 3,
        atSec: scene.startSec + 1,
      }],
      moments: [{
        version: 1,
        id: "underline-sweeps-px-482",
        sceneId: scene.id,
        atSec: scene.startSec + 1,
        title: "Measured underline sweeps across PX-482",
        visualState: "The exact row owns the underline",
        change: "Focus converges on row three",
        motionIntent: "draw-on",
        importance: "supporting",
      }],
    }]);
    expect(result.storyboard[0]!.beats![0]).toMatchObject({
      component: "exception-table",
      item: 3,
      style: "underline",
    });
    expect(result.applied).toHaveLength(1);
  });

  it("does not invent a style for an ambiguous highlight or override an explicit ring", () => {
    const scene = storyboard()[1]!;
    const result = autoStyleSemanticHighlights([{
      ...scene,
      components: [{ version: 1, id: "metric", kind: "stat-card" }],
      beats: [
        {
          version: 1,
          id: "metric-focus",
          sceneId: scene.id,
          component: "metric",
          kind: "highlight",
          atSec: scene.startSec + 1,
        },
        {
          version: 1,
          id: "explicit-underline-word-but-ring",
          sceneId: scene.id,
          component: "metric",
          kind: "highlight",
          style: "ring",
          atSec: scene.startSec + 2,
        },
      ],
    }]);
    expect(result.storyboard[0]!.beats).toEqual([
      expect.not.objectContaining({ style: expect.anything() }),
      expect.objectContaining({ style: "ring" }),
    ]);
    expect(result.applied).toEqual([]);
  });
});

describe("Sentinel Phase 3 — camera phrase gating is wired into parseStoryboardResponse", () => {
  it("rejects competing camera ideas without deleting authored routes", () => {
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            camera: {
              version: 1,
              path: [
                { version: 1, move: "pan", toRegion: "left", startSec: 3.2, durationSec: 0.5 },
                { version: 1, move: "track-to-anchor", toPart: "chip", startSec: 4.0, durationSec: 0.5 },
                { version: 1, move: "pull-back", toRegion: "wide", startSec: 4.8, durationSec: 0.5 },
              ],
            },
          }
        : scene
    );
    const response = `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`;
    let failure: StoryboardValidationError | undefined;
    try {
      parseStoryboardResponse(response);
    } catch (error) {
      if (error instanceof StoryboardValidationError) failure = error;
      else throw error;
    }
    expect(failure?.findings).toEqual([
      expect.stringContaining("camera/idea-budget"),
    ]);
    expect(failure?.findings[0]).toContain('Keep "left"');
    expect(failure?.findings[0]).toContain('cut the lens routes to "chip", "wide"');
    expect(failure?.storyboard[1]?.camera?.path).toHaveLength(3);
    expect(
      failure?.storyboard[1]?.sentinelNormalizations?.some((note) => note.includes("camera")),
    ).not.toBe(true);
  });

  it("renders one host-generated line per declared plugin in STORYBOARD.md", () => {
    const pluginScene = {
      id: "s1",
      title: "Metrics land",
      purpose: "Prove the deploy story at a glance",
      startSec: 0,
      durationSec: 6,
      plugins: normalizeStoryboardPluginDeclarations([
        {
          version: 1,
          kind: "dashboard-grid",
          id: "metrics",
          region: "metric-wall",
          params: { tiles: 4, topic: "deploy speed" },
        },
        { version: 1, kind: "lockup", id: "closing", params: { headline: "Ship it faster" } },
      ]),
    };
    const md = storyboardMarkdown("t", [pluginScene]);
    expect(md).toContain(
      '- plugin: dashboard-grid "metrics" (tiles=4, topic=deploy speed, station=metric-wall) — host-generated',
    );
    expect(md).toContain('- plugin: lockup "closing" (headline=Ship it faster) — host-generated');
  });

  it("does not trade authored ideas for a numeric minimum-move requirement", () => {
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            camera: {
              version: 1,
              path: [
                { version: 1, move: "pan", toRegion: "left", startSec: 3.2, durationSec: 0.5 },
                { version: 1, move: "track-to-anchor", toPart: "chip", startSec: 4.0, durationSec: 0.5 },
                { version: 1, move: "pull-back", toRegion: "wide", startSec: 4.8, durationSec: 0.5 },
              ],
            },
          }
        : scene
    );
    const response = `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`;
    let message = "";
    try {
      parseStoryboardResponse(response, { minCameraMoves: 3 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("camera/idea-budget");
    expect(message).not.toContain("typed camera moves");
  });

  it("keeps an explicit rack-focus top-up when supporting motion collapses locally", () => {
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            spatialIntent: {
              version: 1 as const,
              focalPart: "chip",
              composition: "product route",
              relationships: ["chip leads the route"],
            },
            camera: {
              version: 1 as const,
              path: [
                { version: 1 as const, move: "pan" as const, toRegion: "left", startSec: 3.2, durationSec: 0.5 },
                {
                  version: 1 as const,
                  move: "track-to-anchor" as const,
                  toPart: "chip",
                  startSec: 4.0,
                  durationSec: 0.5,
                },
                { version: 1 as const, move: "pull-back" as const, toRegion: "wide", startSec: 4.8, durationSec: 0.5 },
              ],
            },
          }
        : scene
    );
    const response = `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`;
    const parsed = parseStoryboardResponse(response, {
      minCameraMoves: 3,
      requireRackFocus: true,
    });
    const focused = parsed[1]?.camera?.path.find((move) => move.toPart === "chip");
    expect(focused?.focus).toEqual({ part: "chip", blurMaxPx: 6 });
  });

  it("keeps the continuity camera chassis when unrelated arithmetic is reverted", () => {
    const previous = process.env.SLACK_SEQUENCES_CONTINUITY_GRAPH;
    process.env.SLACK_SEQUENCES_CONTINUITY_GRAPH = "1";
    try {
      const scenes = storyboard();
      const raw = scenes.map((scene, index) => {
        if (index === 0) {
          return {
            ...scene,
            components: [{ version: 1 as const, id: "signal-headline", kind: "headline" as const, role: "hero" as const }],
            spatialIntent: {
              version: 1 as const,
              focalPart: "signal-headline",
              composition: "headline-led opening",
              relationships: [],
            },
          };
        }
        if (index === 1) {
          return {
            ...scene,
            camera: {
              version: 1 as const,
              path: [
                { version: 1 as const, move: "pan" as const, toRegion: "left", startSec: 3.2, durationSec: 0.5 },
                { version: 1 as const, move: "track-to-anchor" as const, toPart: "chip", startSec: 4.0, durationSec: 0.5 },
                { version: 1 as const, move: "pull-back" as const, toRegion: "wide", startSec: 4.8, durationSec: 0.5 },
              ],
            },
          };
        }
        return scene;
      });
      const response = `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`;
      let failure: StoryboardValidationError | undefined;
      try {
        parseStoryboardResponse(response, { minCameraMoves: 3 });
      } catch (error) {
        if (error instanceof StoryboardValidationError) failure = error;
        else throw error;
      }

      expect(failure?.findings.some((finding) => finding.includes("camera/idea-budget"))).toBe(true);
      expect(failure?.storyboard[0]?.camera?.path).toEqual([{
        version: 1,
        move: "hold",
        startSec: 0,
        durationSec: 3,
        toPart: "signal-headline",
        zoom: 1,
      }]);
    } finally {
      if (previous === undefined) delete process.env.SLACK_SEQUENCES_CONTINUITY_GRAPH;
      else process.env.SLACK_SEQUENCES_CONTINUITY_GRAPH = previous;
    }
  });

  it("stretches a marginal scene-boundary reading miss and cascade-shifts later scenes", () => {
    // The 3s middle scene types a headline that lands too late to read before
    // its own cut — a marginal miss the host closes by extending the cut,
    // instead of a findings-retry. The later scene shifts by the same delta.
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            components: [{ version: 1, id: "headline", kind: "search" }],
            beats: [{
              version: 1,
              id: "type-headline",
              sceneId: "product-proof",
              component: "headline",
              kind: "type",
              atSec: 5.0,
              text: "deploy",
            }],
          }
        : scene
    );
    const response = `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`;
    const parsed = parseStoryboardResponse(response);
    const middle = parsed[1]!;
    const closer = parsed[2]!;
    // The middle scene grew past its declared 3s, and the closer moved to the
    // new boundary — the plan stays contiguous.
    expect(middle.durationSec).toBeGreaterThan(3);
    expect(closer.startSec).toBeCloseTo(middle.startSec + middle.durationSec, 3);
  });
});

describe("MD4 grade shift — normalization, discipline governor, moment evidence", () => {
  const primaryMoment = (id: string, sceneId: string, atSec: number): StoryboardMomentV1 => ({
    version: 1, id, sceneId, atSec, title: id, visualState: "x", change: "y",
    motionIntent: "resolve", importance: "primary",
  });
  const gradeScene = (
    id: string,
    startSec: number,
    shift: { atSec: number; toGrade: "cold" | "neutral" | "warm" | "noir" } | undefined,
    momentAt: number | undefined,
  ): DirectCompositionDraft["storyboard"][number] => ({
    id, title: id, purpose: "test", startSec, durationSec: 4,
    ...(shift ? { gradeShift: { version: 1 as const, ...shift } } : {}),
    ...(momentAt !== undefined ? { moments: [primaryMoment(`${id}-m`, id, momentAt)] } : {}),
  });

  it("shape-normalizes toGrade/atSec and drops unknown grades", () => {
    expect(normalizeStoryboardGradeShift(
      { atSec: 1.4, toGrade: "WARM", fromPart: "hero" }, { startSec: 0, durationSec: 4 },
    )).toEqual({ version: 1, atSec: 1.4, toGrade: "warm", fromPart: "hero" });
    expect(normalizeStoryboardGradeShift(
      { atSec: 1, toGrade: "teal" }, { startSec: 0, durationSec: 4 },
    )).toBeUndefined();
    // A scene-relative atSec authored from zero lifts into composition time.
    expect(normalizeStoryboardGradeShift(
      { atSec: 1, toGrade: "cold" }, { startSec: 5, durationSec: 4 },
    )?.atSec).toBe(6);
  });

  it("keeps a disciplined shift and drops the undisciplined cases", () => {
    const good = dropUnusableGradeShifts([gradeScene("s1", 0, { atSec: 1.2, toGrade: "warm" }, 1.2)]);
    expect(good.storyboard[0]?.gradeShift?.toGrade).toBe("warm");
    expect(good.dropped).toEqual([]);

    // <1.2s of aftermath (atSec 3.2 in a 4s scene) → dropped.
    expect(dropUnusableGradeShifts([gradeScene("s1", 0, { atSec: 3.2, toGrade: "warm" }, 3.2)])
      .storyboard[0]?.gradeShift).toBeUndefined();
    // No declared moment within ±0.5s → dropped.
    expect(dropUnusableGradeShifts([gradeScene("s1", 0, { atSec: 1.2, toGrade: "warm" }, undefined)])
      .storyboard[0]?.gradeShift).toBeUndefined();
    // Outside the scene window → dropped.
    expect(dropUnusableGradeShifts([gradeScene("s1", 0, { atSec: 9, toGrade: "warm" }, 1.2)])
      .storyboard[0]?.gradeShift).toBeUndefined();
  });

  it("caps grade shifts at two per film", () => {
    const board = [
      gradeScene("s1", 0, { atSec: 1, toGrade: "cold" }, 1),
      gradeScene("s2", 4, { atSec: 5, toGrade: "neutral" }, 5),
      gradeScene("s3", 8, { atSec: 9, toGrade: "warm" }, 9),
    ];
    const result = dropUnusableGradeShifts(board);
    expect(result.storyboard.filter((scene) => scene.gradeShift)).toHaveLength(2);
    expect(result.dropped.some((line) => line.includes("per-film cap"))).toBe(true);
  });

  it("binds a moment to grade-shift evidence", () => {
    const scenes = [gradeScene("hero", 0, { atSec: 1.6, toGrade: "warm" }, 1.6)];
    const contract = resolveMomentContract("<main></main>", scenes, 4);
    const moment = contract.moments.find((entry) => entry.id === "hero-m");
    expect(moment?.evidence?.kind).toBe("grade-shift");
  });
});

describe("Sentinel Phase 5 — morph twin reconciliation at parse", () => {
  function planWithMorph(components: object[], moments: object[] = []) {
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            components,
            beats: [{
              version: 1,
              id: "showpiece-morph",
              sceneId: "product-proof",
              component: "quick-search",
              kind: "morph",
              atSec: 4.0,
              morphTo: "cmd-palette",
            }],
            moments,
          }
        : scene
    );
    return `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`;
  }

  it("declares the missing twin when the source kind has exactly one legal partner", () => {
    // search morphs only with command-palette: the twin's kind is a one-choice
    // table lookup, so the host completes the model's own declaration.
    const parsed = parseStoryboardResponse(
      planWithMorph([{ version: 1, id: "quick-search", kind: "search" }]),
    );
    const twin = parsed[1]!.components!.find((entry) => entry.id === "cmd-palette");
    expect(twin?.kind).toBe("command-palette");
    const beat = parsed[1]!.beats!.find((entry) => entry.id === "showpiece-morph")!;
    expect(beat.kind).toBe("morph");
    expect(beat.morphTo).toBe("cmd-palette");
    expect(parsed[1]!.sentinelNormalizations?.length).toBe(1);
  });

  it("keeps a load-bearing pill-to-pill morph between distinct button ids", () => {
    const parsed = parseStoryboardResponse(
      planWithMorph(
        [
          { version: 1, id: "quick-search", kind: "button" },
          { version: 1, id: "cmd-palette", kind: "button" },
        ],
        [{
          version: 1,
          id: "pill-resolves",
          sceneId: "product-proof",
          atSec: 4.4,
          title: "Approval resolves",
          visualState: "Approved pill replaces Needs review",
          change: "the status pill changes state",
          motionIntent: "morph",
          importance: "primary",
        }],
      ),
    );
    const beat = parsed[1]!.beats!.find((entry) => entry.id === "showpiece-morph")!;
    expect(beat.kind).toBe("morph");
    expect(beat.morphTo).toBe("cmd-palette");
  });

  it("degrades an ambiguous non-load-bearing morph to highlight instead of vetoing", () => {
    // A button has no catalog morph partner — no unique twin kind exists.
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            components: [{ version: 1, id: "cta-button", kind: "button" }],
            beats: [{
              version: 1,
              id: "vague-morph",
              sceneId: "product-proof",
              component: "cta-button",
              kind: "morph",
              atSec: 4.0,
              morphTo: "mystery-panel",
            }],
          }
        : scene
    );
    const parsed = parseStoryboardResponse(`<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`);
    const beat = parsed[1]!.beats!.find((entry) => entry.id === "vague-morph")!;
    expect(beat.kind).toBe("highlight");
    expect(beat.morphTo).toBeUndefined();
  });

  it("keeps an ambiguous LOAD-BEARING morph blocking", () => {
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            components: [{ version: 1, id: "cta-button", kind: "button" }],
            beats: [{
              version: 1,
              id: "vague-morph",
              sceneId: "product-proof",
              component: "cta-button",
              kind: "morph",
              atSec: 4.0,
              morphTo: "mystery-panel",
            }],
            moments: [{
              version: 1,
              id: "m-morph",
              sceneId: "product-proof",
              atSec: 4.3,
              title: "The morph",
              visualState: "twin visible",
              change: "button becomes panel",
              motionIntent: "morph",
              importance: "primary",
            }],
          }
        : scene
    );
    expect(() =>
      parseStoryboardResponse(`<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`)
    ).toThrow(/morphs to undeclared component/);
  });
});

describe("Sentinel Phase 5 — timeRamp retime normalization", () => {
  function rampPlan(atSec: number, withMoment: boolean) {
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            durationSec: 6,
            timeRamp: { version: 1, atSec, slowTo: 0.35, holdSec: 0.6, recoverSec: 0.9 },
            ...(withMoment
              ? {
                  moments: [{
                    version: 1,
                    id: "m-resolve",
                    sceneId: "product-proof",
                    atSec: 5.0,
                    title: "Metric resolves",
                    visualState: "metric at final value",
                    change: "the number lands",
                    motionIntent: "resolve",
                    importance: "primary",
                  }],
                }
              : {}),
          }
        : { ...scene, startSec: index === 2 ? 9 : scene.startSec }
    );
    return `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`;
  }

  it("retimes a ramp whose hold misses the scene's own moment (direct)", () => {
    // Declared dip at 3.6s; the only moment sits at 5.0s — previously three
    // probe attempts died on exactly this sub-second targeting problem.
    // (Unit-level: a full parse would also demand the film-wide moment grid,
    // which is not what this proves.)
    const scenes = storyboard();
    const plan = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            durationSec: 6,
            timeRamp: { version: 1 as const, atSec: 3.6, slowTo: 0.35, holdSec: 0.6, recoverSec: 0.9 },
            moments: [{
              version: 1 as const,
              id: "m-resolve",
              sceneId: "product-proof",
              atSec: 5.0,
              title: "Metric resolves",
              visualState: "metric at final value",
              change: "the number lands",
              motionIntent: "resolve",
              importance: "primary" as const,
            }],
          }
        : index === 2
          ? { ...scene, startSec: 9 }
          : scene
    );
    const result = retimeUnmotivatedTimeRamps(plan);
    expect(result.normalized).toHaveLength(1);
    const ramped = result.scenes[1]!;
    expect(ramped.timeRamp!.atSec).not.toBe(3.6);
    // The retimed ramp provably resolves AND covers the moment.
    const resolved = resolveTimeRampPlan(result.scenes).ramps.find(
      (ramp) => ramp.sceneId === "product-proof",
    )!;
    const hold = timeRampHoldWindow(resolved);
    expect(5.0).toBeGreaterThanOrEqual(hold.contentStartSec - 0.35);
    expect(5.0).toBeLessThanOrEqual(hold.contentEndSec + 0.35);
    expect(ramped.sentinelNormalizations?.some((note) => note.includes("retimed the timeRamp")))
      .toBe(true);
  });

  it("leaves a scene with no moments untouched (nothing to motivate with)", () => {
    const scenes = storyboard();
    const plan = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            durationSec: 6,
            timeRamp: { version: 1 as const, atSec: 3.6, slowTo: 0.35, holdSec: 0.6, recoverSec: 0.9 },
          }
        : index === 2
          ? { ...scene, startSec: 9 }
          : scene
    );
    const result = retimeUnmotivatedTimeRamps(plan);
    expect(result.normalized).toEqual([]);
    expect(result.scenes[1]!.timeRamp!.atSec).toBe(3.6);
  });

  it("keeps the blocking finding for a required ramp no retime can motivate (parse)", () => {
    expect(() =>
      parseStoryboardResponse(rampPlan(3.6, false), { requireTimeRamp: true })
    ).toThrow(/timeRamp dip must be motivated/);
  });
});

describe("Sentinel Phase 5 — normalization commits when remaining findings pre-existed", () => {
  it("commits the pacing fix and rejects with ONLY the model's own remaining finding class", () => {
    // The middle scene has a marginal reading miss (host-stretchable) AND the
    // film misses the framing floor... instead use a duplicated-id error as the
    // co-occurring, normalization-independent deficit: the stretch must COMMIT
    // (its class is absent from the remaining findings) and the thrown message
    // must no longer carry pacing/reading.
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            components: [{ version: 1, id: "headline", kind: "search" }],
            beats: [{
              version: 1,
              id: "type-headline",
              sceneId: "product-proof",
              component: "headline",
              kind: "type",
              atSec: 5.0,
              text: "deploy",
            }],
          }
        : index === 2
          ? { ...scene, foreground: undefined }
          : scene
    );
    const response = `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`;
    let error: unknown;
    try {
      parseStoryboardResponse(response);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(StoryboardValidationError);
    const validation = error as StoryboardValidationError;
    // The model's own deficit survives; the host-fixable arithmetic does not.
    expect(validation.message).toContain("missing foreground");
    expect(validation.message).not.toContain("pacing/reading");
    // The carried retry baseline is the NORMALIZED plan (stretched scene).
    expect(validation.storyboard[1]!.durationSec).toBeGreaterThan(3);
    expect(
      validation.storyboard[1]!.sentinelNormalizations?.some((note) => note.includes("stretched")),
    ).toBe(true);
  });
});

describe("Sentinel Phase 3 — criticSkippableCleanDraft (critic gating predicate)", () => {
  const base: DirectBrowserQaResult = {
    ok: true,
    strictOk: true,
    samples: [0, 2, 4],
    issues: [],
    errors: [],
    warnings: [],
  };

  it("skips the critic for a pristine draft (strictOk, zero quality penalty)", () => {
    expect(criticSkippableCleanDraft(base)).toBe(true);
  });

  it("runs the critic when a polish finding shipped (not strictOk)", () => {
    expect(criticSkippableCleanDraft({ ...base, strictOk: false })).toBe(false);
  });

  it("runs the critic when a weighted issue is present even if strictOk", () => {
    expect(criticSkippableCleanDraft({
      ...base,
      issues: [{
        code: "camera_framed_sparse",
        severity: "warning",
        time: 4,
        selector: "#scene",
        message: "sparse",
        source: "sequences",
      }],
    })).toBe(false);
  });

  it("runs the critic when a browser console warning is present", () => {
    expect(criticSkippableCleanDraft({ ...base, warnings: ["browser_warning: deprecated api"] }))
      .toBe(false);
  });

  it("runs the critic when browser QA did not execute (infra outage) or is absent", () => {
    expect(criticSkippableCleanDraft({ ...base, infraError: "no chrome" })).toBe(false);
    expect(criticSkippableCleanDraft(undefined)).toBe(false);
  });

  it("runs the critic when the shipped draft carries static repair warnings", () => {
    // A repaired-but-pixel-pristine least-bad pick is exactly a draft the
    // critic can improve — the least-bad penalty weights these, so the skip
    // predicate must too (Phase-5 audit item S3a).
    expect(criticSkippableCleanDraft(base, ["frame: hero contrast repaired"])).toBe(false);
  });

  it("skips the critic when the run shipped stagnant (critic-economy 2026-07-08)", () => {
    // A non-pristine draft that shipped under stagnant-polish-early-ship
    // resisted two identical-signature patches; a third won't help either.
    const stuck: DirectBrowserQaResult = {
      ...base,
      strictOk: false,
      issues: [{
        code: "contrast_aa",
        severity: "warning",
        time: 4,
        selector: ".cmp-label",
        message: "contrast 3.9",
        source: "sequences",
      }],
    };
    expect(criticSkippableCleanDraft(stuck, [], "stagnant-polish-early-ship:penalty=4")).toBe(true);
  });

  it("still runs the critic on an ordinary least-bad or early-least-bad ship", () => {
    // Only the stagnation reason qualifies — the ordinary attempt-3 least-bad
    // pick never proved two-patch resistance, and the early budget-broker exit
    // ships a LOW-penalty draft the critic may still improve.
    const stuck: DirectBrowserQaResult = {
      ...base,
      strictOk: false,
      issues: [{
        code: "contrast_aa",
        severity: "warning",
        time: 4,
        selector: ".cmp-label",
        message: "contrast 3.9",
        source: "sequences",
      }],
    };
    expect(criticSkippableCleanDraft(stuck, [], "least-bad-pick:penalty=7")).toBe(false);
    expect(criticSkippableCleanDraft(stuck, [], "early-least-bad-pick:penalty=3;findings=polish"))
      .toBe(false);
    expect(criticSkippableCleanDraft(stuck, [], undefined)).toBe(false);
  });

  it("skips a pristine draft regardless of ship reason", () => {
    expect(criticSkippableCleanDraft(base, [], "least-bad-pick:penalty=0")).toBe(true);
  });

  it("allows the attempt-2 broker to publish low-penalty advisory layout polish", () => {
    const browserQa: DirectBrowserQaResult = {
      ...base,
      strictOk: false,
      issues: [{
        code: "layout_intent_missing",
        severity: "warning",
        time: 2,
        selector: "#scene",
        message: "Visible scene declares no relational layout intent.",
        source: "sequences",
      }],
      warnings: ["layout_intent_missing #scene (t=2.00s): Visible scene declares no relational layout intent."],
    };
    const reason = earlyLeastBadPublishReason({
      draft: draft(),
      raw: "<index_html></index_html>",
      attempts: 1,
      browserQa,
      qualityPenalty: 1,
    });
    expect(reason).toContain("early-least-bad-pick:penalty=1");
  });

  it("keeps high-visibility browser findings out of the early broker", () => {
    const browserQa: DirectBrowserQaResult = {
      ...base,
      strictOk: false,
      issues: [{
        code: "camera_framed_clipped",
        severity: "error",
        time: 6,
        selector: "[data-part=\"hero\"]",
        message: "clipped",
        source: "sequences",
      }],
      warnings: ["camera_framed_clipped [data-part=\"hero\"] (t=6.00s): clipped"],
    };
    expect(earlyLeastBadPublishReason({
      draft: draft(),
      raw: "<index_html></index_html>",
      attempts: 1,
      browserQa,
      qualityPenalty: 10,
    })).toBeUndefined();
  });

  it("counts declaration paperwork at zero weight in the quality penalty", () => {
    // layout_intent_missing asks for a DECLARATION, not a visual change — a
    // banked draft is not one pixel worse for lacking it, so it must not hold
    // the attempt-2 broker under its penalty ceiling (2026-07-07 sweep).
    const paperworkOnly: DirectBrowserQaResult = {
      ...base,
      strictOk: false,
      issues: [1, 2, 3, 4, 5, 6].map((n) => ({
        code: "layout_intent_missing",
        severity: "warning" as const,
        time: n,
        selector: `#scene-${n}`,
        message: "Visible scene declares no relational layout intent.",
        source: "sequences" as const,
      })),
    };
    expect(browserQualityPenalty(paperworkOnly)).toBe(0);
    // A measured visual warning still counts.
    expect(browserQualityPenalty({
      ...paperworkOnly,
      issues: [...paperworkOnly.issues, {
        code: "content_overlap",
        severity: "warning",
        time: 2,
        selector: "#metric",
        message: "Two text blocks overlap.",
        source: "sequences",
      }],
    })).toBe(1);
  });

  it("ranks fuller, on-anchor, settled blocking evidence ahead of a rough landing", () => {
    const evidence = {
      version: 1 as const,
      advisory: true as const,
      planSummary: {
        phraseCount: 1,
        explicitTargetCount: 1,
        primaryPhraseCount: 1,
        primaryWithReadableLandingCount: 1,
      },
      landings: [{
        blockId: "proof:block",
        sceneId: "proof",
        phraseId: "proof:01",
        time: 2,
        importance: "primary" as const,
        target: { kind: "part" as const, id: "hero" },
        measured: true,
        visibleFraction: 1,
        occupancyFraction: 0.2,
        occupancyInRange: true,
        anchorError: 0.04,
        speed: 0.006,
        dwellSec: 0.8,
      }],
      trajectories: [],
      continuityEdges: [],
      summary: {
        landingCount: 1,
        measuredLandingCount: 1,
        visibleLandingCount: 1,
        occupancyInRangeCount: 1,
        primaryLandingCount: 1,
        primaryReadableCount: 1,
        threeShotEntityCount: 1,
        peakSpeed: 0.006,
        peakAcceleration: 0.02,
        peakJerk: 0.1,
      },
      advisories: [],
    };
    const controlled: DirectBrowserQaResult = { ...base, cameraBlockingEvidence: evidence };
    const rough: DirectBrowserQaResult = {
      ...base,
      cameraBlockingEvidence: {
        ...evidence,
        landings: [{
          ...evidence.landings[0]!,
          occupancyInRange: false,
          anchorError: 0.28,
          speed: 0.09,
        }],
      },
    };

    expect(browserQualityPenalty(controlled)).toBe(0);
    expect(browserQualityPenalty(rough)).toBeGreaterThan(browserQualityPenalty(controlled));

    const contextual: DirectBrowserQaResult = {
      ...base,
      cameraBlockingEvidence: {
        ...evidence,
        landings: [{
          ...evidence.landings[0]!,
          framingTarget: { kind: "region" as const, id: "proof-panel" },
          anchorError: 0.28,
        }],
      },
    };
    expect(browserQualityPenalty(contextual)).toBe(0);
  });

  it("does not hide least-bad pressure behind context-waived quiet evidence", () => {
    const quietEvidence = {
      quietWindows: [{ sceneId: "proof", startSec: 2, endSec: 3.8, durationSec: 1.8 }],
      settleWindows: [],
    } as unknown as NonNullable<DirectBrowserQaResult["continuousMotion"]>;
    const waived: DirectBrowserQaResult = { ...base, continuousMotion: quietEvidence };
    expect(browserQualityPenalty(waived)).toBe(0);

    const surfaced: DirectBrowserQaResult = {
      ...waived,
      issues: [{
        code: "motion_quiet_window",
        severity: "warning",
        sceneId: "proof",
        time: 2,
        selector: '[data-scene="proof"]',
        message: "Scene is visually still.",
        source: "sequences",
      }],
    };
    expect(browserQualityPenalty(surfaced)).toBeGreaterThan(0);
  });

  it("normalizes measurement jitter out of stagnation keys (digit-stripped)", () => {
    // The same defect re-measured: contrast moved 4.4:1 → 3.39:1 and the
    // window shifted, but the defect LIST is unchanged — the classKey
    // precedent from the storyboard commit-or-revert.
    expect(stagnantPolishSignature(
      "contrast_aa div.seg-time (t=7.74s): Contrast is 4.4:1; needs 4.5:1.",
    )).toBe(stagnantPolishSignature(
      "contrast_aa div.seg-time (t=7.74–8.35s): Contrast is 3.39:1; needs 4.5:1.",
    ));
    // A different element is a different defect.
    expect(stagnantPolishSignature(
      "contrast_aa div.seg-time (t=7.74s): Contrast is 4.4:1; needs 4.5:1.",
    )).not.toBe(stagnantPolishSignature(
      "contrast_aa span.alert-chip (t=8.35s): Contrast is 3.45:1; needs 4.5:1.",
    ));
  });

  it("ships the banked draft when a patch provably changed nothing (stagnant signatures)", () => {
    // Attempt 2's browser findings are byte-identical to attempt 1's — the
    // paid patch between them moved nothing the gate measures, so attempt 3
    // would publish the same banked draft with the same advisories anyway.
    const signatures = [
      "layout_intent_missing #cold-open",
      "contrast_aa div.seg-time",
    ];
    expect(stagnantPolishShipReason({
      attempt: 2,
      browserQaOk: true,
      currentSignatures: signatures,
      previousSignatures: new Set(signatures),
      bankedPenalty: 7,
    })).toBe("stagnant-polish-early-ship:penalty=7");
    // Progress (a differing set) keeps the ladder running.
    expect(stagnantPolishShipReason({
      attempt: 2,
      browserQaOk: true,
      currentSignatures: [signatures[0]!],
      previousSignatures: new Set(signatures),
      bankedPenalty: 7,
    })).toBeUndefined();
    // Attempt 1 has no previous rejection to compare against.
    expect(stagnantPolishShipReason({
      attempt: 1,
      browserQaOk: true,
      currentSignatures: signatures,
      previousSignatures: new Set(),
      bankedPenalty: 7,
    })).toBeUndefined();
    // A hard runtime failure (browserQa.ok false) never takes the early exit.
    expect(stagnantPolishShipReason({
      attempt: 2,
      browserQaOk: false,
      currentSignatures: signatures,
      previousSignatures: new Set(signatures),
      bankedPenalty: 7,
    })).toBeUndefined();
    // Nothing banked → nothing to ship.
    expect(stagnantPolishShipReason({
      attempt: 2,
      browserQaOk: true,
      currentSignatures: signatures,
      previousSignatures: new Set(signatures),
      bankedPenalty: undefined,
    })).toBeUndefined();
  });

  it("keeps static moments and layout paperwork advisory for paid source retries", () => {
    const qa: DirectBrowserQaResult = {
      ...base,
      strictOk: false,
      warnings: [
        "moment_static_frame moment:m-ghost (t=6.00s): invisible change",
        "layout_intent_missing #scene (t=2.00s): Visible scene declares no relational layout intent.",
      ],
      temporalJudge: [{
        momentId: "m-ghost",
        title: "Ghost",
        importance: "supporting",
        atSec: 6,
        beforeSec: 5.8,
        midSec: 6,
        afterSec: 6.2,
        changedRatio: 0,
        meanDelta: 0,
        verdict: "static",
      }],
    };
    expect(sourceRetryFeedbackForBrowserQa(qa)).toEqual([]);
    expect(sourceRetryFeedbackForBrowserQa({
      ...qa,
      temporalJudge: qa.temporalJudge?.map((entry) => ({ ...entry, importance: "primary" })),
    })).toEqual([]);
    const blank = sourceRetryFeedbackForBrowserQa({
      ...qa,
      errors: ["near_blank_film: 1 scene renders as blank frames"],
    });
    expect(blank).toContain("near_blank_film: 1 scene renders as blank frames");
    expect(blank).not.toContain("moment_static_frame moment:m-ghost (t=6.00s): invisible change");
    const unreadablePrimary = sourceRetryFeedbackForBrowserQa({
      ...qa,
      issues: [{
        code: "text_occluded",
        severity: "error",
        time: 2,
        selector: "#primary-copy",
        sceneId: "proof",
        part: "primary-copy",
        message: "primary copy is covered",
        source: "sequences",
      }],
      loadBearingContainment: [{
        sceneId: "proof",
        part: "primary-copy",
        detector: "primary-moment",
        time: 2,
        found: true,
        opacity: 1,
        visibleFraction: 1,
        requiredVisibleFraction: 0.85,
      }],
    });
    expect(unreadablePrimary).toContain("text_occluded: primary copy is covered");
  });

  it("routes only malformed or unexecutable storyboard findings into paid repair", () => {
    expect(storyboardFindingDecision(
      'camera/idea-budget: scene "proof" asks the lens to tell competing ideas',
    )).toBe("advisory");
    expect(storyboardFindingDecision(
      'pacing/outcome: scene "proof" needs a longer hold',
    )).toBe("advisory");
    expect(storyboardFindingDecision(
      'storyboard/moments: scene "proof" clusters all its moments at the entrance',
    )).toBe("advisory");
    expect(storyboardFindingDecision(
      'interaction "approve" timing escapes shot "proof"',
    )).toBe("hard");
    expect(storyboardFindingDecision(
      'shot "proof" duration must be 1.5-15 seconds',
    )).toBe("hard");
  });

  it("injects deterministic selector-scoped contrast repairs from browser QA metadata", () => {
    const repaired = repairContrastAaIssues(draft(), {
      ...base,
      strictOk: false,
      issues: [{
        code: "contrast_aa",
        severity: "warning",
        time: 2,
        selector: "#sell-btn-el",
        text: "Sell it",
        message: "Contrast is 2.57:1; needs 3:1.",
        fixHint: "Adjust the existing semantic color.",
        source: "hyperframes",
        contrast: {
          ratio: 2.57,
          required: 3,
          foreground: "rgb(120,120,120)",
          background: "rgb(210,210,210)",
          suggestedColor: "rgb(80,80,80)",
        },
      }, {
        code: "contrast_aa",
        severity: "warning",
        time: 2,
        selector: "span.cmp-label",
        text: "Too broad to recolor globally",
        message: "Contrast is 2.57:1; needs 3:1.",
        fixHint: "Adjust the existing semantic color.",
        source: "hyperframes",
        contrast: {
          ratio: 2.57,
          required: 3,
          foreground: "rgb(120,120,120)",
          background: "rgb(210,210,210)",
          suggestedColor: "rgb(80,80,80)",
        },
      }],
      warnings: ["contrast_aa #sell-btn-el (t=2.00s): Contrast is 2.57:1; needs 3:1."],
    });
    expect(repaired.repaired).toEqual(["#sell-btn-el"]);
    expect(repaired.draft.html).toContain("data-sequences-contrast-repair");
    expect(repaired.draft.html).toContain("#sell-btn-el{color:rgb(80,80,80) !important;}");
    expect(repaired.draft.html).not.toContain("span.cmp-label{color:");
  });

  it("deepens only an exact declared focal from measured washout evidence", () => {
    const before = draft();
    before.storyboard[0] = {
      ...before.storyboard[0]!,
      spatialIntent: {
        version: 1,
        focalPart: "hero-title",
        composition: "one centered high-key hero",
        relationships: ["the headline is the sole focal"],
      },
      components: [{
        version: 1,
        id: "hero-title",
        kind: "headline",
        role: "hero",
      }],
    };
    before.html = before.html.replace(
      '<h1 id="hook-title">',
      '<h1 id="hook-title" class="cmp-headline" data-part="hero-title"><span class="cmp-text">',
    ).replace(
      "Trace the impossible.</h1>",
      "Trace the impossible.</span></h1>",
    );
    const repaired = repairCompositionWashoutIssues(before, {
      ...base,
      issues: [{
        code: "composition_washed_out",
        severity: "warning",
        time: 2,
        sceneId: "hook",
        part: "hero-title",
        selector: '[data-part="hero-title"]',
        message: "The field and focal collapse into one pale band.",
        source: "sequences",
      }, {
        code: "composition_washed_out",
        severity: "warning",
        time: 6,
        sceneId: "payoff",
        part: "unowned",
        selector: '[data-part="unowned"]',
        message: "Not a declared focal.",
        source: "sequences",
      }],
      warnings: [],
    });

    expect(repaired.repaired).toEqual([
      '[data-scene="hook"] [data-part="hero-title"]',
    ]);
    expect(repaired.draft.html).toContain("data-sequences-washout-repair");
    expect(repaired.draft.html).toContain(
      '[data-scene="hook"] [data-part="hero-title"]{background:rgb(24,32,47) !important;',
    );
    expect(repaired.draft.html).not.toContain('[data-part="unowned"]{');
  });

  it("uses a unique scene-scoped repair selector for a compact contrast audit label", () => {
    const repaired = repairContrastAaIssues(draft(), {
      ...base,
      strictOk: false,
      issues: [{
        code: "contrast_aa",
        severity: "warning",
        time: 2,
        selector: "span.cmp-label",
        repairSelector: '[data-scene="scene-a"] > div:nth-of-type(2) > span:nth-of-type(1)',
        text: "Start with BeaconOps",
        message: "Contrast is 1.14:1; needs 4.5:1.",
        source: "hyperframes",
        contrast: {
          ratio: 1.14,
          required: 4.5,
          suggestedColor: "rgb(250,250,250)",
        },
      }],
      warnings: [],
    });
    expect(repaired.repaired).toEqual([
      '[data-scene="scene-a"] > div:nth-of-type(2) > span:nth-of-type(1)',
    ]);
    expect(repaired.draft.html).toContain(
      '[data-scene="scene-a"] > div:nth-of-type(2) > span:nth-of-type(1){color:rgb(250,250,250) !important;}',
    );
    expect(repaired.draft.html).not.toContain("span.cmp-label{color:");
  });

  it("accumulates exact contrast repairs discovered on consecutive sampled passes", () => {
    const issue = (selector: string, color: string) => ({
      code: "contrast_aa",
      severity: "warning" as const,
      time: 2,
      selector,
      message: "Contrast is 2.5:1; needs 3:1.",
      source: "hyperframes" as const,
      contrast: { ratio: 2.5, required: 3, suggestedColor: color },
    });
    const first = repairContrastAaIssues(draft(), {
      ...base,
      strictOk: false,
      issues: [issue("#sell-btn-el", "rgb(80,80,80)")],
      warnings: [],
    });
    const second = repairContrastAaIssues(first.draft, {
      ...base,
      strictOk: false,
      issues: [issue("#proof-copy", "rgb(40,40,40)")],
      warnings: [],
    });
    expect(second.draft.html).toContain("#sell-btn-el{color:rgb(80,80,80) !important;}");
    expect(second.draft.html).toContain("#proof-copy{color:rgb(40,40,40) !important;}");
    expect(second.draft.html.match(/data-sequences-contrast-repair/g)).toHaveLength(1);
  });

  it("contrast repair neutralizes replace-pattern and style-closing text in the comment", () => {
    const before = draft();
    const repaired = repairContrastAaIssues(before, {
      ...base,
      strictOk: false,
      issues: [{
        code: "contrast_aa",
        severity: "warning",
        time: 2,
        selector: "#sell-btn-el",
        // On-screen copy is untrusted: `$'` / `$&` are special in String.replace
        // replacement strings and `</style>` would end the injected block.
        text: "$' $& </style> $$9",
        message: "Contrast is 2.57:1; needs 3:1.",
        fixHint: "Adjust the existing semantic color.",
        source: "hyperframes",
        contrast: {
          ratio: 2.57,
          required: 3,
          suggestedColor: "rgb(80,80,80)",
        },
      }],
      warnings: ["contrast_aa #sell-btn-el (t=2.00s): Contrast is 2.57:1; needs 3:1."],
    });
    expect(repaired.repaired).toEqual(["#sell-btn-el"]);
    expect(repaired.draft.html).toContain("#sell-btn-el{color:rgb(80,80,80) !important;}");
    // The style block closes exactly once and no replacement pattern expanded.
    const styleBlock = repaired.draft.html.match(
      /<style data-sequences-contrast-repair>[\s\S]*?<\/style>/,
    )?.[0] ?? "";
    expect(styleBlock).not.toContain("$");
    expect(styleBlock).not.toContain("</style> ");
    const headCloses = repaired.draft.html.match(/<\/head>/gi) ?? [];
    expect(headCloses.length).toBeLessThanOrEqual(1);
  });

  it("injects missing layout intent from storyboard spatial intent", () => {
    const value = draft();
    const scenes = [{
      ...value.storyboard[0]!,
      spatialIntent: {
        version: 1 as const,
        focalPart: "hero-copy",
        composition: "centered hero claim",
        relationships: [],
        frameAnchor: "frame:left-third" as const,
      },
    }];
    const source = value.html
      .replace('data-layout-important data-layout-anchor="frame:center"', "")
      .replace('<h1 id="hook-title">', '<h1 id="hook-title" data-part="hero-copy">');

    const repaired = injectLayoutIntentHints(source, scenes);

    expect(repaired.repaired).toEqual(["hook"]);
    expect(repaired.html).toContain(
      '<h1 id="hook-title" data-part="hero-copy" data-layout-important="1" ' +
        'data-layout-anchor="frame:left-third" data-layout-tolerance="48">',
    );
  });

  it("injects a scene-level layout anchor when spatial intent has no authored focal part", () => {
    const value = draft();
    const scenes = [{
      ...value.storyboard[0]!,
      spatialIntent: {
        version: 1 as const,
        focalPart: "absent-copy",
        composition: "centered hero claim",
        relationships: [],
      },
    }];
    const source = value.html.replace('data-layout-important data-layout-anchor="frame:center"', "");

    const repaired = injectLayoutIntentHints(source, scenes);

    expect(repaired.repaired).toEqual(["hook"]);
    expect(repaired.html).toContain(
      '<section id="hook" class="scene clip" data-scene="hook" data-start="0" ' +
        'data-duration="4" data-track-index="1" data-layout-anchor="frame:center" ' +
        'data-layout-tolerance="48">',
    );
  });

  it("leaves existing authored layout intent unchanged", () => {
    const value = draft();
    const scenes = [{
      ...value.storyboard[0]!,
      spatialIntent: {
        version: 1 as const,
        focalPart: "hero-copy",
        composition: "centered hero claim",
        relationships: [],
        frameAnchor: "frame:left-third" as const,
      },
    }];

    const repaired = injectLayoutIntentHints(value.html, scenes);

    expect(repaired.repaired).toEqual([]);
    expect(repaired.html).toBe(value.html);
  });
});

describe("WS-I critic adoption transaction", () => {
  const evidence = (label: string, draftHash?: string) => {
    const strip = Buffer.from(`strip:${label}`).toString("base64");
    const digest = createHash("sha256").update(Buffer.from(strip, "base64")).digest("hex");
    return {
      version: 1 as const,
      draftHash: draftHash ?? createHash("sha256").update(`draft:${label}`).digest("hex"),
      evidenceHash: createHash("sha256").update(`evidence:${label}`).digest("hex"),
      stripPngBase64: strip,
      stripSha256: digest,
      stripPath: path.join("build", "qa", "critic", label, "strip.png"),
      manifestPath: path.join("build", "qa", "critic", label, "evidence.json"),
      stripTimes: [1],
      blockingTimes: [],
    };
  };

  const longDraft = (): DirectCompositionDraft => {
    const value = draft();
    value.storyboard[1] = { ...value.storyboard[1]!, durationSec: 6 };
    value.html = value.html
      .replace('data-duration="8"', 'data-duration="10"')
      .replace(
        'data-scene="payoff" data-start="4" data-duration="4"',
        'data-scene="payoff" data-start="4" data-duration="6"',
      )
      .replace('tl.set("#payoff", { opacity: 0 }, 8);', 'tl.set("#payoff", { opacity: 0 }, 10);');
    return value;
  };

  const cleanQa = (): DirectBrowserQaResult => ({
    ok: true,
    strictOk: true,
    samples: [0, 4, 8],
    issues: [],
    errors: [],
    warnings: [],
  });

  it("skips the enabled visual critic when rendered QA is pristine", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CREATIVE_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_VISION_CRITIC", "1");
    const value = longDraft();
    const complete = vi.fn();
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "clean visual critic",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const before = {
      draft: value,
      raw: response(value),
      attempts: 1,
      browserQa: cleanQa(),
    };
    const result = await applyContinuityCritique(provider, {
      brief: "Launch Relay",
      projectDir: projectDir(),
      skills: skills(),
      lockedStoryboard: value.storyboard,
    }, before);

    expect(result).toBe(before);
    expect(complete).not.toHaveBeenCalled();
  });

  it("never sends critic images to the configured text-only OpenRouter source model", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CREATIVE_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_VISION_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SKIP_CLEAN", "0");
    // This recreates the dangerous inheritance path: `primary` omits a
    // storyboard override, so OpenRouter would otherwise fall through to the
    // configured source model while retaining the PNG attachments.
    vi.stubEnv("SLACK_SEQUENCES_STORYBOARD_MODEL", "primary");
    vi.stubEnv("SEQUENCES_OPENROUTER_MODEL", "deepseek/deepseek-v4-pro");
    const value = longDraft();
    const dir = projectDir();
    const visualQa = {
      ...cleanQa(),
      visionCriticEvidence: evidence(
        "source-model-route",
        visionCriticDraftHash(dir, value),
      ),
    };
    const inspector = vi.mocked(inspectDirectComposition);
    const priorInspector = inspector.getMockImplementation();
    inspector.mockClear();
    inspector.mockResolvedValueOnce(visualQa);
    const complete = vi.fn().mockResolvedValue(JSON.stringify({
      verdict: "ship",
      directives: [],
    }));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "capability-safe visual critic",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    try {
      const result = await applyContinuityCritique(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: value.storyboard,
      }, {
        draft: value,
        raw: response(value),
        attempts: 1,
        browserQa: cleanQa(),
      });

      expect(result.draft).toBe(value);
      expect(result.browserQa).toBe(visualQa);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0]?.[1]).toMatchObject({
        images: expect.any(Array),
        model: OPENROUTER_VISION_CRITIC_MODEL,
        thinkingMode: "minimal",
      });
      expect(complete.mock.calls[0]?.[1]?.images).toHaveLength(1);
      expect(complete.mock.calls[0]?.[1]?.model).not.toBe("deepseek/deepseek-v4-pro");
      expect(complete.mock.calls[0]?.[1]?.model).not.toBe("z-ai/glm-5.2");
    } finally {
      inspector.mockImplementation(priorInspector!);
    }
  });

  it("fails safe before dispatch when an API provider has no audited image model", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CREATIVE_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_VISION_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SKIP_CLEAN", "0");
    const value = longDraft();
    const dir = projectDir();
    const visualQa = {
      ...cleanQa(),
      visionCriticEvidence: evidence(
        "unsupported-api-route",
        visionCriticDraftHash(dir, value),
      ),
    };
    const inspector = vi.mocked(inspectDirectComposition);
    const priorInspector = inspector.getMockImplementation();
    inspector.mockClear();
    inspector.mockResolvedValueOnce(visualQa);
    const complete = vi.fn();
    const provider: AgentProvider = {
      id: "deepseek-api",
      label: "text-only API critic",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    try {
      const before = {
        draft: value,
        raw: response(value),
        attempts: 1,
        browserQa: cleanQa(),
      };
      const result = await applyContinuityCritique(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: value.storyboard,
      }, before);

      expect(result.draft).toBe(before.draft);
      expect(result.browserQa).toBe(visualQa);
      expect(complete).not.toHaveBeenCalled();
    } finally {
      inspector.mockImplementation(priorInspector!);
    }
  });

  it("uses the fresh visual baseline and publishes only the accepted candidate generation", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CREATIVE_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_VISION_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SKIP_CLEAN", "0");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SLOT_REPAIR", "0");
    const value = longDraft();
    const dir = projectDir();
    const staleQa = cleanQa();
    const baselineEvidence = evidence("baseline", visionCriticDraftHash(dir, value));
    const deterministicCandidate = applyDeterministicSourceRepairs({
      storyboard: value.storyboard,
      html: value.html.replace("Ship with nerve.", "Ship with clarity."),
    }, dir, value.storyboard);
    const candidateEvidence = evidence(
      "candidate",
      visionCriticDraftHash(dir, deterministicCandidate),
    );
    const freshBaseline = {
      ...cleanQa(),
      strictOk: false,
      issues: [{
        code: "camera_blocking_landing",
        severity: "warning" as const,
        time: 6,
        selector: "[data-part=payoff]",
        message: "rough landing",
        source: "sequences" as const,
      }],
      visionCriticEvidence: baselineEvidence,
    };
    const candidateQa = {
      ...cleanQa(),
      issues: [{
        code: "composition_washed_out",
        severity: "warning" as const,
        time: 8,
        selector: "[data-part=payoff]",
        message: "low focal separation",
        source: "sequences" as const,
      }],
      warnings: ["composition_washed_out: low focal separation"],
      visionCriticEvidence: candidateEvidence,
    };
    const inspector = vi.mocked(inspectDirectComposition);
    const priorInspector = inspector.getMockImplementation();
    inspector.mockClear();
    inspector
      .mockResolvedValueOnce(freshBaseline)
      .mockResolvedValueOnce(candidateQa);
    const publisher = vi.mocked(publishCanonicalVisionEvidence);
    publisher.mockClear();
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        verdict: "repair",
        directives: ["Strengthen the final value hierarchy."],
      }))
      .mockResolvedValueOnce(patchResponse("Ship with nerve.", "Ship with clarity."));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test critic",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    try {
      const result = await applyContinuityCritique(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: value.storyboard,
      }, {
        draft: value,
        raw: response(value),
        attempts: 1,
        browserQa: staleQa,
      });

      // Candidate penalty 3 would regress the stale penalty-0 report, but it
      // improves the fresh visual baseline's penalty 8 and is therefore valid.
      expect(result.draft.html).toContain("Ship with clarity.");
      expect(result.browserQa).toBe(candidateQa);
      expect(complete).toHaveBeenCalledTimes(2);
      expect(complete.mock.calls[0]?.[1]?.images).toHaveLength(1);
      expect(publisher).toHaveBeenCalledTimes(1);
      expect(publisher).toHaveBeenCalledWith(expect.any(String), candidateEvidence);
      expect(inspector.mock.calls[0]?.[2]).toMatchObject({
        captureGuide: false,
        captureVisualReview: true,
      });
      expect(inspector.mock.calls[1]?.[2]).toMatchObject({
        captureGuide: false,
        captureVisualReview: true,
        publishVisualReview: false,
      });
      expect(inspector.mock.invocationCallOrder[1])
        .toBeLessThan(publisher.mock.invocationCallOrder[0]!);
    } finally {
      inspector.mockImplementation(priorInspector!);
    }
  });

  it("rejects the repaired film when final evidence publication fails", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CREATIVE_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_VISION_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SKIP_CLEAN", "0");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SLOT_REPAIR", "0");
    const value = longDraft();
    const dir = projectDir();
    const baselineQa = {
      ...cleanQa(),
      visionCriticEvidence: evidence("publish-baseline", visionCriticDraftHash(dir, value)),
    };
    const deterministicCandidate = applyDeterministicSourceRepairs({
      storyboard: value.storyboard,
      html: value.html.replace("Ship with nerve.", "Ship with rollback."),
    }, dir, value.storyboard);
    const candidateQa = {
      ...cleanQa(),
      visionCriticEvidence: evidence(
        "publish-candidate",
        visionCriticDraftHash(dir, deterministicCandidate),
      ),
    };
    const inspector = vi.mocked(inspectDirectComposition);
    const priorInspector = inspector.getMockImplementation();
    inspector.mockClear();
    inspector.mockResolvedValueOnce(baselineQa).mockResolvedValueOnce(candidateQa);
    const publisher = vi.mocked(publishCanonicalVisionEvidence);
    publisher.mockReset();
    publisher.mockImplementationOnce(() => {
      throw new Error("simulated atomic publish failure");
    });
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        verdict: "repair",
        directives: ["Strengthen the final resolve."],
      }))
      .mockResolvedValueOnce(patchResponse("Ship with nerve.", "Ship with rollback."));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test critic",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    try {
      const result = await applyContinuityCritique(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: value.storyboard,
      }, {
        draft: value,
        raw: response(value),
        attempts: 1,
        browserQa: cleanQa(),
      });
      expect(result.draft).toBe(value);
      expect(result.browserQa).toBe(baselineQa);
      expect(result.draft.html).not.toContain("Ship with rollback.");
      expect(complete).toHaveBeenCalledTimes(2);
      expect(publisher).toHaveBeenCalledTimes(1);
    } finally {
      publisher.mockReset();
      inspector.mockImplementation(priorInspector!);
    }
  });

  it("applies the same unpublished-evidence transaction to a scene-scoped repair", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CREATIVE_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_VISION_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SKIP_CLEAN", "0");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SLOT_REPAIR", "1");
    const dir = projectDir();
    const storyboard = longDraft().storyboard;
    const initialSlots = extractSceneSlots([
      "<film_style>.critic-panel{width:1200px;padding:80px;color:#fff;background:#111}</film_style>",
      '<scene_html id="hook"><div class="critic-panel" data-layout-important ' +
        'data-layout-anchor="frame:center"><h1 class="hook-copy">Trace the impossible.</h1></div></scene_html>',
      '<scene_script id="hook">tl.fromTo(".hook-copy",{opacity:0,y:40},' +
        '{opacity:1,y:0,duration:.7},.2);</scene_script>',
      '<scene_html id="payoff"><div class="critic-panel" data-layout-important ' +
        'data-layout-anchor="frame:center"><h1 class="payoff-copy">Ship with nerve.</h1></div></scene_html>',
      '<scene_script id="payoff">tl.fromTo(".payoff-copy",{opacity:0,scale:.9},' +
        '{opacity:1,scale:1,duration:.7},4.2);</scene_script>',
    ].join("\n"));
    const compositionId = `${path.basename(dir).replace(/[^a-zA-Z0-9_-]/g, "-")}-slots`;
    const initialDraft = applyDeterministicSourceRepairs({
      storyboard,
      html: assembleSlotComposition({ storyboard, slots: initialSlots, compositionId }).html,
    }, dir, storyboard);
    const repairRaw = [
      '<scene_html id="payoff"><div class="critic-panel" data-layout-important ' +
        'data-layout-anchor="frame:center"><h1 class="payoff-copy">Ship with clarity.</h1></div></scene_html>',
      '<scene_script id="payoff">tl.fromTo(".payoff-copy",{opacity:0,scale:.88},' +
        '{opacity:1,scale:1,duration:.8},4.15);</scene_script>',
    ].join("\n");
    const repairedSlots = extractSceneSlots(repairRaw);
    const mergedSlots = {
      ...initialSlots,
      scenes: new Map(initialSlots.scenes),
      order: [...initialSlots.order],
    };
    mergedSlots.scenes.set("payoff", {
      ...mergedSlots.scenes.get("payoff"),
      ...repairedSlots.scenes.get("payoff"),
    });
    const deterministicCandidate = applyDeterministicSourceRepairs({
      storyboard,
      html: assembleSlotComposition({ storyboard, slots: mergedSlots, compositionId }).html,
    }, dir, storyboard);
    const baselineQa = {
      ...cleanQa(),
      visionCriticEvidence: evidence(
        "slot-baseline",
        visionCriticDraftHash(dir, initialDraft),
      ),
    };
    const candidateEvidence = evidence(
      "slot-candidate",
      visionCriticDraftHash(dir, deterministicCandidate),
    );
    const candidateQa = {
      ...cleanQa(),
      visionCriticEvidence: candidateEvidence,
    };
    const inspector = vi.mocked(inspectDirectComposition);
    const priorInspector = inspector.getMockImplementation();
    inspector.mockClear();
    inspector.mockResolvedValueOnce(baselineQa).mockResolvedValueOnce(candidateQa);
    const publisher = vi.mocked(publishCanonicalVisionEvidence);
    publisher.mockClear();
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        verdict: "repair",
        directives: ["payoff: strengthen the final value hierarchy."],
      }))
      .mockResolvedValueOnce(repairRaw);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "slot critic",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    try {
      const result = await applyContinuityCritique(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: storyboard,
      }, {
        draft: initialDraft,
        raw: "slot baseline",
        attempts: 1,
        browserQa: cleanQa(),
        slots: initialSlots,
      });
      expect(result.draft.html).toContain("Ship with clarity.");
      expect(result.browserQa).toBe(candidateQa);
      expect(result.slots?.scenes.get("payoff")?.html).toContain("Ship with clarity.");
      expect(complete).toHaveBeenCalledTimes(2);
      expect(inspector.mock.calls[1]?.[2]).toMatchObject({
        captureVisualReview: true,
        publishVisualReview: false,
      });
      expect(publisher).toHaveBeenCalledWith(dir, candidateEvidence);
    } finally {
      inspector.mockImplementation(priorInspector!);
    }
  });

  it("keeps the pre-critique draft when the enabled vision transport is unavailable", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CREATIVE_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_VISION_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SKIP_CLEAN", "0");
    const value = longDraft();
    const dir = projectDir();
    const visualQa = {
      ...cleanQa(),
      visionCriticEvidence: evidence("unsupported", visionCriticDraftHash(dir, value)),
    };
    const inspector = vi.mocked(inspectDirectComposition);
    const priorInspector = inspector.getMockImplementation();
    inspector.mockClear();
    inspector.mockResolvedValueOnce(visualQa);
    const complete = vi.fn();
    const provider: AgentProvider = {
      id: "antigravity-cli",
      label: "unsupported visual critic",
      kind: "cli",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    try {
      const before = {
        draft: value,
        raw: response(value),
        attempts: 1,
        browserQa: cleanQa(),
      };
      const result = await applyContinuityCritique(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: value.storyboard,
      }, before);
      expect(result.draft).toBe(before.draft);
      expect(result.browserQa).toBe(visualQa);
      expect(complete).not.toHaveBeenCalled();
    } finally {
      inspector.mockImplementation(priorInspector!);
    }
  });

  it("retains the legacy text critic when the independent vision switch is off", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CREATIVE_CRITIC", "1");
    vi.stubEnv("SLACK_SEQUENCES_VISION_CRITIC", "0");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SKIP_CLEAN", "0");
    vi.stubEnv("SLACK_SEQUENCES_CRITIC_SLOT_REPAIR", "0");
    const value = longDraft();
    const inspector = vi.mocked(inspectDirectComposition);
    const priorInspector = inspector.getMockImplementation();
    inspector.mockClear();
    inspector.mockResolvedValueOnce(cleanQa());
    const publisher = vi.mocked(publishCanonicalVisionEvidence);
    publisher.mockClear();
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        verdict: "repair",
        directives: ["Tighten the final resolve."],
      }))
      .mockResolvedValueOnce(patchResponse("Ship with nerve.", "Ship with confidence."));
    const provider: AgentProvider = {
      id: "antigravity-cli",
      label: "text-only critic",
      kind: "cli",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    try {
      const result = await applyContinuityCritique(provider, {
        brief: "Launch Relay",
        projectDir: projectDir(),
        skills: skills(),
        lockedStoryboard: value.storyboard,
      }, {
        draft: value,
        raw: response(value),
        attempts: 1,
        browserQa: cleanQa(),
      });
      expect(result.draft.html).toContain("Ship with confidence.");
      expect(complete).toHaveBeenCalledTimes(2);
      expect(complete.mock.calls[0]?.[1]?.images).toBeUndefined();
      expect(publisher).not.toHaveBeenCalled();
    } finally {
      inspector.mockImplementation(priorInspector!);
    }
  });
});

describe("correctSparseFraming (camera-sparse auto-framing, L2-at-L4)", () => {
  const proofRailHDir = path.resolve(
    import.meta.dirname,
    "../.data/projects/lp3-state-capsule-20260712-h",
  );
  const proofRailHQa = path.join(
    proofRailHDir,
    "qa-cache",
    "1f30d3b331f33c58baef3bd9c92da4b2.json",
  );
  const proofRailHAvailable =
    fs.existsSync(path.join(proofRailHDir, "planning", "storyboard.json")) &&
    fs.existsSync(proofRailHQa);
  const cameraScene = (
    id: string,
    region: string,
    move: "pan" | "drift" = "pan",
    zoom?: number,
  ): DirectScene => ({
    id,
    title: id,
    purpose: `land on ${region}`,
    startSec: 0,
    durationSec: 4,
    camera: {
      version: 1,
      path: [{
        version: 1,
        move,
        toRegion: region,
        startSec: 0.5,
        durationSec: 1.2,
        ...(zoom !== undefined ? { zoom } : {}),
      }],
    },
  });

  const sparseIssue = (
    sceneId: string,
    fraction: number,
    target: { region?: string; part?: string } = {},
  ): DirectLayoutIssue => ({
    code: "camera_framed_sparse",
    severity: "warning",
    time: 2,
    selector: target.part
      ? `[data-part="${target.part}"]`
      : target.region
        ? `[data-region="${target.region}"]`
        : `[data-scene="${sceneId}"]`,
    framing: { sceneId, fraction, ...target },
    message: `fills only ${Math.round(fraction * 100)}% of the frame`,
    source: "sequences",
  });

  const qa = (issues: DirectLayoutIssue[]): DirectBrowserQaResult => ({
    ok: true,
    strictOk: false,
    samples: [],
    issues,
    errors: [],
    warnings: [],
  });

  it("zooms the framing move to raise coverage back to the audit floor", () => {
    const storyboard = [cameraScene("lonely", "lonely")];
    const result = correctSparseFraming(
      storyboard,
      qa([sparseIssue("lonely", 0.1, { region: "lonely" })]),
    );
    expect(result.corrected).toEqual(["lonely"]);
    // sqrt(0.26/0.1) = 1.612..., with whole-cell headroom beyond the 17.5% grid floor.
    const zoom = result.storyboard[0]!.camera!.path[0]!.zoom!;
    expect(zoom).toBeCloseTo(1.612, 2);
    expect(zoom).toBeGreaterThan(1.05);
    expect(result.storyboard[0]!.camera!.path[0]!.framingCorrection).toBe("camera-sparse-zoom");
    // The input storyboard is never mutated in place.
    expect(storyboard[0]!.camera!.path[0]!.zoom).toBeUndefined();
  });

  it("tightens a declared station box before adding camera zoom (WS-A2)", () => {
    const scene: DirectScene = {
      ...cameraScene("compact", "metric-station"),
      worldLayout: [{ region: "metric-station", cell: [0, 0] }],
    };
    const result = correctSparseFraming(
      [scene],
      qa([sparseIssue("compact", 0.1, { region: "metric-station" })]),
    );
    expect(result.corrected).toEqual(["compact"]);
    expect(result.stationSized).toEqual(["compact/metric-station"]);
    expect(result.storyboard[0]!.worldLayout![0]!.fitScale).toBeCloseTo(0.62, 2);
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBeUndefined();
    expect(scene.worldLayout![0]!.fitScale).toBeUndefined();

    const styled = injectWorldLayoutStyles(draft().html, result.storyboard);
    expect(styled.html).toContain("width:868px !important;height:496px !important");
  });

  it("clamps the zoom factor at the camera contract ceiling for an extremely sparse landing", () => {
    const result = correctSparseFraming(
      [cameraScene("tiny", "tiny")],
      qa([sparseIssue("tiny", 0.02, { region: "tiny" })]),
    );
    // sqrt(0.26/0.02) > 3 -> clamped to the camera contract's 2.8 ceiling.
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBeCloseTo(2.8, 5);
  });

  it("zooms a wide footprint whose actual painted occupancy is sparse", () => {
    const issue = sparseIssue("scatter", 0.5, { region: "scatter" });
    issue.framing!.occupiedFraction = 0.01;
    const result = correctSparseFraming([cameraScene("scatter", "scatter")], qa([issue]));
    expect(result.corrected).toEqual(["scatter"]);
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBeGreaterThan(2.5);
  });

  it("adds a restrained focal push when a camera-less scene is sparse", () => {
    const staticScene: DirectScene = {
      id: "cold-open",
      title: "Cold open",
      purpose: "Introduce one search field",
      startSec: 0,
      durationSec: 4,
      spatialIntent: {
        version: 1,
        focalPart: "query",
        composition: "one centered search field",
        relationships: ["query is the only subject"],
      },
    };
    const result = correctSparseFraming(
      [staticScene],
      qa([sparseIssue("cold-open", 0.12)]),
    );
    expect(result.corrected).toEqual(["cold-open"]);
    expect(result.storyboard[0]!.camera!.path[0]).toMatchObject({
      move: "push-in",
      fromPart: "query",
      toPart: "query",
      startSec: 0,
      framingCorrection: "camera-sparse-zoom",
    });
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBeGreaterThan(1);
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBeLessThanOrEqual(1.08);
  });

  it("promotes a targeted drift to one bounded push for a sparse held framing", () => {
    const drift = cameraScene("drifter", "metric", "drift");
    drift.durationSec = 4;
    drift.camera!.path[0] = {
      ...drift.camera!.path[0]!,
      startSec: 0.5,
      durationSec: 3.5,
    };
    const result = correctSparseFraming(
      [drift],
      qa([sparseIssue("drifter", 0.08)]),
    );
    expect(result.corrected).toEqual(["drifter"]);
    expect(result.storyboard[0]!.camera!.path[0]).toMatchObject({
      move: "push-in",
      toRegion: "metric",
      startSec: 0.5,
      durationSec: 3.08,
      framingCorrection: "camera-sparse-zoom",
    });
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBeGreaterThan(1.5);
    expect(drift.camera!.path[0]!.move).toBe("drift");
  });

  it.runIf(proofRailHAvailable)(
    "replays the exact ProofRail H accepted plan and measured sparse result",
    () => {
      const storyboard = parseStoryboardResponse(fs.readFileSync(
        path.join(proofRailHDir, "planning", "storyboard.json"),
        "utf8",
      ));
      const browserQa = (JSON.parse(fs.readFileSync(
        proofRailHQa,
        "utf8",
      )) as { result: DirectBrowserQaResult }).result;
      const result = correctSparseFraming(storyboard, browserQa);

      expect(result.corrected).toEqual(["ring-open-51"]);
      expect(result.storyboard[0]!.components).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "readiness-ring", region: "readiness-ring-station" }),
        expect.objectContaining({ id: "readiness-rail", region: "readiness-ring-station" }),
      ]));
      expect(result.storyboard[0]!.camera!.path[1]).toMatchObject({
        move: "push-in",
        durationSec: 2.58,
        zoom: 1.558,
        framingCorrection: "camera-sparse-zoom",
      });
      expect(result.storyboard[2]!.camera!.path[1]).toMatchObject({
        move: "push-in",
        startSec: 8.1,
        durationSec: 2.28,
      });
    },
  );

  it("does not invent a sparse framing target without declared spatial intent", () => {
    const result = correctSparseFraming(
      [{ id: "unknown", title: "Unknown", purpose: "No focal", startSec: 0, durationSec: 4 }],
      qa([sparseIssue("unknown", 0.08)]),
    );
    expect(result.corrected).toEqual([]);
    expect(result.storyboard[0]!.camera).toBeUndefined();
  });

  it("bumps the last targeted full move for a scene-level [data-scene] finding", () => {
    const scene: DirectScene = {
      ...cameraScene("multi", "second"),
      camera: {
        version: 1,
        path: [
          { version: 1, move: "pan", toRegion: "first", startSec: 0.5, durationSec: 1 },
          { version: 1, move: "pan", toRegion: "second", startSec: 2, durationSec: 1 },
        ],
      },
    };
    const result = correctSparseFraming([scene], qa([sparseIssue("multi", 0.08)]));
    expect(result.corrected).toEqual(["multi"]);
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBeUndefined();
    expect(result.storyboard[0]!.camera!.path[1]!.zoom).toBeGreaterThan(1.05);
  });

  it("leaves untargeted drift/hold-only and camera-less scenes without a focal unchanged", () => {
    const drift = cameraScene("drifter", "adrift", "drift");
    delete drift.camera!.path[0]!.toRegion;
    const staticScene: DirectScene = {
      id: "static",
      title: "static",
      purpose: "no camera path at all",
      startSec: 0,
      durationSec: 3,
    };
    const result = correctSparseFraming(
      [drift, staticScene],
      qa([
        sparseIssue("drifter", 0.05, { region: "adrift" }),
        sparseIssue("static", 0.05),
      ]),
    );
    expect(result.corrected).toEqual([]);
    expect(result.storyboard[0]!.camera!.path[0]!.zoom).toBeUndefined();
  });

  it("ignores findings without measured framing metadata", () => {
    const issue = sparseIssue("lonely", 0.1, { region: "lonely" });
    delete (issue as { framing?: unknown }).framing;
    const result = correctSparseFraming([cameraScene("lonely", "lonely")], qa([issue]));
    expect(result.corrected).toEqual([]);
  });
});

describe("correctLayoutOverflow (browser-measured overflow repair)", () => {
  const rect = (
    left: number,
    top: number,
    width: number,
    height: number,
  ): NonNullable<DirectLayoutIssue["rect"]> => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  });

  const scene = (extra: Partial<DirectScene> = {}): DirectScene => ({
    id: "one",
    title: "One",
    purpose: "Open",
    startSec: 0,
    durationSec: 3,
    ...extra,
  });

  const qa = (issues: DirectLayoutIssue[]): DirectBrowserQaResult => ({
    ok: true,
    strictOk: false,
    samples: [1],
    issues,
    errors: [],
    warnings: [],
  });

  const overflowIssue = (overrides: Partial<DirectLayoutIssue> = {}): DirectLayoutIssue => ({
    code: "canvas_overflow",
    severity: "info",
    time: 1,
    selector: "#badge",
    repairSelector: "#badge",
    sceneId: "one",
    part: "badge",
    rect: rect(780, 100, 60, 30),
    containerRect: rect(0, 0, 800, 600),
    overflow: { right: 40 },
    message: "Text extends outside the composition canvas.",
    source: "hyperframes",
    ...overrides,
  });

  it("emits a bounded overflow clamp repair for a unique non-camera target", () => {
    const result = correctLayoutOverflow([scene()], qa([overflowIssue()]));
    expect(result.corrected).toEqual(["one"]);
    const repair = result.storyboard[0]!.layoutRepairs![0]!;
    expect(repair.kind).toBe("overflow-clamp");
    expect(repair.selector).toBe("#badge");
    expect(repair.issueCode).toBe("canvas_overflow");
    expect(repair.dx).toBeLessThan(0);
    expect(Math.abs(repair.dx)).toBeLessThanOrEqual(80);
    expect(repair.scale).toBe(1);
    expect(result.storyboard[0]!.sentinelNormalizations?.[0]).toContain("layout-overflow-clamp");
  });

  it("skips camera, cut, interaction, and focal addressed parts", () => {
    const storyboard = [scene({
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "pan",
          toPart: "badge",
          startSec: 0.4,
          durationSec: 1,
        }],
      },
    })];
    expect(addressedPartsForLayoutRepair(storyboard).has("one\u0000badge")).toBe(true);
    expect(correctLayoutOverflow(storyboard, qa([overflowIssue()])).corrected).toEqual([]);
  });

  it("skips repairs that require a composition-changing scale", () => {
    const result = correctLayoutOverflow(
      [scene()],
      qa([overflowIssue({
        rect: rect(-120, 80, 1100, 80),
        overflow: { left: 120, right: 180 },
      })]),
    );
    expect(result.corrected).toEqual([]);
  });

  it("injects exactly one idempotent layout repair style block", () => {
    const draftValue = draft();
    const storyboard: DirectScene[] = [{
      ...draftValue.storyboard[0]!,
      layoutRepairs: [{
        version: 1,
        id: "layout-hook-test",
        kind: "overflow-clamp",
        selector: "#hook-copy",
        issueCode: "canvas_overflow",
        dx: -24,
        dy: 0,
        scale: 0.96,
        origin: "center center",
        before: {
          rect: rect(1850, 120, 160, 48),
          safeRect: rect(8, 8, 1904, 1064),
        },
      }],
    }, draftValue.storyboard[1]!];
    const first = applyDeterministicSourceRepairs(
      {
        ...draftValue,
        storyboard,
        html: draftValue.html.replace(
          "</head>",
          '<style data-sequences-layout-repair>#old{translate:1px 1px}</style></head>',
        ),
      },
      projectDir(),
      storyboard,
    );
    const second = applyDeterministicSourceRepairs(first, projectDir(), storyboard);
    expect(second.html.match(/data-sequences-layout-repair/g)).toHaveLength(1);
    expect(second.html).toContain("#hook-copy{transform-origin:center center !important;");
    expect(second.html).toContain("translate:-24px 0px !important;");
    expect(second.html).toContain("scale:0.96 !important;");
    expect(second.html).not.toContain("#old");
  });

  it("ignores malformed host-only layout repair metadata instead of throwing", () => {
    const draftValue = draft();
    const storyboard: DirectScene[] = [{
      ...draftValue.storyboard[0]!,
      layoutRepairs: [{
        version: 1,
        id: "layout-bad-shape",
        kind: "overflow-clamp",
        selector: "#hook-copy",
        issueCode: "canvas_overflow",
        dx: -12,
        dy: 0,
        scale: 1,
        origin: "center center",
      } as unknown as NonNullable<DirectScene["layoutRepairs"]>[number]],
    }, draftValue.storyboard[1]!];
    const repaired = applyDeterministicSourceRepairs(
      { ...draftValue, storyboard },
      projectDir(),
      storyboard,
    );
    expect(repaired.html).not.toContain("data-sequences-layout-repair");
  });
});

describe("S6.10 typed load-bearing containment", () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  });
  const scene = (extra: Partial<DirectScene> = {}): DirectScene => ({
    id: "one",
    title: "One",
    purpose: "Show the primary result",
    startSec: 0,
    durationSec: 3,
    spatialIntent: {
      version: 1,
      focalPart: "hero",
      composition: "One primary result",
      relationships: ["hero owns the frame"],
    },
    ...extra,
  });
  const evidence = (overrides: Record<string, unknown> = {}) => ({
    sceneId: "one",
    part: "hero",
    detector: "primary-moment" as const,
    time: 1.5,
    found: true,
    opacity: 1,
    visibleFraction: 0.4,
    requiredVisibleFraction: 0.85,
    rect: rect(-180, 220, 300, 120),
    frameRect: rect(0, 0, 800, 600),
    safeRect: rect(60, 60, 680, 480),
    ...overrides,
  });
  const qa = (entries: ReturnType<typeof evidence>[], overrides: Partial<DirectBrowserQaResult> = {}): DirectBrowserQaResult => ({
    ok: true,
    strictOk: false,
    samples: [1.5],
    issues: [],
    loadBearingContainment: entries,
    errors: [],
    warnings: [],
    ...overrides,
  });

  it("emits one bounded idempotent repair for a measured off-frame primary", () => {
    const first = correctLoadBearingContainment([scene()], qa([evidence()]));
    expect(first.corrected).toHaveLength(1);
    const repair = first.storyboard[0]!.layoutRepairs![0]!;
    expect(repair.issueCode).toBe("load_bearing_containment");
    expect(repair.selector).toBe('[data-scene="one"] [data-part="hero"]');
    expect(repair.dx).toBeGreaterThan(0);
    expect(repair.dx).toBeLessThanOrEqual(320);
    expect(repair.scale).toBeGreaterThanOrEqual(0.65);
    const second = correctLoadBearingContainment(first.storyboard, qa([evidence()]));
    expect(second.storyboard).toEqual(first.storyboard);
  });

  it("leaves decorative/support content and ProofLane-visible occupancy preferences untouched", () => {
    const support = scene({
      spatialIntent: undefined,
      components: [{ version: 1, id: "hero", kind: "headline", role: "support" }],
    });
    expect(correctLoadBearingContainment([support], qa([evidence()])).corrected).toEqual([]);
    expect(correctLoadBearingContainment(
      [scene()],
      qa([evidence({
        detector: "camera-blocking",
        visibleFraction: 1,
        rect: rect(200, 220, 300, 120),
      })], {
        issues: [{
          code: "camera_blocking_landing",
          severity: "warning",
          time: 18.12,
          selector: '[data-part="hero"]',
          sceneId: "one",
          part: "hero",
          message:
            "ProofLane J: target is 100% visible at 12.2% occupancy; only the ensemble " +
            "station occupancy preference misses.",
          source: "sequences",
        }],
      }),
    ).corrected).toEqual([]);
  });

  it("adopts only strict visibility improvement with no new hard containment", () => {
    const fixed = correctLoadBearingContainment([scene()], qa([evidence()]));
    const target = fixed.corrected[0]!;
    expect(evaluateLoadBearingContainmentAdoption({
      before: qa([evidence()]),
      after: qa([evidence({ visibleFraction: 1, rect: rect(240, 220, 300, 120) })]),
      target,
    })).toMatchObject({ accepted: true, beforeVisibleFraction: 0.4, afterVisibleFraction: 1 });
    expect(evaluateLoadBearingContainmentAdoption({
      before: qa([evidence()]),
      after: qa([evidence({ visibleFraction: 0.7 })]),
      target,
    })).toMatchObject({ accepted: false, reason: "visibility-floor" });
    expect(evaluateLoadBearingContainmentAdoption({
      before: qa([evidence()]),
      after: qa([
        evidence({ visibleFraction: 1 }),
        evidence({ sceneId: "two", part: "other", visibleFraction: 0.2 }),
      ]),
      target,
    })).toMatchObject({ accepted: false, reason: "new-hard-containment" });
  });
});

describe("direct HyperFrames composition", () => {
  it("budgets one typed ghost word and injects its bounded host-owned moment idempotently", () => {
    const value = draft();
    const scenes = value.storyboard.map((scene, index): DirectScene => index === 0
      ? {
          ...scene,
          displayType: {
            version: 1,
            kind: "ghost-word",
            text: "SHIP IT",
            atSec: scene.startSec + 0.5,
            focalPart: "hero",
          },
        }
      : scene);
    expect(auditDisplayTypeBudget(scenes)).toEqual([]);
    const first = injectDisplayTypeMoments(value.html, scenes);
    expect(first.injected).toEqual([scenes[0]!.id]);
    expect(first.html).toContain('data-sequences-display-type="ghost-word"');
    expect(first.html).toContain('data-display-focal="hero"');
    expect(first.html).toContain("SHIP IT");
    expect(first.html).toContain(".fromTo(");
    expect(first.html).toContain("getBoundingClientRect()");
    expect(first.html).toContain("focalScale*.34");
    expect(first.html).not.toContain("clamp(92px,16vw,280px)");
    expect(injectDisplayTypeMoments(first.html, scenes).html).toBe(first.html);

    const duplicated = scenes.map((scene, index): DirectScene => index === 1
      ? {
          ...scene,
          displayType: {
            version: 1,
            kind: "ghost-word",
            text: "TOO MANY",
            atSec: scene.startSec + 0.5,
            focalPart: "proof",
          },
        }
      : scene);
    expect(auditDisplayTypeBudget(duplicated).join("\n")).toContain(
      "display_type_budget_exceeded",
    );
  });

  it("integrates one canonical host environment and stages only its selected wallpaper", () => {
    const dir = projectDir();
    const value = draft();
    process.env.SLACK_SEQUENCES_ENVIRONMENT = "1";
    try {
      const first = applyDeterministicSourceRepairs(value, dir, value.storyboard);
      expect(first.html).toContain('id="sequences-environment"');
      expect(first.html).toContain('id="sequences-environment-kit"');
      expect(first.html).toContain('src="sequences-environment.v1.js"');
      expect(first.html).toContain("SequencesEnvironment.compile(tl");
      expect(first.html.match(/data-sequences-environment=/g)).toHaveLength(
        value.storyboard.length,
      );
      const wallpaper = first.html.match(
        /src="(assets\/wallpapers\/[^"]+\.jpg)(?:\?seq-scene=[^"]+)?"/,
      )?.[1];
      expect(wallpaper).toBeTruthy();
      expect(fs.existsSync(path.join(dir, wallpaper!))).toBe(true);
      expect(fs.existsSync(path.join(dir, "assets", "wallpapers", "LICENSE"))).toBe(true);
      const second = applyDeterministicSourceRepairs(first, dir, value.storyboard);
      expect(second.html).toBe(first.html);
    } finally {
      process.env.SLACK_SEQUENCES_ENVIRONMENT = "0";
    }
  });

  it("parses the bounded author response contract", () => {
    const value = draft();
    expect(parseCompositionResponse(response(value))).toEqual(value);
  });

  it("accepts timeline registration through a statically bound composition id", async () => {
    const dir = projectDir();
    const value = draft();
    value.html = value.html.replace(
      'window.__timelines["relay-launch"] = tl;',
      'const compId = "relay-launch"; window.__timelines[compId] = tl;',
    );
    const validation = await validateDirectComposition(dir, value);
    expect(validation.errors).toEqual([]);
  });

  it("publishes a front-loaded Luna scene with the full liveness finding as an advisory", async () => {
    const dir = projectDir();
    const fallback = buildFallbackComposition({
      product: "Relay",
      whatShipped: "Incident routing",
      audience: "operators",
      lengthSec: 15,
    });
    fallback.storyboard = fallback.storyboard.map((scene) => {
      const { moments: _moments, ...withoutMoments } = scene;
      return withoutMoments;
    });
    fallback.html = fallback.html
      .replace(
        /(<script type="application\/json" id="sequences-camera">)[\s\S]*?(<\/script>)/,
        `$1${JSON.stringify(resolveCameraPlan(fallback.storyboard))}$2`,
      )
      .replace(/^tl\.fromTo\("#close-rule".*\r?\n/m, "")
      .replace(/^tl\.fromTo\("#fallback-close \.cta".*\r?\n/m, "")
      .replace(/^tl\.fromTo\("#close-promise".*\r?\n/m, "");
    fallback.declaredPrimarySelectors = {
      "fallback-hook": '[data-part="release-headline"]',
      "fallback-proof": '[data-part="release-proof"]',
      "fallback-close": '[data-part="release-cta"]',
    };

    const luna = await validateDirectComposition(dir, fallback);
    expect(luna.errors).toEqual([]);
    expect(luna.motionErrors).toEqual([]);
    expect(luna.warnings.join("\n")).toContain(
      'motion/liveness: scene "fallback-close" front-loads its authored motion',
    );
    expect(luna.motionWarnings.join("\n")).toContain("front-loads its authored motion");
    const published = await commitDirectComposition(dir, "Relay", fallback);
    expect(published.validation.errors).toEqual([]);
    expect(published.manifest.qa?.warningCount).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(dir, "composition", "motion-plan.json"), "utf8"))
      .toContain("front-loads its authored motion");

    const legacy = await validateDirectComposition(dir, {
      html: fallback.html,
      storyboard: fallback.storyboard,
    });
    expect(legacy.errors.join("\n")).toContain("front-loads its authored motion");
  });

  it("uses data-scene as the storyboard binding when the stable DOM id differs", async () => {
    const dir = projectDir();
    const value = draft();
    value.html = value.html
      .replace('id="hook"', 'id="scene-hook"')
      .replace('id="payoff"', 'id="scene-payoff"');
    const validation = await validateDirectComposition(dir, value);
    expect(validation.errors).toEqual([]);
  });

  it("rejects one-hop dead GSAP query dataflow in L3 before browser QA", async () => {
    const dir = projectDir();
    const value = draft();
    value.html = value.html.replace(
      "    window.__timelines[\"relay-launch\"] = tl;",
      "    const ghost = document.querySelector('.cmp-value::after');\n" +
        "    tl.to(ghost, { opacity: 1 }, 2);\n" +
        "    window.__timelines[\"relay-launch\"] = tl;",
    );
    const validation = await validateDirectComposition(dir, value);
    expect(validation.ok).toBe(false);
    expect(validation.errors.some((error) => error.startsWith("dead_gsap_target:"))).toBe(true);
    expect(validation.errors.join("\n")).toContain(".cmp-value::after");
  });

  it("normalizes model-authored display/visibility tweens before static validation", async () => {
    const dir = projectDir();
    const value = draft();
    value.html = value.html
      .replace(
        'tl.set("#hook", { opacity: 1 }, 0);',
        'tl.set("#hook", { display: "grid", visibility: "visible" }, 0);',
      )
      .replace(
        'tl.set("#hook", { opacity: 0 }, 3.99);',
        'tl.set("#hook", { display: "none" }, 3.99);',
      )
      .replace(
        'tl.fromTo("#payoff-title", { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, ease: "back.out(1.6)" }, 4.2);',
        'tl.fromTo("#payoff-title", { scale: 0.82, visibility: "hidden" }, { scale: 1, visibility: "visible", duration: 0.7, ease: "back.out(1.6)" }, 4.2);',
      );
    const complete = vi.fn().mockResolvedValue(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });

    expect(result.attempts).toBe(1);
    expect(result.draft.html).toContain('tl.set("#hook", { opacity: 1 }, 0);');
    expect(result.draft.html).toContain('tl.set("#hook", { opacity: 0 }, 3.99);');
    expect(result.draft.html).toContain(
      'tl.fromTo("#payoff-title", { opacity: 0, scale: 0.82 }, { opacity: 1, scale: 1, duration: 0.7, ease: "back.out(1.6)" }, 4.2);',
    );
    expect(result.draft.html).not.toMatch(
      /(?:\.(?:to|from|fromTo|set)|gsap\.(?:to|from|fromTo|set))\s*\([^;]{0,1000}\b(?:display|visibility)\s*:/is,
    );
  });

  it("last-resort salvage demotes an unbound primary moment instead of failing loud", async () => {
    // The sentinel-p6-longcopy death class: every rung exhausts while the only
    // static blocker is a declared PRIMARY moment the author never delivered
    // evidence for. The pre-throw salvage demotes exactly that moment to
    // supporting (it then drops with a warning at binding) and ships the
    // runnable, browser-clean draft instead of no film.
    const dir = projectDir();
    const value = draft();
    value.storyboard[0]!.moments = [{
      version: 1,
      id: "hairline-grow",
      sceneId: "hook",
      atSec: 2.0,
      title: "Terracotta hairline grows",
      visualState: "hairline visible",
      change: "a hairline grows across the panel",
      motionIntent: "draw-on",
      importance: "primary",
    }];
    const complete = vi.fn().mockResolvedValue(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });
    expect(result.attempts).toBe(4);
    const shipped = result.draft.storyboard[0]!.moments!.find(
      (entry) => entry.id === "hairline-grow",
    );
    expect(shipped?.importance).toBe("supporting");
  });

  it("deduplicates declared component data-part bindings before validation", async () => {
    const dir = projectDir();
    const value = draft();
    value.storyboard[1]!.components = [{
      version: 1,
      id: "error-chart-card",
      kind: "chart-line",
      region: "chart-zone",
      role: "hero",
    }];
    value.storyboard[1]!.beats = [{
      version: 1,
      id: "error-chart-draw",
      sceneId: "payoff",
      component: "error-chart-card",
      kind: "chart",
      atSec: 4.5,
      durationSec: 1,
    }];
    value.html = value.html.replace(
      '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">Rollback in one click.</h1><p>Ship with nerve.</p></div>',
      '<div class="panel cmp cmp-chart-line" data-component="chart-line" data-part="error-chart-card" data-layout-important data-layout-anchor="frame:center">' +
        '<svg><path data-part="error-chart-card"></path><circle data-part="error-chart-card"></circle></svg>' +
        '<h1 id="payoff-title">Rollback in one click.</h1><p>Ship with nerve.</p></div>',
    );
    const complete = vi.fn().mockResolvedValue(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });

    const scene = result.draft.html.match(
      /<section[^>]*data-scene="payoff"[\s\S]*?<\/section>/,
    )?.[0] ?? "";
    expect(scene.match(/data-part="error-chart-card"/g)).toHaveLength(1);
    expect(scene).toContain('data-part="error-chart-card-aux-1"');
    expect(scene).toContain('data-part="error-chart-card-aux-2"');
    expect(scene).toContain('data-region="chart-zone"');
    expect(result.attempts).toBe(1);
  });

  it("spends one rescue attempt on an independent model before failing the run", async () => {
    vi.stubEnv("SLACK_SEQUENCES_SOURCE_RESCUE_MODEL", "tencent/hy3-preview");
    const dir = projectDir();
    const value = draft();
    const garbage =
      "<index_html><!DOCTYPE html><html><body><div>not a composition</div></body></html></index_html>";
    const complete = vi.fn()
      .mockResolvedValueOnce(garbage)
      .mockResolvedValueOnce(garbage)
      .mockResolvedValueOnce(garbage)
      .mockResolvedValueOnce(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });

    expect(result.attempts).toBe(4);
    expect(complete).toHaveBeenCalledTimes(4);
    expect(complete.mock.calls[3]![1]?.model).toBe("tencent/hy3-preview");
    const summary = JSON.parse(
      fs.readFileSync(path.join(dir, "planning", "author-run.json"), "utf8"),
    );
    expect(summary.strategyChanges).toContain("source-rescue:tencent/hy3-preview");
    expect(summary.outcome).toBe("published");
  });

  it("never spends the final attempt on a compact patch without a banked draft", async () => {
    const dir = projectDir();
    const value = draft();
    const rejectedQa = {
      ok: false,
      strictOk: false,
      samples: [0, 2, 4],
      issues: [],
      errors: ["layout_error: promised content never framed"],
      warnings: [],
    };
    vi.mocked(inspectDirectComposition)
      .mockResolvedValueOnce(rejectedQa as never)
      .mockResolvedValueOnce(rejectedQa as never);
    const complete = vi.fn()
      .mockResolvedValueOnce(response(value))
      .mockResolvedValueOnce(patchResponse("Ship with nerve.", "Ship with verve."))
      .mockResolvedValueOnce(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });

    expect(result.attempts).toBe(3);
    expect(complete).toHaveBeenCalledTimes(3);
    // Attempt 2 was the mid-ladder patch; the final attempt must be a
    // full-context re-author because no runtime-valid draft was banked.
    expect(complete.mock.calls[1]![0]).toContain("patches");
    expect(complete.mock.calls[2]![0]).not.toContain("patches_json");
    const summary = JSON.parse(
      fs.readFileSync(path.join(dir, "planning", "author-run.json"), "utf8"),
    );
    expect(summary.strategyChanges).toContain("full-reauthor-final-attempt");
  });

  it("reports a truncated response as a token-limit problem, not a missing tag", () => {
    const value = draft();
    // The model opened the first tag but ran out of output budget before closing it.
    const truncated = `<storyboard_json>${JSON.stringify(value.storyboard)}`;
    expect(() => parseCompositionResponse(truncated)).toThrow(/truncated/i);
    expect(() => parseCompositionResponse(truncated)).toThrow(/token limit/i);
  });

  it("still reports a genuinely absent tag as missing", () => {
    expect(() => parseCompositionResponse("no tags here at all")).toThrow(/missing <storyboard_json>/);
  });

  it("recovers a bare HTML document when the index_html wrapper is dropped", () => {
    const value = draft();
    // After compact repairs the author often returns the document with no wrapper.
    const raw = `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>\n${value.html}`;
    expect(parseCompositionResponse(raw)).toEqual(value);
  });

  it("recovers a ```html-fenced bare HTML document", () => {
    const value = draft();
    const raw =
      `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>\n` +
      "```html\n" + value.html + "\n```";
    expect(parseCompositionResponse(raw).html).toBe(value.html);
  });

  it("reports an unclosed index_html wrapper as truncation, not bare recovery", () => {
    const value = draft();
    const raw =
      `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>\n` +
      `<index_html>${value.html.slice(0, 200)}`;
    expect(() => parseCompositionResponse(raw)).toThrow(/truncated/i);
  });

  it("reports a genuinely absent HTML document as missing index_html", () => {
    const value = draft();
    const raw = `<storyboard_json>${JSON.stringify(value.storyboard)}</storyboard_json>\nno html here`;
    expect(() => parseCompositionResponse(raw)).toThrow(/missing <index_html>/);
  });

  it("validates a storyboard-first cut graph before source authoring", () => {
    const plan = storyboard();
    const parsed = parseStoryboardResponse(
      `<storyboard_json>${JSON.stringify(plan)}</storyboard_json>`,
    );
    expect(parsed).toEqual(plan);
    expect(() => parseStoryboardResponse(
      `<storyboard_json>${JSON.stringify(plan.slice(0, 2))}</storyboard_json>`,
    )).toThrow(/3-10 distinct shots/);
  });

  it("turns explicit component/camera direction into blocking plan coverage", () => {
    const requirements = inferStoryboardPlanRequirements(
      "Use one large spatial UI world with camera pushes and pans, object-match cuts, " +
        "and component beats for search, command palette, table, stat card, terminal, " +
        "toast, progress, and chart.",
      18,
    );
    expect(requirements).toMatchObject({
      targetDurationSec: 18,
      minRequestedComponentKinds: 6,
      minComponentBeats: 8,
      minCameraMoves: 2,
      requireMultiStationWorld: true,
      requireObjectMatch: true,
    });
    expect(requirements.requestedComponentKinds).toHaveLength(8);
    expect(() =>
      parseStoryboardResponse(JSON.stringify(storyboard()), requirements)
    ).toThrow(/motion-native product components/);
    expect(() =>
      parseStoryboardResponse(JSON.stringify(storyboard()), requirements)
    ).toThrow(/spatial camera choreography/);
  });

  it("never demands more component kinds than the brief names", () => {
    const requirements = inferStoryboardPlanRequirements(
      "Show motion-native components: the search bar morphs into a command " +
        "palette, plus a stat card with the key metric.",
      16,
    );
    expect(requirements.requestedComponentKinds).toHaveLength(3);
    // The floor is capped at the requested count so the brief stays satisfiable.
    expect(requirements.minRequestedComponentKinds).toBe(3);
  });

  it("preserves explicit camera count, orbit, and shared-element demands", () => {
    const requirements = inferStoryboardPlanRequirements(
      "Use at least five purposeful full camera moves, one true orbit or orbit-lite peak, " +
        "and a genuine shared-element morph or match.",
      32,
    );
    expect(requirements).toMatchObject({
      minCameraMoves: 5,
      requireOrbit: true,
      requireSharedElementCut: true,
    });
    const plan = storyboard();
    expect(() => parseStoryboardResponse(JSON.stringify(plan), requirements))
      .toThrow(/5 FULL typed camera moves/);
  });

  it("keeps typed boundary cuts and canonicalizes legacy names before source authoring", () => {
    const plan = storyboard();
    plan[0]!.cut = { version: 1, style: "cut-left", travelPx: 9999 };
    plan[1]!.cut = {
      version: 1,
      style: "object-match",
      focalPartOut: "the-action-button",
      // focalPartIn missing → the hard-form match promise (QA enforces the
      // tightened eye-trace budget); it resolves to no runtime bridge.
    };
    plan[2]!.cut = { version: 1, style: "hard" };
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    expect(parsed[0]?.cut).toEqual({ version: 1, style: "swipe", axis: "left", travelPx: 420 });
    expect(parsed[1]?.cut).toEqual({
      version: 1,
      style: "match",
      focalPartOut: "the-action-button",
    });
    expect(parsed[2]?.cut).toEqual({ version: 1, style: "hard" });
  });

  it("recovers a planner ripple omission before source authoring", () => {
    const plan = storyboard();
    plan[1]!.interactions = [{
      version: 1,
      id: "product-click",
      sceneId: plan[1]!.id,
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click",
      startSec: 3.2,
      arriveSec: 3.5,
      pressSec: 3.6,
      releaseSec: 3.75,
      from: "frame:bottom-right",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press-ripple",
    }];
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    expect(parsed[1]?.interactions?.[0]?.ripplePart).toBe("primary-action-ripple");
  });

  it("makes duplicate planner interaction ids unique before source authoring", () => {
    const plan = storyboard();
    const shared = {
      version: 1 as const,
      id: "shared-click",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click" as const,
      startSec: 3.2,
      arriveSec: 3.5,
      pressSec: 3.6,
      releaseSec: 3.75,
      from: "frame:bottom-right" as const,
      path: "human" as const,
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press" as const,
    };
    plan[1]!.interactions = [{ ...shared, sceneId: plan[1]!.id }];
    plan[2]!.interactions = [{
      ...shared,
      sceneId: plan[2]!.id,
      startSec: 6.2,
      arriveSec: 6.5,
      pressSec: 6.6,
      releaseSec: 6.75,
    }];
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    expect(parsed[1]?.interactions?.[0]?.id).toBe("shared-click");
    expect(parsed[2]?.interactions?.[0]?.id).toBe("shared-click-2");
  });

  it("normalizes out-of-order planner interaction timing inside its scene", () => {
    const plan = storyboard();
    plan[1]!.spatialIntent = {
      version: 1,
      focalPart: "the 'Get Live View' CTA button",
      composition: "CTA-led product proof",
      relationships: [],
    };
    plan[1]!.interactions = [{
      version: 1,
      id: "bad-timing-click",
      sceneId: "wrong-scene",
      cursorId: "pointer",
      targetPart: "the 'Get Live View' CTA button",
      action: "click",
      startSec: 3.2,
      arriveSec: 4.4,
      pressSec: 4.1,
      releaseSec: 3.9,
      holdUntilSec: 99,
      from: "nowhere" as never,
      path: "custom",
      aimX: 4,
      aimY: -2,
      feedback: "press-ripple",
      ripplePart: "the CTA button surface",
    }];
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    const interaction = parsed[1]?.interactions?.[0];
    expect(interaction).toBeDefined();
    expect(parsed[1]?.spatialIntent?.focalPart).toBe(
      "the-get-live-view-cta-button",
    );
    expect(interaction?.sceneId).toBe("product-proof");
    expect(interaction?.targetPart).toBe("the-get-live-view-cta-button");
    expect(interaction?.from).toBe("frame:bottom-right");
    expect(interaction?.path).toBe("human");
    expect(interaction?.aimX).toBe(0.85);
    expect(interaction?.aimY).toBe(0.15);
    expect(interaction?.arriveSec).toBeGreaterThan(interaction!.startSec);
    expect(interaction?.pressSec).toBeGreaterThanOrEqual(interaction!.arriveSec + 0.08);
    expect(interaction?.releaseSec).toBeGreaterThan(interaction!.pressSec!);
    expect(interaction?.holdUntilSec).toBeLessThanOrEqual(6);
    expect(interaction?.ripplePart).toBe("the-get-live-view-cta-button-ripple");
  });

  it("drops unusable optional planner metadata instead of failing the video", () => {
    const plan = storyboard();
    plan[1]!.spatialIntent = {
      version: 1,
      focalPart: "",
      composition: "",
      relationships: [],
    };
    plan[1]!.interactions = [{
      version: 1,
      id: "missing-target",
      sceneId: plan[1]!.id,
      cursorId: "pointer",
      targetPart: "",
      action: "click",
      startSec: 3.2,
      arriveSec: 3.5,
      pressSec: 3.6,
      releaseSec: 3.8,
      from: "frame:center",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press",
    }];
    const parsed = parseStoryboardResponse(JSON.stringify(plan));
    expect(parsed[1]?.spatialIntent).toBeUndefined();
    expect(parsed[1]?.interactions).toBeUndefined();
  });

  it("recovers a bare or fenced storyboard array when the model omits the wrapper", () => {
    const plan = storyboard();
    // Flash-tier planners routinely ignore the <storyboard_json> wrapper.
    expect(parseStoryboardResponse(JSON.stringify(plan))).toEqual(plan);
    expect(
      parseStoryboardResponse("Here is the plan:\n```json\n" + JSON.stringify(plan) + "\n```"),
    ).toEqual(plan);
  });

  it("parses a provider-native structured storyboard object", () => {
    const plan = storyboard();
    expect(parseStoryboardResponse(JSON.stringify({ storyboard: plan }))).toEqual(plan);
  });

  it("accepts a plan whose moment gaps are provable from its own typed evidence", () => {
    // The 2026-07-04 live fallback root cause: GLM plans with rich typed
    // beats/camera kept getting vetoed on marginal moment-spacing gaps the
    // plan itself could prove. The host now fills that paperwork instead of
    // burning retries on it.
    const moment = (sceneId: string, id: string, atSec: number) => ({
      version: 1 as const,
      id,
      sceneId,
      atSec,
      title: `Moment ${id}`,
      visualState: `state ${id}`,
      change: `change ${id}`,
      motionIntent: "reveal",
      importance: "supporting" as const,
    });
    const plan = [
      {
        id: "signal",
        title: "Signal",
        purpose: "Expose the problem",
        incomingIdea: "Noise arrives",
        foreground: "Split headline over a trace rail",
        background: "Dark grid",
        cameraIntent: "Locked wide",
        continuityAnchor: "The trace exits right",
        outgoingCut: "Zoom through the trace into the product",
        startSec: 0,
        durationSec: 5,
        cut: { version: 1, style: "zoom-through" },
        components: [{ version: 1, id: "sig-stat", kind: "stat-card" }],
        beats: [{
          version: 1,
          id: "sig-count",
          sceneId: "signal",
          component: "sig-stat",
          kind: "count",
          atSec: 4,
        }],
        moments: [moment("signal", "signal-m1", 0.3), moment("signal", "signal-m2", 2.0)],
      },
      {
        id: "proof",
        title: "Proof",
        purpose: "Show the product",
        incomingIdea: "The trace becomes a route",
        foreground: "Product window",
        background: "Technical grid",
        cameraIntent: "Pan across the metric wall",
        continuityAnchor: "The route lands in the window",
        outgoingCut: "Hard cut to the close",
        startSec: 5,
        durationSec: 5,
        cut: { version: 1, style: "hard" },
        camera: {
          version: 1,
          path: [{
            version: 1,
            move: "pan",
            toRegion: "metric-wall",
            startSec: 7.8,
            durationSec: 1.2,
          }],
        },
        moments: [moment("proof", "proof-m1", 5.3), moment("proof", "proof-m2", 7.0)],
      },
      {
        id: "close",
        title: "Close",
        purpose: "Resolve the promise",
        incomingIdea: "The route becomes the brand",
        foreground: "Logo lockup",
        background: "Quiet field",
        cameraIntent: "Settle into a held wide",
        continuityAnchor: "The lockup holds",
        outgoingCut: "End on a held frame",
        startSec: 10,
        durationSec: 5,
        moments: [moment("close", "close-m1", 10.3), moment("close", "close-m2", 12.0)],
      },
    ];
    const parsed = parseStoryboardResponse(JSON.stringify({ storyboard: plan }));
    const moments = parsed.flatMap((scene) => scene.moments ?? []);
    // Declared moments alone leave two >2.6s dead intervals; the typed beat
    // (4.0s) and camera arrival (9.0s) fill them deterministically.
    expect(moments.map((entry) => entry.id)).toContain("signal-auto-1");
    expect(moments.map((entry) => entry.id)).toContain("proof-auto-1");
    expect(moments).toHaveLength(8);
  });

  it("drops unknown optional capability citations instead of aborting the film", () => {
    const plan = storyboard();
    plan[0]!.capabilityIds = ["dashboard"];
    const parsed = parseStoryboardResponse(JSON.stringify({ storyboard: plan }));
    expect(parsed[0]?.capabilityIds).toEqual([]);
  });

  it("reports an unclosed storyboard tag as truncation, not a missing wrapper", () => {
    const plan = storyboard();
    expect(() => parseStoryboardResponse(`<storyboard_json>${JSON.stringify(plan)}`)).toThrow(
      /truncated/i,
    );
  });

  it("still reports a genuinely absent storyboard as missing", () => {
    expect(() => parseStoryboardResponse("no array anywhere in this prose")).toThrow(
      /missing <storyboard_json>/,
    );
  });

  it("runs the bounded concept pass before the storyboard and feeds its artifact in", async () => {
    const dir = projectDir();
    const concept = {
      thesis: "One trace becomes one route",
      narrativePressure: "Noise until the product resolves it",
      energyCurve: "staccato open → build → warm resolve",
      motif: "the violet trace rail",
      colorArc: "cold → neutral → warm",
      creativeRisk: "held stillness before the close",
    };
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(concept))
      .mockResolvedValueOnce(`<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(complete).toHaveBeenCalledTimes(2);
    const conceptOptions = complete.mock.calls[0]?.[1] as {
      thinkingMode?: string;
      model?: string;
      responseFormat?: { json_schema?: { name?: string } };
    };
    expect(conceptOptions).toMatchObject({
      thinkingMode: "high",
      model: "z-ai/glm-5.2",
    });
    expect(conceptOptions.responseFormat?.json_schema?.name).toBe("sequences_concept");
    const storyboardPrompt = complete.mock.calls[1]?.[0] as string;
    expect(storyboardPrompt).toContain("<concept_json>");
    expect(storyboardPrompt).toContain("the violet trace rail");
    // The concept artifact is cached independently for retryable stages.
    expect(fs.existsSync(path.join(dir, "planning", "concept.json"))).toBe(true);
  });

  it("routes storyboard expansion to reasoning-enabled GLM 5.2 at medium effort", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue(
      `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`,
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    const options = complete.mock.calls[0]?.[1] as {
      maxTokens?: number;
      thinkingMode?: string;
      model?: string;
      responseFormat?: { type?: string; json_schema?: { name?: string } };
    };
    expect(options).toMatchObject({
      maxTokens: 30_720,
      thinkingMode: "medium",
      model: "z-ai/glm-5.2",
    });
    expect(options.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: { name: "sequences_storyboard" },
    });
  });

  it("streams the reasoning storyboard so long GLM thinking does not look idle", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn(async () => {
      throw new Error("non-streaming transport should not be used");
    });
    const streamComplete = vi.fn(async () =>
      JSON.stringify({ storyboard: storyboard() })
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "streaming planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
      streamComplete,
    };
    await expect(requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    })).resolves.toEqual(storyboard());
    expect(complete).not.toHaveBeenCalled();
    expect(streamComplete).toHaveBeenCalledTimes(1);
    const streamOptions = (streamComplete.mock.calls as unknown[][])[0]?.[1];
    expect(streamOptions).toMatchObject({
      model: "z-ai/glm-5.2",
      thinkingMode: "medium",
      maxTokens: 30_720,
    });
  });

  it("uses a separate storyboard model only when the operator explicitly configures one", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_STORYBOARD_MODEL", "operator/structured-planner");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue(
      `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`,
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      model: "operator/structured-planner",
      maxTokens: 6_144,
      thinkingMode: "none",
    });
  });

  it("lets operators keep the primary authoring model for storyboard work", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_STORYBOARD_MODEL", "primary");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue(
      `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`,
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      maxTokens: 6_144,
      thinkingMode: "none",
    });
    expect((complete.mock.calls[0]?.[1] as { model?: string }).model).toBeUndefined();
  });

  it("retries the storyboard pass through a transient provider timeout", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const complete = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(`<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const plan = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(plan).toEqual(storyboard());
  });

  it("retries an empty streamed completion from the provider", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const streamComplete = vi.fn()
      .mockRejectedValueOnce(new Error("OpenRouter returned an empty completion"))
      .mockResolvedValueOnce(JSON.stringify({ storyboard: storyboard() }));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete: vi.fn(),
      streamComplete,
    };
    const plan = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(streamComplete).toHaveBeenCalledTimes(2);
    expect(plan).toEqual(storyboard());
  });

  it("recovers a truncated reasoning storyboard by shrinking the ARTIFACT, not the reasoning", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn()
      .mockRejectedValueOnce(
        new ProviderOutputTruncatedError("OpenRouter", 30_720, '{"storyboard":['),
      )
      .mockResolvedValueOnce(JSON.stringify({ storyboard: storyboard() }));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const plan = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(plan).toEqual(storyboard());
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[1]).toMatchObject({
      maxTokens: 30_720,
      thinkingMode: "medium",
    });
    // Reasoning-stripped recovery produced structurally broken plans in 3 of
    // 4 benched runs (improve-ws32-1 died on it live): the retry keeps the
    // configured reasoning and full budget, and the prompt demands a smaller
    // artifact instead.
    expect(complete.mock.calls[1]?.[1]).toMatchObject({
      maxTokens: 30_720,
      thinkingMode: "medium",
    });
    expect(complete.mock.calls[1]?.[0]).toContain("exhausted its output budget");
    expect(complete.mock.calls[1]?.[0]).toContain("compact single-line JSON");
  });

  it("upgrades a valid cached partial worldLayout without another paid planner call", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const raw = storyboard().map((scene, index) => index === 1
      ? {
          ...scene,
          spatialIntent: {
            version: 1 as const,
            focalPart: "terminal-surface",
            composition: "Terminal-led product proof",
            relationships: ["metrics update inside the terminal framing"],
          },
          camera: {
            version: 1 as const,
            path: [
              {
                version: 1 as const,
                move: "pan" as const,
                toPart: "terminal-surface",
                startSec: 3.2,
                durationSec: 0.8,
              },
            ],
          },
          components: [
            {
              version: 1 as const,
              id: "terminal-surface",
              kind: "terminal" as const,
              region: "terminal-strip",
            },
            {
              version: 1 as const,
              id: "metric-surface",
              kind: "stat-card" as const,
              region: "metric-wall",
            },
          ],
          worldLayout: [{ region: "metric-wall", cell: [0, 0] as [number, number] }],
        }
      : scene);
    const complete = vi.fn().mockResolvedValue(
      `<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`,
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const args = {
      brief: "Launch cached world map",
      projectDir: dir,
      skills: skills(),
    };
    const first = await requestStoryboardPlan(provider, args);
    expect(first[1]!.worldLayout).toEqual([
      { region: "metric-wall", cell: [0, 0] },
      { region: "terminal-strip", cell: [1, 0] },
    ]);

    // Simulate a paid v22 artifact written before partial-map completion was
    // added. Keep its key and every other normalized field intact.
    const cacheFile = path.join(dir, "planning", "storyboard.json");
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as {
      storyboard: DirectScene[];
      [key: string]: unknown;
    };
    cached.storyboard = cached.storyboard.map((scene) => scene.id === "product-proof"
      ? { ...scene, worldLayout: [{ region: "metric-wall", cell: [0, 0] }] }
      : scene);
    fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2) + "\n", "utf8");

    const replayed = await requestStoryboardPlan(provider, args);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(replayed[1]!.worldLayout).toEqual([
      { region: "metric-wall", cell: [0, 0] },
      { region: "terminal-strip", cell: [1, 0] },
    ]);
    const upgraded = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as {
      storyboard: DirectScene[];
    };
    expect(upgraded.storyboard[1]!.worldLayout).toEqual(replayed[1]!.worldLayout);
  });

  it("reclaims an exact-contract rejected artifact without another paid planner call", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue(
      `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`,
    );
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const args = { brief: "Launch recovered plan", projectDir: dir, skills: skills() };
    const first = await requestStoryboardPlan(provider, args);
    const cacheFile = path.join(dir, "planning", "storyboard.json");
    const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as {
      key: string;
      storyboard: DirectScene[];
    };
    fs.rmSync(cacheFile);
    const attemptsDir = path.join(dir, "planning", "attempts");
    fs.mkdirSync(attemptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(attemptsDir, "storyboard-5-rejected.raw.txt"),
      `<storyboard_json>${JSON.stringify(cached.storyboard)}</storyboard_json>`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(attemptsDir, "storyboard-5-rejected.json"),
      JSON.stringify({ attempt: 5, outcome: "rejected", rung: "rescue", key: cached.key }),
      "utf8",
    );

    const recovered = await requestStoryboardPlan(provider, args);
    expect(recovered).toEqual(first);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(cacheFile)).toBe(true);
  });

  it("reuses an already-paid storyboard across job ids via the shared planning cache", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_SHARED_PLANNING_CACHE", "1");
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "sequences-shared-cache-"));
    roots.push(base);
    const jobDir = (id: string) => {
      const dir = path.join(base, "projects", id);
      fs.mkdirSync(dir, { recursive: true });
      initializeProject(dir, { name: "Relay", brandName: "Relay", seedScreenshot: true });
      return dir;
    };
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ storyboard: storyboard() }));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const first = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: jobDir("job-1"),
      skills: skills(),
    });
    // A fresh job id after a source-author failure must not re-pay the plan.
    const second = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: jobDir("job-2"),
      skills: skills(),
    });
    expect(second).toEqual(first);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(base, "planning-cache"))).toBe(true);
    // The retry's own job dir still documents the plan it built against.
    expect(fs.existsSync(path.join(base, "projects", "job-2", "planning", "storyboard.json")))
      .toBe(true);
  });

  it("retries an upstream idle timeout inside the same source attempt", async () => {
    const dir = projectDir();
    const complete = vi.fn()
      .mockRejectedValueOnce(new Error("OpenRouter completion failed: Upstream idle timeout exceeded"))
      .mockResolvedValueOnce(response(draft()));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("streams long source authoring when the provider supports it", async () => {
    const dir = projectDir();
    const complete = vi.fn(async () => {
      throw new Error("non-streaming source transport should not be used");
    });
    const streamComplete = vi.fn(async () => response(draft()));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "streaming author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
      streamComplete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).not.toHaveBeenCalled();
    expect(streamComplete).toHaveBeenCalledTimes(1);
    expect((streamComplete.mock.calls as unknown[][])[0]?.[1]).toMatchObject({
      model: "deepseek/deepseek-v4-pro",
      thinkingMode: "none",
    });
  });

  it("surfaces an actionable message when storyboard timeouts exhaust retries", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const complete = vi.fn().mockRejectedValue(timeout);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await expect(
      requestStoryboardPlan(provider, { brief: "Launch Relay", projectDir: dir, skills: skills() }),
    ).rejects.toThrow(/planning model kept timing out/i);
    // 3 transport retries on the primary rung, then 3 on the rescue rung —
    // a transient slowdown gets one shot at an independent upstream route
    // before the stage surfaces the actionable timeout message.
    expect(complete).toHaveBeenCalledTimes(6);
    expect(complete.mock.calls[3]?.[1]).toMatchObject({
      model: "tencent/hy3-preview",
    });
  }, 25_000);

  it("hands a systematically rejected storyboard to the rescue model with findings", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn(async (_prompt: string, options?: { model?: string }) =>
      options?.model === "tencent/hy3-preview"
        ? `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`
        : "no array anywhere in this prose");
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const plan = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(plan).toEqual(storyboard());
    // One artifact-less grace replay + 3 primary attempts with findings, then
    // the rescue rung recovers.
    expect(complete).toHaveBeenCalledTimes(5);
    const rescueCall = complete.mock.calls[4] as [string, { model?: string; thinkingMode?: string }];
    expect(rescueCall[1]).toMatchObject({
      model: "tencent/hy3-preview",
      thinkingMode: "medium",
    });
    expect(rescueCall[0]).toContain("Previous attempt rejected");
  });

  it("retries a rejected storyboard with findings, then surfaces the content error", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue("no array anywhere in this prose");
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await expect(
      requestStoryboardPlan(provider, { brief: "Launch Relay", projectDir: dir, skills: skills() }),
    ).rejects.toThrow(/missing <storyboard_json>/);
    // The bounded artifact gets one artifact-less grace replay, findings-driven
    // retries on the primary rung (3) and the rescue rung (2); transport-level
    // retries never fire for content errors.
    expect(complete).toHaveBeenCalledTimes(6);
    expect(complete.mock.calls[2]?.[0]).toContain("Previous attempt rejected");
    expect(complete.mock.calls[4]?.[1]).toMatchObject({ model: "tencent/hy3-preview" });
  });

  it("keeps the rescue rung off when the operator disables it", async () => {
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_STORYBOARD_RESCUE_MODEL", "none");
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValue("no array anywhere in this prose");
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await expect(
      requestStoryboardPlan(provider, { brief: "Launch Relay", projectDir: dir, skills: skills() }),
    ).rejects.toThrow(/missing <storyboard_json>/);
    // 3 attempts + the one artifact-less grace replay.
    expect(complete).toHaveBeenCalledTimes(4);
  });

  it("replays an artifact-less response once instead of spending a scarce attempt on it", async () => {
    // Live probe audit-final-a1: the rescue rung's FINAL attempt returned
    // prose with no <storyboard_json> and the whole run fell through to the
    // fallback path — a formatting fault, not a plan rejection, consumed the
    // last slot. The grace replay converts exactly one such response per run
    // into a fresh draw.
    vi.stubEnv("SLACK_SEQUENCES_CONCEPT_PASS", "0");
    vi.stubEnv("SLACK_SEQUENCES_STORYBOARD_RESCUE_MODEL", "none");
    const dir = projectDir();
    let calls = 0;
    const complete = vi.fn(async () => {
      calls += 1;
      return calls <= 3
        ? "no array anywhere in this prose"
        : `<storyboard_json>${JSON.stringify(storyboard())}</storyboard_json>`;
    });
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test planner",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    // Without the grace, three artifact-less responses exhaust the rung and
    // the valid fourth draw is never requested.
    const plan = await requestStoryboardPlan(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
    });
    expect(plan).toEqual(storyboard());
    expect(complete).toHaveBeenCalledTimes(4);
    // Every non-publishing attempt is persisted for offline diagnosis
    // (author-stage parity): the graced response and the rejected retries.
    const attemptsDir = path.join(dir, "planning", "attempts");
    expect(fs.existsSync(path.join(attemptsDir, "storyboard-1-artifact-missing.json"))).toBe(true);
    expect(fs.existsSync(path.join(attemptsDir, "storyboard-1-artifact-missing.raw.txt"))).toBe(true);
    expect(fs.existsSync(path.join(attemptsDir, "storyboard-2-rejected.json"))).toBe(true);
    expect(fs.existsSync(path.join(attemptsDir, "storyboard-3-rejected.json"))).toBe(true);
  });

  it("applies bounded exact repair patches without regenerating the composition", () => {
    const value = draft();
    const repaired = applyCompositionRepair(
      patchResponse("border: 1px solid #8b5cf6", "border: 1px solid #22d3ee"),
      value,
    );
    expect(repaired.storyboard).toBe(value.storyboard);
    expect(repaired.html).toContain("#22d3ee");
    expect(repaired.html).toContain("#8b5cf6");
  });

  it("parses provider-native structured repair patches without decorative tags", () => {
    const value = draft();
    const repaired = applyCompositionRepair(
      JSON.stringify({
        patches: [{
          search: "border: 1px solid #8b5cf6",
          replace: "border: 1px solid #22d3ee",
        }],
      }),
      value,
    );
    expect(repaired.html).toContain("#22d3ee");
  });

  it("recovers a bare repair array surrounded by model prose", () => {
    const value = draft();
    const repaired = applyCompositionRepair(
      `Here are the edits:\n${JSON.stringify([{
        search: "border: 1px solid #8b5cf6",
        replace: "border: 1px solid #22d3ee",
      }])}`,
      value,
    );
    expect(repaired.html).toContain("#22d3ee");
  });

  it("recovers a complete HTML document returned by a model that ignored patch mode", () => {
    const value = draft();
    const replacement = value.html.replace(
      "border: 1px solid #8b5cf6",
      "border: 1px solid #22d3ee",
    );
    const repaired = applyCompositionRepair(
      `I rewrote the document instead:\n${replacement}`,
      value,
    );
    expect(repaired.storyboard).toBe(value.storyboard);
    expect(repaired.html).toContain("#22d3ee");
  });

  it("applies a repair patch whose search reflowed whitespace", () => {
    const value = draft();
    // The model reproduced the rule but with collapsed/extra spacing — the most
    // common reason an exact indexOf patch misses. The substantive characters are
    // identical, so a whitespace-flexible match still applies it uniquely.
    const repaired = applyCompositionRepair(
      patchResponse(
        "h1 {   margin: 0;  font-size: 124px;\n   line-height: .95; }",
        "h1 { margin: 0; font-size: 110px; line-height: .95; }",
      ),
      value,
    );
    expect(repaired.html).toContain("font-size: 110px");
    expect(repaired.html).not.toContain("font-size: 124px");
  });

  it("still rejects a repair patch whose search is genuinely absent", () => {
    expect(() =>
      applyCompositionRepair(
        patchResponse("this text appears nowhere in the document", "x"),
        draft(),
      ),
    ).toThrow(/was not found/);
  });

  it("still rejects a repair patch whose search is ambiguous", () => {
    // ".scene" whitespace-flex-matches multiple class selectors / attributes.
    expect(() =>
      applyCompositionRepair(patchResponse("scene", "shot"), draft()),
    ).toThrow(/not unique/);
  });

  it("keeps unique edits when another independent patch is ambiguous", () => {
    const value = draft();
    const repaired = applyCompositionRepair(
      `<patches_json>${JSON.stringify([
        {
          search: "border: 1px solid #8b5cf6",
          replace: "border: 1px solid #22d3ee",
        },
        { search: "scene", replace: "shot" },
      ])}</patches_json>`,
      value,
    );
    expect(repaired.html).toContain("#22d3ee");
    expect(repaired.html).toContain('class="scene clip"');
  });

  it("reverts only the individual patch that breaks an inline script's parse", () => {
    const value = draft();
    const repaired = applyCompositionRepair(
      `<patches_json>${JSON.stringify([
        {
          search: "border: 1px solid #8b5cf6",
          replace: "border: 1px solid #22d3ee",
        },
        { search: "const tl =", replace: "const tl = = =" },
      ])}</patches_json>`,
      value,
    );
    expect(repaired.html).toContain("#22d3ee");
    expect(repaired.html).toContain("const tl =");
    expect(repaired.html).not.toContain("= = =");
  });

  it("rejects the attempt when every patch breaks the script parse", () => {
    expect(() =>
      applyCompositionRepair(
        patchResponse("const tl =", "const tl = = ="),
        draft(),
      ),
    ).toThrow(/inline script/);
  });

  it("quarantines only the browser-proven broken optional interaction", () => {
    const value = draft();
    const interactions = [
      {
        version: 1 as const,
        id: "broken-click",
        sceneId: "payoff",
        cursorId: "pointer",
        targetPart: "primary-action",
        action: "click" as const,
        startSec: 4.4,
        arriveSec: 5,
        pressSec: 5.1,
        releaseSec: 5.25,
        from: "frame:bottom-right" as const,
        path: "human" as const,
        aimX: 0.5,
        aimY: 0.5,
        feedback: "press" as const,
      },
      {
        version: 1 as const,
        id: "healthy-hover",
        sceneId: "payoff",
        cursorId: "pointer",
        targetPart: "secondary-action",
        action: "hover" as const,
        startSec: 5.4,
        arriveSec: 6,
        from: "part:primary-action" as const,
        path: "arc" as const,
        aimX: 0.5,
        aimY: 0.5,
        feedback: "none" as const,
      },
    ];
    value.storyboard[1]!.interactions = interactions;
    value.html = value.html.replace(
      "<script>\n    window.__timelines",
      `<script type="application/json" id="sequences-interactions">${
        JSON.stringify({ version: 1, interactions })
      }</script>\n  <script>\n    window.__timelines`,
    );
    const result = quarantineFailedInteractions(value, [{
      code: "interaction_not_visible",
      severity: "error",
      time: 5.1,
      interactionId: "broken-click",
      selector: "#primary-action",
      message: "Cursor or target is not visible during press.",
      source: "sequences",
    }]);
    expect(result.removedIds).toEqual(["broken-click"]);
    expect(result.draft.storyboard[1]!.interactions?.map((entry) => entry.id))
      .toEqual(["healthy-hover"]);
    expect(result.draft.html).not.toContain('"id":"broken-click"');
    expect(result.draft.html).toContain('"id":"healthy-hover"');
    expect(result.draft.html).not.toContain("data-sequences-quarantine");
    expect(result.draft.html.replace(/sequences-interactions[\s\S]*/, ""))
      .toBe(value.html.replace(/sequences-interactions[\s\S]*/, ""));
  });

  it("reserves the completion budget for source instead of DeepSeek reasoning", async () => {
    const dir = projectDir();
    const complete = vi.fn().mockResolvedValueOnce(response(draft()));
    const provider: AgentProvider = {
      id: "openai-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    const options = complete.mock.calls[0]?.[1] as {
      maxTokens?: number;
      thinkingMode?: string;
    } | undefined;
    expect(options?.maxTokens).toBe(12_288);
    expect(options?.thinkingMode).toBe("none");
  });

  it("uses a compact recovery prompt after a provider reports finish_reason=length", async () => {
    const dir = projectDir();
    const complete = vi.fn()
      .mockRejectedValueOnce(new ProviderOutputTruncatedError("OpenRouter", 16_384))
      .mockResolvedValueOnce(response(draft()));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: {
        ...skills(),
        text: `<blueprint id="huge">${"recipe ".repeat(8_000)}</blueprint>`,
      },
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(2);
    const firstPrompt = String(complete.mock.calls[0]?.[0]);
    const secondPrompt = String(complete.mock.calls[1]?.[0]);
    const secondOptions = complete.mock.calls[1]?.[1] as { model?: string } | undefined;
    expect(secondPrompt).toContain("compact recovery pass");
    expect(secondPrompt.length).toBeLessThan(firstPrompt.length / 2);
    expect(secondOptions?.model).toBe("deepseek/deepseek-v4-pro");
  });

  it("continues a partial OpenRouter document without spending a repair attempt", async () => {
    const dir = projectDir();
    const full = response(draft());
    const split = Math.floor(full.length / 2);
    const prefix = full.slice(0, split);
    const continuation = full.slice(split);
    const complete = vi.fn()
      .mockRejectedValueOnce(new ProviderOutputTruncatedError("OpenRouter", 8_192, prefix))
      .mockResolvedValueOnce(continuation);
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    const expected = draft();
    expected.html = withHostInjections(expected.html);
    expect(result.draft).toEqual(expected);
    expect((complete.mock.calls[1]?.[1] as { assistantPrefill?: string }).assistantPrefill)
      .toBe(prefix);
  });

  it("allows exactly one model repair after deterministic validation feedback", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace(
      "const tl =",
      "const noise = setTimeout(() => {}, 1); const tl =",
    );
    const complete = vi.fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(patchResponse(
        "const noise = setTimeout(() => {}, 1); const tl =",
        "const tl =",
      ));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(2);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toContain("timer-driven visual state is not seek-safe");
    expect(complete.mock.calls[1]?.[0]).toContain('"patches" array');
    expect((complete.mock.calls[1]?.[1] as { maxTokens?: number }).maxTokens).toBe(8_192);
    expect((complete.mock.calls[1]?.[1] as {
      responseFormat?: { json_schema?: { name?: string } };
    }).responseFormat?.json_schema?.name).toBe("sequences_composition_patches");
  });

  it("keeps OpenRouter bounded patches on the primary DeepSeek model by default", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace(
      "const tl =",
      "const noise = setTimeout(() => {}, 1); const tl =",
    );
    const complete = vi.fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(patchResponse("setTimeout(() => {}, 1)", "Date.now()"))
      // The final attempt is a full-context re-author (no runtime-valid
      // draft is banked), never a third compact patch.
      .mockResolvedValueOnce(response(draft()));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(3);
    expect(complete).toHaveBeenCalledTimes(3);
    expect((complete.mock.calls[1]?.[1] as { model?: string }).model)
      .toBe("deepseek/deepseek-v4-pro");
    expect((complete.mock.calls[2]?.[1] as { model?: string }).model)
      .toBe("deepseek/deepseek-v4-pro");
    expect((complete.mock.calls[1]?.[1] as { thinkingMode?: string }).thinkingMode)
      .toBe("none");
  });

  it("uses an explicitly configured repair model only for patch calls", async () => {
    vi.stubEnv("SLACK_SEQUENCES_REPAIR_MODEL", "operator/patch-model");
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace(
      "const tl =",
      "const noise = setTimeout(() => {}, 1); const tl =",
    );
    const complete = vi.fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(patchResponse(
        "const noise = setTimeout(() => {}, 1); const tl =",
        "const tl =",
      ));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect((complete.mock.calls[0]?.[1] as { model?: string }).model)
      .toBe("deepseek/deepseek-v4-pro");
    expect((complete.mock.calls[1]?.[1] as { model?: string }).model)
      .toBe("operator/patch-model");
  });

  it("falls back to the last runtime-valid draft when final polish regresses", async () => {
    const dir = projectDir();
    const initial = draft();
    const complete = vi.fn()
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(patchResponse(
        "border: 1px solid #8b5cf6",
        "border: 1px solid #22d3ee",
      ))
      .mockResolvedValueOnce(patchResponse(
        "border: 1px solid #22d3ee",
        "border: 1px solid #ef4444",
      ));
    vi.mocked(inspectDirectComposition)
      .mockResolvedValueOnce({
        ok: true,
        strictOk: false,
        samples: [0, 2, 4],
        issues: [],
        errors: [],
        warnings: ["layout warning"],
      })
      .mockResolvedValueOnce({
        ok: false,
        strictOk: false,
        samples: [],
        issues: [],
        errors: ["browser runtime failed"],
        warnings: [],
      });
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: initial.storyboard,
    });
    expect(result.attempts).toBe(2);
    expect(result.draft.html).toBe(withHostInjections(initial.html));
  });

  it("publishes runnable output when visual-QA polish patches are malformed", async () => {
    const dir = projectDir();
    const initial = draft();
    const complete = vi.fn()
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce('{"patches":[]}')
      .mockResolvedValueOnce('{"patches":[]}');
    vi.mocked(inspectDirectComposition).mockResolvedValueOnce({
      ok: true,
      strictOk: false,
      samples: [0, 2, 4],
      issues: [{
        code: "text_occluded",
        severity: "error",
        time: 2,
        selector: "#sell-btn-el",
        message: "Text is hidden beneath an opaque element.",
        source: "hyperframes",
      }],
      errors: [],
      warnings: [
        "text_occluded #sell-btn-el (t=2.00s): Text is hidden beneath an opaque element.",
      ],
    });
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };

    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: initial.storyboard,
    });

    expect(result.attempts).toBe(2);
    expect(result.draft.html).toBe(withHostInjections(initial.html));
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("mechanically replaces unseeded randomness before spending a model repair", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html.replace(
      "const tl =",
      "const noise = Math.random(); const tl =",
    );
    const complete = vi.fn().mockResolvedValueOnce(response(invalid));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).toContain("const __sequencesRandom");
    expect(result.draft.html).toContain("const noise = __sequencesRandom()");
    expect(result.draft.html).not.toContain("Math.random()");
  });

  it("normalizes computed timeline registration before spending a model repair", async () => {
    const dir = projectDir();
    const computed = draft();
    computed.html = computed.html.replace(
      'window.__timelines["relay-launch"] = tl;',
      "const root = document.getElementById('root'); " +
        "const compId = root.getAttribute('data-composition-id'); " +
        "window.__timelines[compId] = tl;",
    );
    const complete = vi.fn().mockResolvedValueOnce(response(computed));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).toContain('window.__timelines["relay-launch"] = tl;');
  });

  it("removes unavailable font-face sources before spending a model repair", async () => {
    const dir = projectDir();
    const withMissingFont = draft();
    withMissingFont.html = withMissingFont.html.replace(
      "<style>",
      "<style>@font-face{font-family:Inter;src:url('assets/inter.woff2') format('woff2')}",
    );
    const complete = vi.fn().mockResolvedValueOnce(response(withMissingFont));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).not.toContain("@font-face");
  });

  it("reconciles a mistyped scene id from its locked timing window", async () => {
    const dir = projectDir();
    const mistyped = draft();
    mistyped.html = mistyped.html.replaceAll("payoff", "payof");
    const complete = vi.fn().mockResolvedValueOnce(response(mistyped));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: draft().storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).toContain('id="payoff"');
    expect(result.draft.html).toContain('"#payoff-title"');
    expect(result.draft.html).not.toContain('id="payof"');
    expect(result.draft.html).not.toContain('"#payof-title"');
  });

  it("creates a missing standard ripple binding without spending a model repair", async () => {
    const dir = projectDir();
    const value = draft();
    const interaction = {
      version: 1 as const,
      id: "payoff-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click" as const,
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right" as const,
      path: "human" as const,
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press-ripple" as const,
      ripplePart: "primary-action-ripple",
    };
    value.storyboard[1]!.interactions = [interaction];
    value.html = value.html
      .replace(
        '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
        '<div data-camera-world><div class="panel" data-part="primary-action" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
      )
      .replace(
        '<p>Ship with nerve.</p></div>\n    </section>',
        '<p>Ship with nerve.</p></div></div><div data-camera-overlay>' +
          '<span><i data-cursor-id="pointer" style="position:absolute;left:0;top:0;' +
          'width:24px;height:24px;pointer-events:none"></i></span></div>\n    </section>',
      )
      .replace(
        'window.__timelines["relay-launch"] = tl;',
        'const root = document.getElementById("root"); const interactionsData = [];\n' +
          'SequencesInteractions.compile(tl, root, interactionsData);\n' +
          'window.__timelines["relay-launch"] = tl;',
      )
      .replace(
        "</body>",
        `<script type="application/json" id="sequences-interactions">${
          JSON.stringify({ version: 1, interactions: [] })
        }</script></body>`,
      );
    const complete = vi.fn().mockResolvedValueOnce(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.html).toContain('data-part="primary-action-ripple"');
    expect(result.draft.html).toContain("data-sequences-runtime-ripple");
    expect(result.draft.html).toContain("data-sequences-runtime-cursor");
    expect(result.draft.html).toContain('data-cursor-hotspot-x="0.1"');
    expect(result.draft.html).toContain('data-sequences-retired-cursor="pointer"');
    expect(result.draft.html).toContain("[data-sequences-retired-cursor]");
    expect(result.draft.html).toContain('<script src="sequences-interactions.v1.js"></script>');
    expect(result.draft.html).toContain("SequencesInteractions.compile(tl, root);");
    expect(result.draft.html).not.toContain(
      "SequencesInteractions.compile(tl, root, interactionsData)",
    );
    expect(result.draft.html.indexOf('id="sequences-interactions"')).toBeLessThan(
      result.draft.html.indexOf("const tl = gsap.timeline"),
    );
  });

  it("lets a statically invalid optional interaction degrade without vetoing the film", async () => {
    const dir = projectDir();
    const value = draft();
    value.storyboard[1]!.interactions = [{
      version: 1,
      id: "missing-target-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "model-invented-target",
      action: "click",
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press",
    }];
    const complete = vi.fn().mockResolvedValueOnce(response(value));
    const provider: AgentProvider = {
      id: "openrouter-api",
      label: "test author",
      kind: "api",
      detect: async () => ({ available: true, detail: "test" }),
      complete,
    };
    const result = await requestDirectComposition(provider, {
      brief: "Launch Relay",
      projectDir: dir,
      skills: skills(),
      lockedStoryboard: value.storyboard,
    });
    expect(result.attempts).toBe(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.draft.storyboard[1]?.interactions).toBeUndefined();
    expect(result.draft.html).toContain('"interactions":[]');
    expect(result.draft.html).toContain("data-sequences-quarantine");
  });

  it("publishes the healthy film after bounded repairs cannot fix an optional interaction", async () => {
    const dir = projectDir();
    const value = draft();
    value.storyboard[1]!.interactions = [{
      version: 1,
      id: "payoff-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click",
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press",
    }];
    value.html = value.html
      .replace(
        '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
        '<div data-camera-world><div class="panel" data-part="primary-action" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
      )
      .replace(
        '<p>Ship with nerve.</p></div>\n    </section>',
        '<p>Ship with nerve.</p></div></div><div data-camera-overlay>' +
          '<i data-cursor-id="pointer" style="position:absolute;left:0;top:0;' +
          'width:24px;height:24px;pointer-events:none"></i></div>\n    </section>',
      );
    const inspector = vi.mocked(inspectDirectComposition);
    const priorImplementation = inspector.getMockImplementation();
    inspector.mockImplementation(async (_projectDir, candidate) => {
      const hasInteraction = candidate.storyboard.some((scene) => scene.interactions?.length);
      return hasInteraction
        ? {
            ok: false,
            strictOk: false,
            samples: [5.1],
            issues: [{
              code: "interaction_not_visible",
              severity: "error",
              time: 5.1,
              interactionId: "payoff-click",
              selector: "#primary-action",
              message: "Cursor or target is not visible during press.",
              source: "sequences",
            }],
            errors: ["interaction_not_visible #primary-action"],
            warnings: [],
          }
        : {
            ok: true,
            strictOk: true,
            samples: [0, 2, 4, 6, 8],
            issues: [],
            errors: [],
            warnings: [],
          };
    });
    try {
      const noOpPatch = JSON.stringify({
        patches: [{ search: "Ship with nerve.", replace: "Ship with nerve." }],
      });
      const complete = vi.fn()
        .mockResolvedValueOnce(response(value))
        .mockResolvedValueOnce(noOpPatch)
        .mockResolvedValueOnce(noOpPatch);
      const provider: AgentProvider = {
        id: "openrouter-api",
        label: "test author",
        kind: "api",
        detect: async () => ({ available: true, detail: "test" }),
        complete,
      };
      const result = await requestDirectComposition(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: value.storyboard,
      });
      expect(result.attempts).toBe(3);
      expect(complete).toHaveBeenCalledTimes(3);
      expect(result.draft.storyboard[1]!.interactions).toBeUndefined();
      expect(result.draft.html).toContain('"interactions":[]');
      expect(result.draft.html).toContain(
        '[data-cursor-id="pointer"]{display:none!important}',
      );
      expect(result.draft.html).toContain("Ship with nerve.");
    } finally {
      inspector.mockImplementation(priorImplementation!);
    }
  });

  it("quarantines runtime-level unsupported optional interaction plans", async () => {
    const dir = projectDir();
    const value = draft();
    value.storyboard[1]!.interactions = [{
      version: 1,
      id: "runtime-broken-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click",
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right",
      path: "human",
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press",
    }];
    value.html = value.html.replace(
      '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
      '<div class="panel" data-part="primary-action" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
    );
    const inspector = vi.mocked(inspectDirectComposition);
    const priorImplementation = inspector.getMockImplementation();
    inspector.mockImplementation(async (_projectDir, candidate) => {
      const hasInteraction = candidate.storyboard.some((scene) => scene.interactions?.length);
      return hasInteraction
        ? {
            ok: false,
            strictOk: false,
            samples: [],
            issues: [],
            errors: ["browser_runtime: unsupported sequences interaction plan"],
            warnings: [],
          }
        : {
            ok: true,
            strictOk: true,
            samples: [0, 2, 4, 6, 8],
            issues: [],
            errors: [],
            warnings: [],
          };
    });
    try {
      const complete = vi.fn().mockResolvedValue(response(value));
      const provider: AgentProvider = {
        id: "openrouter-api",
        label: "test author",
        kind: "api",
        detect: async () => ({ available: true, detail: "test" }),
        complete,
      };
      const result = await requestDirectComposition(provider, {
        brief: "Launch Relay",
        projectDir: dir,
        skills: skills(),
        lockedStoryboard: value.storyboard,
      });
      expect(result.attempts).toBe(3);
      expect(result.draft.storyboard[1]!.interactions).toBeUndefined();
      expect(result.draft.html).toContain('"interactions":[]');
      expect(result.draft.html).toContain("data-sequences-quarantine");
    } finally {
      inspector.mockImplementation(priorImplementation!);
    }
  });

  it("passes deterministic validation and checkpoints exact revisions", async () => {
    const dir = projectDir();
    const first = draft();
    const validation = await validateDirectComposition(dir, first);
    expect(validation.errors).toEqual([]);

    await commitDirectComposition(dir, "Relay", first);
    await commitDirectComposition(dir, "Relay", draft("#22d3ee"));
    expect(hasDirectComposition(dir)).toBe(true);
    expect(loadDirectComposition(dir).manifest.revision).toBe(2);
    expect(loadDirectComposition(dir).html).toContain("#22d3ee");
    expect(loadDirectComposition(dir).manifest.qa).toEqual({
      browserValidated: true,
      layoutSamples: 5,
      warningCount: 0,
    });
    expect(fs.existsSync(path.join(dir, "composition", "STORYBOARD.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "composition", "motion-plan.json"))).toBe(true);
    const motionPlan = JSON.parse(
      fs.readFileSync(path.join(dir, "composition", "motion-plan.json"), "utf8"),
    ) as {
      direction: { version: number; source: string; scenes: unknown[] };
      directionConsumersEnabled: boolean;
      continuousMotion: { version: number; advisory: boolean; summary: { sampleCount: number } };
    };
    expect(motionPlan.direction).toMatchObject({ version: 1, source: "host-derived" });
    expect(motionPlan.direction.scenes).toHaveLength(first.storyboard.length);
    expect(motionPlan.directionConsumersEnabled).toBe(true);
    expect(motionPlan.continuousMotion).toMatchObject({
      version: 1,
      advisory: true,
      summary: { sampleCount: 5 },
    });
    expect(fs.existsSync(
      path.join(dir, "composition", "sequences-interactions.v1.js"),
    )).toBe(true);
    expect(fs.existsSync(path.join(dir, "composition", "qa", "spatial.json"))).toBe(true);
    expect(JSON.parse(
      fs.readFileSync(path.join(dir, "composition", "qa", "spatial.json"), "utf8"),
    ).continuousMotion).toMatchObject({ version: 1, advisory: true });
    expect(fs.existsSync(path.join(
      dir,
      "revisions",
      "0002",
      "sequences-interactions.v1.js",
    ))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "composition", "STORYBOARD.md"), "utf8"))
      .toContain("The trace arrives");

    // Simulate a checkpoint produced before interaction runtime/QA sidecars
    // existed. Undo must not leave revision 2 evidence beside revision 1.
    fs.rmSync(path.join(
      dir,
      "revisions",
      "0001",
      "sequences-interactions.v1.js",
    ));
    fs.rmSync(path.join(dir, "revisions", "0001", "qa"), {
      recursive: true,
      force: true,
    });
    expect(undoDirectComposition(dir)).toBe(true);
    expect(loadDirectComposition(dir).manifest.revision).toBe(1);
    expect(loadDirectComposition(dir).html).toContain("#8b5cf6");
    expect(fs.existsSync(path.join(
      dir,
      "composition",
      "sequences-interactions.v1.js",
    ))).toBe(false);
    expect(fs.existsSync(path.join(dir, "composition", "qa"))).toBe(false);
  });

  it("commits a statically valid draft when browser QA infrastructure is unavailable", async () => {
    const dir = projectDir();
    vi.mocked(inspectDirectComposition).mockResolvedValueOnce({
      ok: false,
      strictOk: false,
      infraError: "Chromium unavailable",
      samples: [],
      issues: [],
      errors: ["Chromium unavailable"],
      warnings: [],
    });
    await expect(commitDirectComposition(dir, "Relay", draft())).resolves.toBeDefined();
    const current = loadDirectComposition(dir);
    expect(current.manifest.qa).toMatchObject({
      browserValidated: false,
      layoutSamples: 0,
      warningCount: 1,
    });
    const qa = JSON.parse(
      fs.readFileSync(path.join(dir, "composition", "qa", "spatial.json"), "utf8"),
    ) as { infraError?: string };
    expect(qa.infraError).toBe("Chromium unavailable");
  });

  it("counts declared interactions even when browser evidence is unavailable", async () => {
    const value = draft();
    const intent = {
      version: 1 as const,
      id: "payoff-click",
      sceneId: "payoff",
      cursorId: "pointer",
      targetPart: "primary-action",
      action: "click" as const,
      startSec: 4.4,
      arriveSec: 5,
      pressSec: 5.1,
      releaseSec: 5.25,
      from: "frame:bottom-right" as const,
      path: "human" as const,
      aimX: 0.5,
      aimY: 0.5,
      feedback: "press" as const,
    };
    value.storyboard[1]!.interactions = [intent];
    value.html = value.html
      .replace(
        '<script src="gsap.min.js"></script>',
        '<script src="gsap.min.js"></script>\n<script src="sequences-interactions.v1.js"></script>',
      )
      .replace(
        '<div class="panel" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
        '<div data-camera-world><div class="panel" data-part="primary-action" data-layout-important data-layout-anchor="frame:center"><h1 id="payoff-title">',
      )
      .replace(
        '<p>Ship with nerve.</p></div>\n    </section>',
        '<p>Ship with nerve.</p></div></div><div data-camera-overlay><i data-cursor-id="pointer"></i></div>\n    </section>',
      )
      .replace(
        "  <script>\n    window.__timelines",
        `  <script type="application/json" id="sequences-interactions">${
          JSON.stringify({ version: 1, interactions: [intent] })
        }</script>\n  <script>\n    window.__timelines`,
      )
      .replace(
        '    window.__timelines["relay-launch"] = tl;',
        '    SequencesInteractions.compile(tl, document.getElementById("root"));\n' +
          '    window.__timelines["relay-launch"] = tl;',
      );
    const dir = projectDir();
    await commitDirectComposition(dir, "Relay", value);
    expect(loadDirectComposition(dir).manifest.qa?.interactionCount).toBe(1);
  });

  it("rejects network and nondeterministic scratch source without publishing it", async () => {
    const dir = projectDir();
    const invalid = draft();
    invalid.html = invalid.html
      .replace('src="gsap.min.js"', 'src="https://cdn.example/gsap.js"')
      .replace("const tl =", "const noise = Math.random(); const tl =");
    const validation = await validateDirectComposition(dir, invalid);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("network URLs are not allowed");
    expect(validation.errors.join("\n")).toContain("Math.random is not deterministic");
    expect(hasDirectComposition(dir)).toBe(false);
  });

  it("accepts inline data: URI backgrounds even when quoting is mangled", async () => {
    const dir = projectDir();
    // A Hero-Patterns-style inline SVG. The model frequently emits it with the
    // outer quotes backslash-escaped, which used to leave a stray quote clinging
    // to the captured value and defeat the data: skip — failing the whole build
    // with "referenced local asset does not exist".
    const pattern =
      "data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' " +
      "xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23E4C6BE' fill-opacity='0.4'%3E" +
      "%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4z'/%3E%3C/g%3E%3C/svg%3E";
    const withPattern = draft();
    withPattern.html = withPattern.html.replace(
      "background: #10131d;",
      `background: #10131d url(\\"${pattern}\\");`,
    );
    const validation = await validateDirectComposition(dir, withPattern);
    expect(validation.errors.join("\n")).not.toContain("referenced local asset");
    expect(validation.errors.join("\n")).not.toContain("asset reference must be local");
    expect(validation.ok).toBe(true);
  });

  it("gates committed frame facts and keeps softer frame guidance repairable", async () => {
    const dir = projectDir();
    await buildJobFrame({
      projectDir: dir,
      brief: "Launch Relay with brand accent #8B5CF6",
      evidence: "Brand signals: primary accent #8B5CF6; font Inter.",
      brandName: "Relay",
    });
    const matching = await validateDirectComposition(dir, draft("#8b5cf6"));
    expect(matching.frameErrors).toEqual([]);
    expect(matching.frameWarnings).toEqual(expect.any(Array));

    const drifted = await validateDirectComposition(dir, draft("#22d3ee"));
    expect(drifted.ok).toBe(false);
    expect(drifted.frameErrors.join("\n")).toContain("committed frame accent #8B5CF6");
  });
});

describe("L2 station positioning repair (plugin-live-1 static-flow station)", () => {
  it("completes position:absolute on a station declaring a placement rect", () => {
    const html =
      `<div data-camera-world style="width:3840px;height:2160px;position:absolute">` +
      `<div data-region="metric-station" style="left:0;top:0;width:1920px;height:1080px;display:grid"></div>` +
      `</div>`;
    const result = repairStationPositioning(html);
    expect(result.repairs).toBe(1);
    expect(result.html).toContain(
      'style="position:absolute;left:0;top:0;width:1920px;height:1080px;display:grid"',
    );
  });

  it("leaves already-positioned and rect-less stations alone (idempotent)", () => {
    const html =
      `<div data-region="a" style="position:absolute;left:10px;top:0;width:100px;height:100px"></div>` +
      `<div data-region="b" style="display:flex;gap:8px"></div>` +
      `<div data-region="c"></div>`;
    const result = repairStationPositioning(html);
    expect(result.repairs).toBe(0);
    expect(result.html).toBe(html);
    const repaired = repairStationPositioning(
      repairStationPositioning(
        `<div data-region="d" style="left:0;top:0;width:9px;height:9px"></div>`,
      ).html,
    );
    expect(repaired.repairs).toBe(0);
  });
});

describe("L2 infinite-repeat clamp (plugin-probe-1 attempt-1 death class)", () => {
  it("rewrites repeat:-1 to a finite repeat before the invariant lint", () => {
    const draftValue = draft();
    const storyboard = draftValue.storyboard;
    const withRepeat = {
      ...draftValue,
      html: draftValue.html.replace(
        "</body>",
        '<div class="pulse"></div><script>tl.to(\'.pulse\',{opacity:0.4,repeat: -1,yoyo:true});</script></body>',
      ),
    };
    const repaired = applyDeterministicSourceRepairs(withRepeat, projectDir(), storyboard);
    expect(repaired.html).not.toMatch(/repeat\s*:\s*-1\b/);
    expect(repaired.html).toContain("repeat: 2");
  });
});

describe("L2 brand base injection (host-owned committed type/canvas/accent)", () => {
  const FRAME_MD = [
    "| Token | Value | Rule |",
    "| Canvas | `#0A0E14` | Primary text must remain >=7:1 |",
    "| Surface | `#121824` | elevated field |",
    "| Text | `#F4F5F7` | load-bearing copy |",
    "| Muted text | `#9BA0AC` | secondary copy |",
    "| Committed accent | `#E8590C` | one accent |",
    "| Text on accent | `#111111` | safe ink |",
    "| Accent-soft | `#3A1F12` | tinted panels |",
    "| Border | `#2A3240` | seams |",
    "| Positive / negative | `#27D9A1` / `#B42335` | status only |",
    "",
    "**Display / headlines:** Space Grotesk",
    "**Body / UI:** EB Garamond",
    "**Mono / chrome / code:** JetBrains Mono",
  ].join("\n");

  it("renders the committed tokens as a host style block", () => {
    const block = brandBaseStyleBlock(FRAME_MD)!;
    expect(block).toContain('id="sequences-brand-base"');
    expect(block).toContain("--canvas:#0A0E14");
    expect(block).toContain("--surface:#121824");
    expect(block).toContain("--surface-2:#121824");
    expect(block).toContain("--text:#F4F5F7");
    expect(block).toContain("--muted:#9BA0AC");
    expect(block).toContain("--accent:#E8590C");
    expect(block).toContain("--accent-text:#111111");
    expect(block).toContain("--accent-soft:#3A1F12");
    expect(block).toContain("--border:#2A3240");
    expect(block).toContain("--positive:#27D9A1");
    expect(block).toContain("--negative:#B42335");
    expect(block).toContain("--font-body:'EB Garamond'");
    expect(block).toContain("body{font-family:var(--font-body)");
    expect(block).toContain(".cmp-headline{font-family:var(--font-display)");
    expect(block).toContain("--font-mono:'JetBrains Mono'");
  });

  it("injects before the first authored style so authored rules win, and converges", () => {
    const html =
      `<html><head><style>:root{--accent:#ffffff}</style></head><body></body></html>`;
    const once = injectBrandBase(html, FRAME_MD);
    expect(once.injected).toBe(true);
    const brandIndex = once.html.indexOf("sequences-brand-base");
    const authoredIndex = once.html.indexOf("--accent:#ffffff");
    expect(brandIndex).toBeGreaterThan(-1);
    expect(brandIndex).toBeLessThan(authoredIndex);
    const twice = injectBrandBase(once.html, FRAME_MD);
    expect(twice.injected).toBe(false);
    expect(twice.html).toBe(once.html);
  });

  it("no-ops without a frame or without committed tokens", () => {
    expect(injectBrandBase("<html></html>", undefined).injected).toBe(false);
    expect(brandBaseStyleBlock("no tokens here")).toBeUndefined();
  });
});

describe("L2 default worldLayout derivation (fix-probe-1 mega-station void)", () => {
  it("purely completes a partial station map while preserving every authored cell", () => {
    const scene: DirectScene = {
      ...storyboard()[1]!,
      components: [
        { version: 1, id: "overview-shell", kind: "app-window", region: "overview-station" },
        { version: 1, id: "root-panel", kind: "stat-card", region: "root-cause" },
      ],
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", toRegion: "overview-station", startSec: 3.05, durationSec: 0.4 },
          { version: 1, move: "pan", toRegion: "dependency-chain", startSec: 3.6, durationSec: 0.7 },
          { version: 1, move: "track-to-anchor", toPart: "root-panel", startSec: 4.5, durationSec: 0.7 },
        ],
      },
      worldLayout: [{ region: "dependency-chain", cell: [1, 0] }],
    };
    const before = structuredClone(scene);
    const completed = completeStoryboardWorldLayouts([scene]);

    expect(scene).toEqual(before);
    expect(completed.completions).toEqual([{
      sceneId: "product-proof",
      addedRegions: ["overview-station", "root-cause"],
      declaredCellCount: 1,
    }]);
    expect(completed.scenes[0]!.worldLayout).toEqual([
      { region: "dependency-chain", cell: [1, 0] },
      { region: "overview-station", cell: [0, 0] },
      { region: "root-cause", cell: [2, 0] },
    ]);
    const repeated = completeStoryboardWorldLayouts(completed.scenes);
    expect(repeated.completions).toEqual([]);
    expect(repeated.scenes).toEqual(completed.scenes);
  });

  it("co-locates an unregioned hero ring and support rail before scaffolding", () => {
    const scene: DirectScene = {
      id: "metric-open",
      title: "Metric opens",
      purpose: "Show one metric station",
      startSec: 0,
      durationSec: 3.5,
      spatialIntent: {
        version: 1,
        focalPart: "metric-ring",
        composition: "layout-center-stack",
        relationships: ["Support rail develops beneath the hero ring"],
      },
      camera: {
        version: 1,
        path: [
          { version: 1, move: "hold", toPart: "metric-ring", startSec: 0, durationSec: 0.5 },
          { version: 1, move: "drift", toPart: "metric-ring", startSec: 0.5, durationSec: 3 },
        ],
      },
      components: [
        { version: 1, id: "metric-ring", kind: "progress-ring", role: "hero" },
        { version: 1, id: "metric-rail", kind: "progress", role: "support" },
      ],
    };
    const completed = completeStoryboardWorldLayouts([scene]);
    expect(completed.completions).toEqual([{
      sceneId: "metric-open",
      addedRegions: ["metric-ring-station"],
      declaredCellCount: 0,
    }]);
    expect(completed.scenes[0]!.components).toEqual([
      expect.objectContaining({ id: "metric-ring", region: "metric-ring-station" }),
      expect.objectContaining({ id: "metric-rail", region: "metric-ring-station" }),
    ]);
    expect(completed.scenes[0]!.worldLayout).toEqual([
      { region: "metric-ring-station", cell: [0, 0] },
    ]);
    expect(completeStoryboardWorldLayouts(completed.scenes)).toEqual({
      scenes: completed.scenes,
      completions: [],
    });
    expect(scene.components?.every((component) => component.region === undefined)).toBe(true);
  });

  it("promotes one typed metric-opener drift into a monotonic push-in", () => {
    const scene: DirectScene = {
      id: "metric-open",
      title: "Metric opens",
      purpose: "Reveal one ring and its subordinate rail",
      startSec: 0,
      durationSec: 3.5,
      spatialIntent: {
        version: 1,
        focalPart: "metric-ring",
        composition: "one centered metric station",
        relationships: ["the support rail develops beneath the hero ring"],
      },
      camera: {
        version: 1,
        path: [{
          version: 1,
          move: "drift",
          toPart: "metric-ring",
          startSec: 0,
          durationSec: 3.5,
          zoom: 1.03,
          ease: "seqDrift",
        }],
      },
      components: [
        { version: 1, id: "metric-ring", kind: "progress-ring", role: "hero" },
        { version: 1, id: "metric-rail", kind: "progress", role: "support" },
      ],
      beats: [{
        version: 1,
        id: "ring-open",
        sceneId: "metric-open",
        component: "metric-ring",
        kind: "open",
        atSec: 0.5,
        durationSec: 0.6,
      }, {
        version: 1,
        id: "rail-open",
        sceneId: "metric-open",
        component: "metric-rail",
        kind: "open",
        atSec: 2,
        durationSec: 0.8,
      }],
    };
    const completed = completeStoryboardWorldLayouts([scene]);
    expect(completed.scenes[0]!.camera!.path).toEqual([
      expect.objectContaining({
        move: "push-in",
        toPart: "metric-ring",
        startSec: 0.5,
        durationSec: 3,
        zoom: 1.12,
        ease: "seqGlide",
      }),
    ]);
    expect(completed.scenes[0]!.sentinelNormalizations).toContainEqual(
      expect.stringContaining("camera-opener-converge"),
    );
    expect(completeStoryboardWorldLayouts(completed.scenes)).toEqual({
      scenes: completed.scenes,
      completions: [],
    });
    expect(scene.camera!.path[0]!.move).toBe("drift");
  });

  it("uses a connective station stride so a two-station camera route has no blank midpoint", () => {
    const value = draft();
    const scenes = [{
      ...value.storyboard[0]!,
      worldLayout: [
        { region: "metric-wall", cell: [0, 0] as [number, number] },
        { region: "cta-station", cell: [1, 0] as [number, number] },
      ],
    }];
    const html = value.html.replace(
      "</head>",
      `</head>`,
    ).replace(
      /(<section[^>]*data-scene="scene-a"[^>]*>)/,
      `$1<div data-camera-world><div data-region="metric-wall"></div>` +
        `<div data-region="cta-station"></div></div>`,
    );
    const first = injectWorldLayoutStyles(html, scenes);
    expect(first.rules).toBe(3);
    expect(first.html).toContain("width:3520px !important;height:1080px !important");
    expect(first.html).toContain(
      '[data-region="cta-station"]{position:absolute !important;left:1860px !important;',
    );
    expect(injectWorldLayoutStyles(first.html, scenes).html).toBe(first.html);
  });

  it("synthesizes viewport cells for one camera route and its local component regions", () => {
    const scenes = storyboard();
    const raw = scenes.map((scene, index) =>
      index === 1
        ? {
            ...scene,
            spatialIntent: {
              version: 1,
              focalPart: "terminal-surface",
              composition: "Terminal-led product proof",
              relationships: ["metrics update inside the terminal framing"],
            },
            camera: {
              version: 1,
              path: [
                { version: 1, move: "pan", toPart: "terminal-surface", startSec: 3.2, durationSec: 0.8 },
              ],
            },
            components: [
              { version: 1, id: "terminal-surface", kind: "terminal", region: "terminal-strip" },
              { version: 1, id: "metric-surface", kind: "stat-card", region: "metric-wall" },
            ],
          }
        : scene
    );
    const parsed = parseStoryboardResponse(`<storyboard_json>${JSON.stringify(raw)}</storyboard_json>`);
    const middle = parsed[1]!;
    expect(middle.worldLayout).toEqual([
      { region: "terminal-strip", cell: [0, 0] },
      { region: "metric-wall", cell: [1, 0] },
    ]);
    expect(
      middle.sentinelNormalizations?.some((note) => note.startsWith("world-layout-derive")),
    ).toBe(true);
    // A partial declaration keeps its authored cell and fills its missing
    // sibling instead of suppressing the world-layout guardrail.
    const declared = raw.map((scene, index) =>
      index === 1
        ? { ...scene, worldLayout: [{ region: "metric-wall", cell: [0, 0] }] }
        : scene
    );
    const kept = parseStoryboardResponse(`<storyboard_json>${JSON.stringify(declared)}</storyboard_json>`)[1]!;
    expect(kept.worldLayout).toEqual([
      { region: "metric-wall", cell: [0, 0] },
      { region: "terminal-strip", cell: [1, 0] },
    ]);
    expect(
      kept.sentinelNormalizations?.some((note) => note.startsWith("world-layout-derive")),
    ).toBe(true);
  });

  it("completes a partial three-station map around its declared middle cell", () => {
    const scenes = storyboard().map((entry, index) => index === 1
      ? {
          ...entry,
          components: [
            { version: 1 as const, id: "overview-shell", kind: "app-window" as const, region: "overview-station" },
            { version: 1 as const, id: "root-panel", kind: "stat-card" as const, region: "root-cause" },
            { version: 1 as const, id: "dependency-shell", kind: "app-window" as const, region: "dependency-chain" },
          ],
          spatialIntent: {
            version: 1 as const,
            focalPart: "dependency-shell",
            composition: "Dependency-led product proof",
            relationships: ["overview and root cause develop inside the dependency framing"],
          },
          camera: {
            version: 1 as const,
            path: [
              { version: 1 as const, move: "pan" as const, toPart: "dependency-shell", startSec: 3.6, durationSec: 0.7 },
            ],
          },
          worldLayout: [{ region: "dependency-chain", cell: [1, 0] as [number, number] }],
        }
      : entry);
    const middle = parseStoryboardResponse(
      `<storyboard_json>${JSON.stringify(scenes)}</storyboard_json>`,
    )[1]!;
    expect(middle.worldLayout).toEqual([
      { region: "dependency-chain", cell: [1, 0] },
      { region: "overview-station", cell: [0, 0] },
      { region: "root-cause", cell: [2, 0] },
    ]);
  });
});
