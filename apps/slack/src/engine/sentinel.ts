/**
 * Sentinel contract registry — the closed-world manifest of every authoring
 * obligation and the layer that owns it (SENTINEL_PLAN.md §3 Phase 4 item 1,
 * §2 layer model). This is the airtight-system half of the deliverable the
 * project owner asked for: one typed row per obligation, and a CI test
 * (`test/sentinel.test.ts`) that walks the registered `findingPrefixes` against
 * the validators' *actually emitted* finding strings so a NEW finding class can
 * never ship unregistered — the closed-world guarantee the FALLBACKS.md catalog
 * never had.
 *
 * How to read a row:
 * - `id`     — stable slug, `<group>.<facet>` where an obligation is enforced
 *              at more than one layer (each row lives at exactly ONE layer per
 *              the §2 rule "every obligation must live at exactly one layer").
 * - `group`  — the umbrella obligation from the plan's list (cuts, camera,
 *              components, interactions, pacing, moments, liveness, eye-trace,
 *              exits, coherence, layout, markup-audit, runtime, frame) plus the
 *              two Phase-3 normalize levers.
 * - `layer`  — where the obligation is OWNED today (the lowest layer that can);
 *              moving an obligation down a layer is the whole Sentinel thesis.
 * - `blocking` — the enforcement disposition (see `SentinelBlocking`).
 * - `findingPrefixes` — the finding-code prefixes this row owns. A scaffold /
 *              normalize row that makes a class unrepresentable still lists the
 *              L3/L4 backstop codes it prevents (the gate is never removed — the
 *              flag-OFF path and brief-required cases still fire them), so the
 *              closed-world test stays green with the flag in either position.
 *              Empty only when the obligation emits no finding at all (a pure
 *              normalization that PREVENTS another row's findings).
 * - `promptCostChars` — hand-estimated chars of `planning-director.md` prose the
 *              obligation still costs. Obligations with a deterministic owner
 *              (scaffold/normalize) should trend toward 0 as Phase-5 prompt
 *              surgery deletes their now-redundant prose; the estimates are the
 *              pre-shrink figures and are advisory, not asserted.
 * - `test`   — the regression test that proves the obligation.
 * - `addedBecause` — the incident / workstream / phase that created the row.
 *
 * This module is pure data + pure helpers: it imports no runtime engine code so
 * the manifest can never itself break a build.
 */

/** The Sentinel layer model (SENTINEL_PLAN.md §2). Lower owns more cheaply. */
export type SentinelLayerName =
  | "schema" // L0 — structured outputs; invalid output can't parse
  | "scaffold" // L1 — host-emitted chassis; illegal states unrepresentable
  | "normalize" // L2 — deterministic repair/normalization; zero paid attempts
  | "static" // L3 — linkedom / regex / kitMarkupAudit; cheap findings-retry
  | "browser" // L4 — measured browser truth; scene-scoped retry
  | "model-retry"; // L5 — bounded paid re-author; last resort

/** How a violation is enforced once detected. */
export type SentinelBlocking =
  | "impossible" // the state cannot be represented (schema/scaffold owner)
  | "deterministic-repair" // normalized/reconciled in code, no paid attempt
  | "blocking" // rejects the attempt (a paid findings-retry or fail-loud)
  | "advisory-late" // blocks early attempts, demotes to advisory on the final rung
  | "advisory"; // logged, never blocks (bounded extra seeks / diagnostics)

export interface SentinelContractRow {
  readonly id: string;
  readonly group: string;
  readonly layer: SentinelLayerName;
  readonly blocking: SentinelBlocking;
  readonly findingPrefixes: readonly string[];
  readonly promptCostChars: number;
  readonly test: string;
  readonly addedBecause: string;
}

/**
 * The registry. Ordered by layer (schema→scaffold→normalize→static→browser) so
 * the table reads top-down as "cheapest ownership first". Adding a finding class
 * without adding/expanding a row here fails `test/sentinel.test.ts`.
 */
export const SENTINEL_CONTRACT: readonly SentinelContractRow[] = [
  // ── L1 scaffold — host emits the chassis; the class is unrepresentable ──────
  {
    id: "camera.world-plane",
    group: "camera",
    layer: "scaffold",
    blocking: "impossible",
    findingPrefixes: ["camera_region_missing", "camera_part_missing"],
    promptCostChars: 1400,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-05 incident 1a: a scene declared a camera path but shipped no " +
      "data-camera-world plane/stations. Phase 1 emits the plane + data-region " +
      "stations at their exact worldLayout rects in the skeleton " +
      "(buildSceneSkeletons, SENTINEL_SKELETON); reconcileCameraWorldPlanes is " +
      "the L2 backstop and these codes stay the flag-OFF / brief-required gate.",
  },
  {
    id: "components.root",
    group: "components",
    layer: "scaffold",
    blocking: "impossible",
    findingPrefixes: ["component_root_missing", "component_beat_unbound"],
    promptCostChars: 1200,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-05 incident 1b: a declared component had no data-part root. " +
      "Phase 1 stamps the kit exemplar root (correct tag, cmp-<kind> class, real " +
      "id as data-part) inside its station (componentSkeletonMarkup); " +
      "reconcileComponentBindings is the L2 backstop; the codes stay the gate.",
  },

  // ── L2 normalize — deterministic repair, zero paid attempts ─────────────────
  {
    id: "normalize.host-plan-islands",
    group: "interactions",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-05 incident 2: the author hand-wrote sequences-* JSON islands " +
      "(wrong version, non-array scenes). Phase 1 strips EVERY model-authored " +
      "sequences-{interactions,cuts,camera,components,time} island unconditionally " +
      "(stripAllHostPlanIslands) and re-injects the canonical island from the " +
      "locked storyboard, so island syntax can never reach validation. Emits no " +
      "finding — it prevents the interactions/cuts/camera contract-parse errors.",
  },
  {
    id: "normalize.source-bindings",
    group: "interactions",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "The palette-input incident class: a mechanically-recoverable data-part / " +
      "data-region near-miss (exact id, unique semantic candidate, exact-name " +
      "station) is reconciled in applyDeterministicSourceRepairs " +
      "(reconcileInteractionTargets / reconcileContractBindings / " +
      "reconcileComponentBindings) instead of burning a paid attempt. Ambiguity " +
      "stays BLOCKING (falls through to the interactions/components rows below).",
  },
  {
    id: "normalize.camera-budget-clamp",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/pacingAudit.test.ts",
    addedBecause:
      "Phase 3.1: normalizeCameraBudget clamps camera-move counts to auditPacing's " +
      "own ceilings (drop the lowest-energy extra full move; keep the earliest " +
      "MAX_WHIPS_PER_FILM whips) so the arithmetic never burns a paid storyboard " +
      "retry — it PREVENTS pacing/camera-budget. It NEVER drops a move whose window " +
      "overlaps a declared moment's evidence search (load-bearing guard) and " +
      "commits ATOMICALLY: parseStoryboardResponse keeps the normalized plan only " +
      "if it re-validates clean, else logs 'sentinel-normalization reverted', " +
      "restores the model's own artifact, and retries THAT (so a clamp cannot mint " +
      "a fresh blocking finding — minCameraMoves, framing-density floor). " +
      "Telemetry tag: camera-budget-clamp. Visible in STORYBOARD.md.",
  },
  {
    id: "normalize.pacing-stretch",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/pacingAudit.test.ts",
    addedBecause:
      "Phase 3.1: stretchMarginalPacingMisses closes a marginal " +
      "pacing/reading|outcome shortfall (<= MAX_PACING_STRETCH_SEC) by extending " +
      "the scene's own cut boundary and cascade-shifting later scenes, so the " +
      "host does the subtraction instead of a paid retry — it PREVENTS " +
      "pacing/reading and pacing/outcome. Skips ramped scenes; detection runs in " +
      "each scene's unshifted frame; same atomic commit-or-revert as the clamp. " +
      "Telemetry tag: pacing-stretch. Visible in STORYBOARD.md.",
  },

  // ── L3 static — linkedom / regex / plan-stage audits; cheap findings-retry ──
  {
    id: "camera.energy",
    group: "camera",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: ["camera/energy"],
    promptCostChars: 1100,
    test: "test/cameraContract.test.ts",
    addedBecause:
      "2026-07-03 energy grading: auditCameraEnergy blocks a 12s+ storyboard with " +
      "no high-energy peak (whip / zoom>=1.3 push / energetic cut) or a repeated " +
      "HIGH-energy verb (whip/orbit only, WS6). A film with no peak reads flat.",
  },
  {
    id: "components.complexity",
    group: "components",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: ["components/complexity"],
    promptCostChars: 600,
    test: "test/componentContract.test.ts",
    addedBecause:
      "2026-07-04: auditComponentComplexity blocks a plan the author cannot build " +
      "(>1 component per ~1.2s scene / cap 4, or >1 per 2s of film) before it burns " +
      "a source-author attempt.",
  },
  {
    id: "cuts.coherence",
    group: "coherence",
    layer: "static",
    blocking: "advisory-late",
    findingPrefixes: ["cuts/coherence"],
    promptCostChars: 500,
    test: "test/cutContract.test.ts",
    addedBecause:
      "2026-07-05 WS6: auditCutCoherence flags a cut-style ZOO — more than " +
      "max(4, round(0.6x boundaries)) distinct non-hard styles. Rides the same " +
      "late-attempt polish demotion as pacing/* (advisory from the final rung).",
  },
  {
    id: "exits.discipline",
    group: "exits",
    layer: "static",
    blocking: "advisory-late",
    findingPrefixes: ["components/exit"],
    promptCostChars: 700,
    test: "test/componentContract.test.ts",
    addedBecause:
      "2026-07-05 WS4: auditSurfaceExits flags two station-dominating overlays " +
      "(command-palette/modal/dropdown/context-menu) whose open windows overlap in " +
      "one station without the first closing/swapping/morphing. Overlay-over-BASE " +
      "is the designed pattern and never flagged. Late-attempt polish demotion.",
  },
  {
    id: "pacing.holds",
    group: "pacing",
    layer: "static",
    blocking: "advisory-late",
    findingPrefixes: ["pacing/"],
    promptCostChars: 2600,
    test: "test/pacingAudit.test.ts",
    addedBecause:
      "2026-07-04 WS3: auditPacing is the density CEILING — per-scene camera-move " +
      "budget, introduction->development ratio, typed-copy reading floor, " +
      "press/set-state/toast outcome holds; all viewer-time. pacing/* blocks " +
      "attempts 1-2 of the primary rung and demotes to advisory from its final " +
      "attempt (degrade-never-veto, the improve-ws32-1 lesson). Marginal misses " +
      "are first absorbed deterministically by normalize.pacing-stretch above.",
  },
  {
    id: "moments.plan",
    group: "moments",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: ["storyboard/moments", "moment_unbound"],
    promptCostChars: 1800,
    test: "test/storyboardMoments.test.ts",
    addedBecause:
      "The moment contract: validatePlannedMoments enforces the duration-scaled " +
      "floor / spacing / no-dead-interval, and publication binds every declared " +
      "moment to executable timeline evidence (moment_unbound rejects an unbound " +
      "one). topUpStoryboardMoments first fills paperwork the plan already proves " +
      "so it is never vetoed for a moment it demonstrably delivers.",
  },
  {
    id: "liveness",
    group: "liveness",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: ["motion/"],
    promptCostChars: 1500,
    test: "test/motionDensity.test.ts",
    addedBecause:
      "validateMotionDensity: quiet gaps, slide-like scenes, and front-loading are " +
      "BLOCKING for 10s+/3+ shot films (motion/liveness); bursts/empty holds/pulses " +
      "stay advisory (motion/pulse, motion/density). Liveness is the floor pacing " +
      "is the ceiling against.",
  },
  {
    id: "markup-audit",
    group: "markup-audit",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: ["kit_markup_incomplete", "dom_markup_broken"],
    promptCostChars: 0,
    test: "test/kitMarkupAudit.test.ts",
    addedBecause:
      "2026-07-04: auditKitMarkupCompleteness re-runs the cut/camera/component " +
      "runtimes' DOM bind queries statically via linkedom (what a spec parser sees " +
      "is what the browser sees) so chartless charts, itemless rows, absent morph " +
      "twins, and missing camera stations surface as named findings BEFORE the " +
      "12s browser timeout. Host-owned check; no prompt prose.",
  },
  {
    id: "frame",
    group: "frame",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: ["frame/"],
    promptCostChars: 0,
    test: "test/frameDesign.test.ts",
    addedBecause:
      "validateCompositionAgainstFrame / validateTypography: the per-job frame.md " +
      "brand contract (frame/font, frame/accent, frame/palette, frame/type). " +
      "frame-design failures ALWAYS fail loud regardless of the fallback flag — " +
      "brand direction can't be faked. Deterministic tokens, no prompt prose.",
  },

  // ── L4 browser — measured pixel/geometry truth; scene-scoped retry ──────────
  {
    id: "cuts.degrade",
    group: "cuts",
    layer: "browser",
    blocking: "advisory-late",
    findingPrefixes: ["cut_degraded"],
    promptCostChars: 1300,
    test: "test/cutShapeMatch.browser.test.ts",
    addedBecause:
      "2026-07-04 WS1: a planner-DECLARED bridged cut (shape/object-match) the " +
      "runtime degrades is a measured cut_degraded polish finding carrying the " +
      "endpoint geometry, so the author loop repairs it instead of silently " +
      "shipping a zoom-through. Volunteered hopeless cuts degrade deterministically " +
      "(degradeVolunteeredBridgedCuts); brief-REQUIRED shape-match stays blocking.",
  },
  {
    id: "camera.framing",
    group: "camera",
    layer: "browser",
    blocking: "advisory-late",
    findingPrefixes: ["camera_framed_clipped", "camera_framed_sparse"],
    promptCostChars: 900,
    test: "test/framingCoverage.browser.test.ts",
    addedBecause:
      "2026-07-04: the camera-arrival framing audit seeks each full-move landing " +
      "and proves the framed station's content is on frame (camera_framed_clipped, " +
      "double-sampled so entrances can't false-positive) and fills >=18% of the " +
      "frame (camera_framed_sparse, WS5). strictOk-blocking polish, never " +
      "unpublishing; final-scene / full-width escapes.",
  },
  {
    id: "interactions",
    group: "interactions",
    layer: "browser",
    blocking: "blocking",
    findingPrefixes: ["interaction_"],
    promptCostChars: 1600,
    test: "test/interactionContract.test.ts",
    addedBecause:
      "The cursor interaction contract: hotspot/target/ripple geometry resolved " +
      "under camera transforms and measured live (interaction_target_miss / " +
      "_occluded / _not_visible / _ripple_* / _binding_* / _overlay_invalid / " +
      "_pointer_events / _camera_coupling / _seek_instability / _runtime_plan / " +
      "_static_contract). Near-miss bindings are L2-reconciled " +
      "(normalize.source-bindings); ambiguity and measured invisibility stay here.",
  },
  {
    id: "moments.temporal",
    group: "moments",
    layer: "browser",
    blocking: "advisory",
    findingPrefixes: ["moment_static_frame"],
    promptCostChars: 0,
    test: "test/temporalJudge.browser.test.ts",
    addedBecause:
      "2026-07-04 rendered temporal judge: before/mid/after frame triples around " +
      "every evidence-bound moment, pixel-diffed in-page; an invisible claimed " +
      "change is a moment_static_frame polish finding (repair guidance, never " +
      "unpublishes a runnable draft). SLACK_SEQUENCES_TEMPORAL_JUDGE=0 disables.",
  },
  {
    id: "eye-trace",
    group: "eye-trace",
    layer: "browser",
    blocking: "advisory-late",
    findingPrefixes: ["eye_trace_jump", "eye_trace_pingpong"],
    promptCostChars: 700,
    test: "test/eyeTrace.browser.test.ts",
    addedBecause:
      "2026-07-04 WS2: eye-trace continuity from browser QA's boundary geometry — " +
      "eye_trace_jump when outgoing/incoming attention centers sit >38% of the " +
      "frame diagonal apart across a hard/undeclared cut (strictOk-blocking; " +
      "SLACK_SEQUENCES_EYE_TRACE=audit|0 observes/disables), always-advisory " +
      "eye_trace_pingpong for gaze whiplash 0.25-1.2s apart.",
  },
  {
    id: "exits.stale-asset",
    group: "exits",
    layer: "browser",
    blocking: "advisory",
    findingPrefixes: ["stale_asset_lingers"],
    promptCostChars: 0,
    test: "test/layoutInspector.test.ts",
    addedBecause:
      "2026-07-05 WS4: stale_asset_lingers (ALWAYS advisory, bounded seeks) flags " +
      "a component whose last beat has passed still at opacity >=0.9 overlapping " +
      "the focal element — the visible half of exit discipline the plan-stage " +
      "auditSurfaceExits can't measure.",
  },
  {
    id: "layout",
    group: "layout",
    layer: "browser",
    blocking: "blocking",
    findingPrefixes: [
      "layout_",
      "spatial_focal_",
      "important_safe_area",
      "content_overlap",
      "container_overflow",
      "contrast_aa",
    ],
    promptCostChars: 2200,
    test: "test/layoutInspector.test.ts",
    addedBecause:
      "layoutInspector: the placement/spacing/optical audit — safe-area, anchor, " +
      "align, gap, annotation, focal-subject presence/visibility/on-frame, content " +
      "overlap, container overflow, WCAG-AA contrast. Heuristics suppressed during " +
      "camera transits and for off-frame world stations.",
  },
  {
    id: "runtime.invariants",
    group: "runtime",
    layer: "browser",
    blocking: "blocking",
    findingPrefixes: [
      "runtime_bind_exception",
      "near_blank_film",
      "near_blank_scene",
      "browser_warning",
      "browser_runtime",
      "invalid_inline_script_syntax",
      "overlapping_clips_same_track",
    ],
    promptCostChars: 900,
    test: "test/directComposition.test.ts",
    addedBecause:
      "The hard runtime invariants: a loaded document that never registers its " +
      "timeline is runtime_bind_exception (the author loop re-authors full-context, " +
      "not a compact patch); a scene/film that renders empty is near_blank_scene / " +
      "near_blank_film; a console error/warning surfaces as browser_runtime / " +
      "browser_warning; a patch that breaks inline-script parse is " +
      "invalid_inline_script_syntax (revert only that edit); the lint gate rejects " +
      "overlapping_clips_same_track (sub-epsilon float overlaps excepted).",
  },
];

/**
 * The finding-producing source files the closed-world test scans. Scoped to the
 * validators/audits/runner so infrastructure modules that use finding-shaped
 * literals for other purposes (mcp.ts tool names, modelPolicy.ts model ids,
 * thumbs.ts MIME types) are out of scope. Relative to `src/engine/`.
 */
export const FINDING_SOURCE_FILES: readonly string[] = [
  "pacingAudit.ts",
  "cameraContract.ts",
  "cutContract.ts",
  "componentContract.ts",
  "interactionContract.ts",
  "eyeTrace.ts",
  "motionDensity.ts",
  "storyboardMoments.ts",
  "kitMarkupAudit.ts",
  "frameValidation.ts",
  "layoutInspector.ts",
  "directComposition.ts",
  "compositionRunner.ts",
  "sceneSlots.ts",
];

/**
 * Finding-SHAPED string literals in the scanned files that are NOT findings —
 * response-format / JSON-schema names, host-owned island & response tag names,
 * MCP tool names referenced in prose, and image/video MIME types used for
 * screenshot/thumbnail encoding. Each is a stable infrastructure constant; a
 * genuinely new finding code will not collide with one, so it still fails the
 * closed-world test until registered above. Adding an entry here is a conscious,
 * reviewed act (the same discipline the registry enforces).
 */
export const NON_FINDING_LITERALS: ReadonlySet<string> = new Set([
  // Response / JSON-schema names.
  "json_schema",
  "json_object",
  "sequences_frame_direction",
  "sequences_storyboard",
  "sequences_composition_patches",
  "sequences_concept",
  "sequences_critique",
  // Response + host-owned island tag names the parser reads.
  "index_html",
  "storyboard_json",
  "patches_json",
  "scene_html",
  "scene_script",
  // MIME types for screenshot / thumbnail / render encoding.
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "application/json",
  "application/octet-stream",
  // MCP tool names referenced in diagnostic prose.
  "submit_composition",
  "submit_plan",
  "render_preview",
  "apply_commands",
  "get_planning_context",
  "get_project_outline",
  "get_scene",
  "lint_report",
  // A `.startsWith("eye_trace")` grouping prefix, not an emitted code — the
  // real codes are eye_trace_jump / eye_trace_pingpong (registered on the
  // eye-trace row). Listed so the closed-world scan doesn't mistake the
  // prefix literal for a new class.
  "eye_trace",
]);

/** Every registered finding prefix, flattened (for the coverage walk). */
export function allRegisteredFindingPrefixes(): string[] {
  return SENTINEL_CONTRACT.flatMap((row) => [...row.findingPrefixes]);
}

/** True when a finding code is owned by some registered row. */
export function isRegisteredFinding(code: string): boolean {
  return SENTINEL_CONTRACT.some((row) =>
    row.findingPrefixes.some((prefix) => code.startsWith(prefix)),
  );
}

// A finding code is a namespaced token (>=1 `/` or `_` separator) that sits
// IMMEDIATELY after an opening quote/backtick and is IMMEDIATELY followed by
// either `:` (a `` `component_root_missing:${scene}` `` message) or the SAME
// closing delimiter (a bare `code: "camera_framed_clipped"` object value). This
// deliberately matches a small wrapped shape rather than tokenizing the whole
// file — a naive string scanner desyncs on apostrophes inside `//` comments and
// prose ("the scene's cut"), silently swallowing real literals. A leading token
// followed by a space is a message-continuation fragment ("cut/camera move…")
// and never matches (the third group requires `:` or a quote).
const WRAPPED_FINDING = /(["'`])([a-z][a-z0-9]*(?:[/_][a-z0-9-]+)+)(?::|\1)/g;

/**
 * Extract the finding codes emitted by a source file. Codes in
 * `NON_FINDING_LITERALS` are dropped. This is the exact rule
 * `test/sentinel.test.ts` uses to enforce the closed-world guarantee.
 */
export function extractFindingCodes(source: string): string[] {
  const codes = new Set<string>();
  for (const match of source.matchAll(WRAPPED_FINDING)) {
    const code = match[2]!;
    if (NON_FINDING_LITERALS.has(code)) continue;
    codes.add(code);
  }
  return [...codes];
}
