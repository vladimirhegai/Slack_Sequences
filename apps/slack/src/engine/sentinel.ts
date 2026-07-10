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
 *              normalize row that prevents or repairs a class still lists the
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
  | "scaffold" // L1 — host-emitted chassis + final shipped binding coverage
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
  // ── L1 scaffold — host emits the chassis; L2/L3 remain honest backstops ─────
  {
    id: "camera.world-plane",
    group: "camera",
    layer: "scaffold",
    blocking: "blocking",
    findingPrefixes: ["camera_region_missing", "camera_part_missing"],
    promptCostChars: 1400,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-05 incident 1a: a scene declared a camera path but shipped no " +
      "data-camera-world plane/stations. The skeleton/slot templates emit the " +
      "plane + data-region stations at their exact worldLayout rects " +
      "(buildSceneSkeletons/buildSceneSlotInteriors). HONESTY (2026-07-06 final " +
      "audit): the model returns the interiors, so omission stays representable " +
      "— the ladder is: template → slotScaffoldViolations scene-scoped repair " +
      "(missing stations re-request ONLY that scene) → reconcileCameraWorldPlanes " +
      "L2 plane wrap → these codes as the L3 gate. The old 'impossible' label " +
      "overstated the guarantee (p6/p7 probes still hit the codes); the L1 " +
      "telemetry now counts bindings PRESERVED in the shipped document, not " +
      "planned by the template.",
  },
  {
    id: "components.root",
    group: "components",
    layer: "scaffold",
    blocking: "blocking",
    findingPrefixes: ["component_root_missing", "component_beat_unbound"],
    promptCostChars: 1200,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-05 incident 1b: a declared component had no data-part root. " +
      "The templates stamp the kit exemplar root (correct tag, cmp-<kind> class, " +
      "real id as data-part) inside its station (componentSkeletonMarkup). " +
      "HONESTY (2026-07-06 final audit): same ladder as camera.world-plane — " +
      "template → scene-scoped slot repair for a root with NO trace at all → " +
      "reconcileComponentBindings for near-misses (kind-marked/unique candidate) " +
      "→ these codes as the L3 gate. Never labeled 'impossible' again while the " +
      "model authors the interiors.",
  },
  {
    id: "layout.scene-stack",
    group: "layout",
    layer: "scaffold",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/sceneSlots.browser.test.ts",
    addedBecause:
      "2026-07-10 session26-camera-probe-4: the authored film stylesheet loaded " +
      "after the slot chassis and redefined `.scene` as position:relative. Every " +
      "shot collapsed into a 116px grid row at y=580, which made camera targets, " +
      "the CTA, and root-relative interaction geometry appear independently " +
      "broken. slotStageStyle now locks only host-owned root sizing, absolute " +
      "scene stacking, clip containment, and overlay geometry with important " +
      "declarations; display, padding, background, and opacity remain authorable. " +
      "The real-browser proof loads adversarial model CSS after the host floor.",
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

  {
    id: "normalize.camera-move-delay",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/pacingAudit.test.ts",
    addedBecause:
      "Phase-5 hardening (2026-07-06 probes): the single most repeated rejection " +
      "was pacing/outcome 'framing changes 0.0s later' — a camera move starting " +
      "right after a payoff/typed-copy beat. delayConflictingCameraMoves delays " +
      "the move (<= MAX_PACING_STRETCH_SEC) so the hold lands, only when the move " +
      "starts AT/after the beat settles, does not pass the next full move, and is " +
      "not load-bearing. 2026-07-07 attempt-economy sweep: when the delayed move " +
      "overruns the scene's own cut (the short-scene shape every probe re-rejected), " +
      "the boundary stretches by the overflow (<= MAX_PACING_STRETCH_SEC, 15s scene " +
      "cap) and later scenes cascade-shift — still pure arithmetic. Same atomic " +
      "commit-or-revert. Telemetry tag: camera-move-delay. Visible in STORYBOARD.md.",
  },
  {
    id: "normalize.interaction-hold-retime",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/pacingAudit.test.ts",
    addedBecause:
      "2026-07-08 probe-audit-01: a whip re-framed the world DURING a cursor " +
      "click (arrive 8.4s, press 8.5s, whip in flight 8.1-8.8s). " +
      "retimeCameraOverInteractions delays any full move (dive exempt — its " +
      "held middle exists to frame an act) out of every interaction's " +
      "arrive→result window (+lead/settle), never passing the next full move, " +
      "stretching the cut boundary <= MAX_PACING_STRETCH_SEC when it overruns, " +
      "and preserving every moment-evidence binding; an unfittable " +
      "NON-load-bearing move drops to the drift auto-fill. The backstop gate is " +
      "auditPacing's pacing/interaction-hold (pacing.holds row, advisory-late), " +
      "which only fires on residue no retime could fix. Same atomic " +
      "commit-or-revert. Telemetry tag: interaction-hold-retime.",
  },
  {
    id: "normalize.move-spacing",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/pacingAudit.test.ts",
    addedBecause:
      "2026-07-08 probe-audit-02: stacked entry transitions — a hard cut then a " +
      "whip 0.2s later, a morph then a push-in 0.3s later — play as two " +
      "transitions back to back, and mergeCompoundMoves only fuses SAME-target " +
      "pairs. spaceStackedCameraMoves delays an ENERGETIC full move " +
      "(whip/orbit/dive/committed push-pull) to ENTRY_SETTLE_SEC after a scene's " +
      "incoming cut and to MOVE_SETTLE_GAP_SEC after a previous energetic move " +
      "aimed at a DIFFERENT target, under the same fit/binding constraints as " +
      "the interaction retime; an unfittable stack is left alone (spacing is " +
      "polish, never worth a veto — no backstop finding). Live probe " +
      "probe-audit-fable-2 lesson: both retime normalizers walk their targets " +
      "CLEAR of reading/outcome hold windows + interaction windows " +
      "(advanceClearOfWindows) so a spacing delay can never mint the " +
      "pacing/outcome conflict delayConflictingCameraMoves (which runs earlier) " +
      "exists to prevent. Same atomic commit-or-revert. Telemetry tag: " +
      "move-spacing.",
  },
  {
    id: "normalize.early-swap-delay",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/pacingAudit.test.ts",
    addedBecause:
      "2026-07-08 probe-audit-01: the incoming copy of a cut must be READ before " +
      "it CHANGES. A `swap` beat firing within ENTRY_SETTLE_SEC of a non-first " +
      "scene's start re-writes the just-landed frame before the viewer reads it " +
      "(cta-resolve: headline morphs in at 18.6s, swaps its text 0.2s later at " +
      "18.8s — a pointless flash of the landed copy). delayEarlySwapBeats delays " +
      "the swap to scene.startSec + ENTRY_SETTLE_SEC (shift atSec, keep duration) " +
      "when the beat still fits the scene — stretching the cut boundary <= " +
      "MAX_PACING_STRETCH_SEC (15s scene cap) when it overruns — and preserving " +
      "every moment-evidence binding (EVIDENCE_BEFORE/AFTER overlap, like " +
      "retimeCameraOverInteractions); a retime that would break a binding leaves " +
      "the beat alone. The backstop gate is auditPacing's pacing/reading variant " +
      "(pacing.holds row, advisory-late), which fires only on the residue. Same " +
      "atomic commit-or-revert (order: after move-spacing, before pacing-stretch). " +
      "Telemetry tag: early-swap-delay.",
  },
  {
    id: "normalize.component-trim",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/componentContract.test.ts",
    addedBecause:
      "2026-07-07 attempt-economy sweep (recorded next candidate): a " +
      "components/complexity over-count by 1-2 is the arithmetic the host can do " +
      "without inventing anything. trimOverBudgetComponents (parseStoryboard, in " +
      "the atomic commit-or-revert) drops the fewest-beat surface(s) that bind NO " +
      "declared moment (a beat inside a moment's evidence window), NO interaction " +
      "targetPart, and NO camera toPart/focus.part or cut focalPartOut/In — the " +
      "finding's own 'drop the set dressing' fix. Over-count >= 3 or nothing " +
      "safely droppable keeps the blocking finding (ambiguity stays a finding). " +
      "It PREVENTS the components.complexity row's components/complexity. " +
      "Telemetry tag: component-trim. Visible in STORYBOARD.md.",
  },
  {
    id: "normalize.framing-floor-topup",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/pacingAudit.test.ts",
    addedBecause:
      "2026-07-07 attempt-economy sweep (recorded next candidate): the " +
      "distinct-framings floor (validateStoryboardPlan) short by EXACTLY one is " +
      "the mechanical half of its own fix hint. topUpFramingFloor (parseStoryboard, " +
      "in the atomic commit-or-revert) adds ONE gentle establishing push-in " +
      "(FRAMING_TOPUP_ZOOM 1.15, <= 1s, opening the shot so it never steals a " +
      "beat's hold) to the longest single-framing shot that has real content to " +
      "frame — lifting the framing count by one without inventing a shot. Short by " +
      ">= 2 is a real content deficit and stays a finding. It PREVENTS the " +
      "framing-density floor error. Telemetry tag: framing-floor-topup. Visible in " +
      "STORYBOARD.md.",
  },
  {
    id: "normalize.camera-energy-lift",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/cameraContract.test.ts",
    addedBecause:
      "2026-07-07 attempt-economy sweep (recorded next candidate): a 12s+ film " +
      "with no high-energy peak (auditCameraEnergy's camera/energy) that ALREADY " +
      "commits to a mild zoom-in. liftCameraEnergyPeak (parseStoryboard, in the " +
      "atomic commit-or-revert) raises the single largest push-in/pull-back/dive " +
      "whose effective zoom is in [MILD_ENERGY_ZOOM_MIN 1.15, HIGH_ENERGY_PUSH_ZOOM " +
      "1.3) up to 1.3 — the audit's own remediation advice ('a push-in with " +
      "zoom:1.35'), never inventing a move or verb. Fires only with no energetic " +
      "cut and a liftable candidate; a peak-less film with only pans/drifts is a " +
      "real energy deficit that stays a finding. It PREVENTS the camera.energy " +
      "row's camera/energy. Telemetry tag: camera-energy-lift. Visible in " +
      "STORYBOARD.md.",
  },
  {
    id: "normalize.rack-focus-topup",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/cameraContract.test.ts",
    addedBecause:
      "2026-07-10 session26-camera-probe-1: three consecutive storyboard " +
      "attempts supplied a rich multi-station camera path but omitted the " +
      "brief-required rack-focus modifier. topUpRequiredRackFocus attaches the " +
      "focus pull to the strongest existing non-whip full move with an already " +
      "declared part target (its toPart, otherwise the scene focal); it never " +
      "invents a move or target, and a plan without either stays blocking. " +
      "Telemetry tag: rack-focus-topup. Visible in STORYBOARD.md.",
  },
  {
    id: "normalize.camera-landing-reserve",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/cameraContract.test.ts",
    addedBecause:
      "2026-07-10 session26-camera-probe-1 visual audit: multi-station pans " +
      "and the final push-in landed exactly on the next cut/film end, so the " +
      "audience saw travel but no readable destination. reserveFinalCameraLanding " +
      "shortens only a substantial, non-dive final full move ending on the " +
      "scene boundary by 0.42s; the ordinary resolver fills that tail with " +
      "destination drift, preserving continuous movement. Targets, cues, scene " +
      "timing, short impact moves, explicit holds, and dive envelopes stay " +
      "unchanged. Telemetry tag: camera-landing-reserve. Visible in STORYBOARD.md.",
  },
  {
    id: "normalize.camera-connective-yield",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/cameraContract.test.ts",
    addedBecause:
      "2026-07-10 session26-camera-probe-7 temporal audit: pacing retimers " +
      "changed startSec values without restoring path order, while connective " +
      "drift could overlap a decisive full move. The resolver consequently " +
      "squeezed a declared 2s parallax pass into 0.3s and produced the film's " +
      "largest jerk cluster. normalizeConnectiveCameraSchedule makes drift/hold " +
      "yield to full moves, drops only remnants below 150ms, and chronologically " +
      "sorts the path after every retime. Full moves and creative targets remain " +
      "unchanged. Telemetry tag: camera-connective-yield. Visible in STORYBOARD.md.",
  },
  {
    id: "normalize.root-data-start",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-07 independent audit: a model-authored composition root that omits " +
      "data-start=\"0\" breaks host timeline arithmetic downstream. " +
      "applyDeterministicSourceRepairs inserts it on the data-composition-id root " +
      "when absent (ensureRootDataStart) — idempotent, never duplicates. " +
      "Telemetry tag: root-data-start.",
  },
  {
    id: "normalize.dive-window",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/cameraDive.test.ts",
    addedBecause:
      "MD5 (2026-07-06): the operator's zoom-in→type→zoom-out ask kept dying on " +
      "three-segment camera arithmetic GLM cannot do. `dive` collapses it into " +
      "ONE typed move; deriveDiveWindows (parseStoryboard, unconditional like " +
      "the timing re-base) derives the in/hold/out legs from the beats and " +
      "interactions acting on the dive's toPart — including the viewer-time " +
      "reading floor for typed/swapped copy — and stores them on the move. A " +
      "dive with NOTHING acting on its target degrades to push-in with a " +
      "warning (degrade-never-veto). Telemetry tag: dive-window.",
  },
  {
    id: "normalize.fx-plan",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/fxContract.test.ts",
    addedBecause:
      "MD2 (2026-07-06): motion-design garnish (payoff sweeps + glow pulses, " +
      "connector draw-ons, morph-bridge echo) is HOST-derived from data the " +
      "storyboard already carries (resolveFxPlan) and injected like every " +
      "contract island — zero planner options beyond highlight.style, zero " +
      "author paperwork, zero new failure classes. validateFxContract errors " +
      "are host-plumbing self-checks (island/runtime/compile drift), reachable " +
      "only if the injection seam breaks; every runtime bind is " +
      "enhancement-only (missing target compiles to nothing).",
  },
  {
    id: "normalize.auto-pop-style",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/motionAutoStyle.test.ts",
    addedBecause:
      "md-audit gap (2026-07-07): MD3/MD4/MD6 shipped correct + tested but were " +
      "INVISIBLE in production films — the GLM storyboard planner reliably " +
      "declares the structure yet under-reaches for the OPTIONAL style/gradeShift " +
      "fields (md-audit-probe-3b/4 shipped ZERO styled beats even when the brief " +
      "demanded them; the claude-code-cli probe-1 filled them). autoStyleCompactPops " +
      "(parseStoryboard) fills the field the planner left blank: every style-less " +
      "`open` beat on a COMPACT_POP_KINDS surface (toast/button/stat-card/…) is " +
      "styled `pop`. It never overrides an explicit style and adds zero planner " +
      "surface; the compact-kind + 2/scene discipline stays owned by " +
      "normalize.open-pop (below), the single governor. Telemetry tag: auto-pop-style.",
  },
  {
    id: "normalize.open-pop",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/componentContract.test.ts",
    addedBecause:
      "MD6 (2026-07-06): overshoot is banned as a house style; the `open` pop is " +
      "the typed exception, and taste is host-owned, not prose-hoped. " +
      "degradeOpenPopStyles (parseStoryboard) drops the pop to the smooth default " +
      "open on any non-compact kind (COMPACT_POP_KINDS) and beyond the second pop " +
      "in a scene — degrade-never-veto, the parse already strips unknown styles. " +
      "Telemetry tag: open-pop.",
  },
  {
    id: "normalize.auto-headline-style",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/motionAutoStyle.test.ts",
    addedBecause:
      "md-audit gap (2026-07-07): the GLM planner declares a `headline` + its " +
      "`type` beat but leaves `style` blank, so hero copy always arrives as a plain " +
      "typewriter (md-audit-probe-4). autoStyleHeadlineReveals (parseStoryboard) " +
      "defaults every style-less headline `type` beat to `rise` and promotes the " +
      "SINGLE strongest resolve (latest headline type on a primary moment) to " +
      "`assemble` ONLY when it can prove the assemble lock-hold with auditPacing's " +
      "own arithmetic (assembleHoldSatisfied) — so it never mints a pacing/assemble " +
      "finding the model can't fix. The 1/film + headline-only + on-primary cap " +
      "stays owned by normalize.assemble-cap (below). Telemetry tag: auto-headline-style.",
  },
  {
    id: "normalize.assemble-cap",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/textFx.browser.test.ts",
    addedBecause:
      "MD3 (2026-07-06): `assemble` (scattered letters converging into the word) " +
      "is the film's loudest text gesture — a thesis/logo resolve, and twice is " +
      "kitsch. degradeExcessAssembles (parseStoryboard) keeps exactly ONE per " +
      "film, headline-kind only, coinciding with a primary moment, and degrades " +
      "every other assemble to a `rise` reveal (SENTINEL L2 over an L3 " +
      "findings-retry: the degrade is unambiguous, so it costs zero paid " +
      "attempts). Telemetry tag: assemble-cap.",
  },
  {
    id: "normalize.auto-grade-shift",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/motionAutoStyle.test.ts",
    addedBecause:
      "md-audit gap (2026-07-07): the GLM planner narrates the temperature turn in " +
      "a moment ('world turns warm') but leaves the OPTIONAL scene `gradeShift` " +
      "field blank, so no shift ships even when the brief demanded one " +
      "(md-audit-probe-4). deriveGradeShifts (parseStoryboard) mechanizes the " +
      "planner's OWN stated intent: when a scene has no declared gradeShift and a " +
      "`primary` moment names a temperature (warm/cold/noir) with room to read, it " +
      "injects a gradeShift AT that moment turning to the named tone — inventing no " +
      "color decision. The window/aftermath/1-per-scene/2-per-film/moment-coincidence " +
      "discipline stays owned by normalize.grade-shift (below). Telemetry tag: " +
      "auto-grade-shift.",
  },
  {
    id: "normalize.grade-shift",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/directComposition.test.ts",
    addedBecause:
      "MD4 (2026-07-06): a scene `gradeShift` (animated background temperature " +
      "turn) is a volunteered garnish, so dropUnusableGradeShifts " +
      "(parseStoryboard) drops one that breaks the discipline — atSec outside the " +
      "scene, <1.2s aftermath, over 1/scene or 2/film, or with no declared moment " +
      "within +/-0.5s to motivate it — with a note instead of vetoing a paid " +
      "attempt (the dropUnusableVolunteeredTimeRamps precedent). A surviving " +
      "shift compiles in the fx runtime as an expanding kit panel + grade-class " +
      "swap, and is bindable `grade-shift` moment evidence. Telemetry tag: " +
      "grade-shift.",
  },
  {
    id: "normalize.timeramp-retime",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/directComposition.test.ts",
    addedBecause:
      "Phase-5 hardening (2026-07-06 sentinel-p5-longcopy): the ramp motivation " +
      "contract demands the model land a moment inside a sub-second solver-derived " +
      "hold window — host arithmetic, not creative judgment. " +
      "retimeUnmotivatedTimeRamps scans atSec candidates (0.1s grid, " +
      "nearest-to-declared first) and commits the first that resolves AND covers a " +
      "declared moment; per-scene convergence-checked, never invents a dip or " +
      "moment; scenes with no moments / no working candidate keep the existing " +
      "drop/finding path. Telemetry tag: timeramp-retime. Visible in STORYBOARD.md.",
  },
  {
    id: "normalize.morph-twin-reconcile",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/directComposition.test.ts",
    addedBecause:
      "Phase-5 hardening (2026-07-06 sentinel-p5-camera-b rescue attempt died " +
      "SOLELY on 'morphs to undeclared component'). reconcileUndeclaredMorphTargets " +
      "declares the missing twin when the source kind has exactly ONE legal " +
      "catalog partner (interaction-reconciliation precedent: unique candidate " +
      "reconciles, ambiguity stays blocking); an ambiguous non-load-bearing morph " +
      "degrades to highlight; ambiguous load-bearing keeps the blocking finding. " +
      "Runs inside the atomic commit-or-revert (a twin that would breach " +
      "components/complexity reverts). Telemetry tag: morph-twin-reconcile.",
  },
  {
    id: "normalize.embedded-development-fold",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-10 session26-camera-probe-2: a findings rescue supplied the " +
      "missing metric development at the correct seconds but wrapped it in a " +
      "new scene fully embedded inside the existing metric scene. Generic " +
      "contiguous timing rebasing moved the patch later and recreated the same " +
      "moment gap. mergeEmbeddedDevelopmentScenes folds only a contained scene " +
      "whose exact component ids/kinds and focal part already exist on its " +
      "parent, whose cues remain inside the parent, and whose only camera work " +
      "is hold/drift. New surfaces, interactions, plugins, recipes, premium " +
      "cuts, timed modifiers, full reframes, or escaped cues keep the ordinary " +
      "blocking path. Telemetry tag: embedded-development-fold. Visible in " +
      "STORYBOARD.md.",
  },

  {
    id: "normalize.gsap-call-shape",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-06 sentinel-s5-interactions probe: a `.fromTo(target, vars, " +
      "<number>)` call (toVars omitted) makes GSAP treat the position number as " +
      "the to-object and the compile throws 'Cannot create property parent on " +
      "number' — a runtime_bind_exception and a burned paid attempt for a " +
      "call-shape typo. repairMalformedFromToCalls rewrites a settled `.to` " +
      "state when the same selector has an earlier opposite-state initialization. " +
      "The 2026-07-10 Vectorline probe proved a second unambiguous shape: a " +
      "visible/settled <=50ms pin is also `.to`, because it has no perceptible " +
      "entrance/exit and preserves its sole declared state at the declared cue. " +
      "Hidden/off-position, mixed, and ordinary-duration lone-final calls stay " +
      "blocking rather than silently reversing motion. Only string-literal " +
      "targets with a flat vars object match (conservative). " +
      "It PREVENTS the runtime.invariants row's runtime_bind_exception.",
  },
  {
    id: "normalize.slot-script-envelope",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/sceneSlots.test.ts",
    addedBecause:
      "2026-07-09 polish-audit live probe: two paid source attempts reached the " +
      "browser with mechanically invalid slot bindings. One emitted line-leading " +
      "bare fromTo(...) calls (not a browser global); the next wrapped valid scene " +
      "statements around window.__tl_scene_<id>, which the host never creates, so " +
      "the wrapper received undefined and threw on tl.fromTo. The later " +
      "direction-live-b probe wrapped every otherwise-valid slot in an uninvoked " +
      "(tl) => {...} expression (including a const-assigned variant), making all " +
      "authored motion a silent no-op. Probes 4 and 6 added the equally mechanical " +
      "forms: window.__tl, two-argument `(tl, root) => {...}` envelopes, top-level " +
      "`time` variables used as GSAP positions, data-* names inside JS vars, and " +
      "later-scene cues expressed in unmistakably scene-local time. " +
      "normalizeSceneSlotScript binds or rewrites only those complete shapes to the " +
      "host-owned timeline/root/absolute film clock; it preserves targets, visual " +
      "vars, durations, and locally declared fromTo helpers. Telemetry tag: " +
      "slot-script-envelope.",
  },
  {
    id: "normalize.inline-source-syntax",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-10 session26-camera-probe-6: one otherwise usable source put a " +
      "bare CSS `var(--positive)` token in a GSAP object and another used a " +
      "literal ellipsis as decorative SVG path geometry. The first cannot parse " +
      "as JavaScript; the second is not SVG geometry. Executable inline scripts " +
      "now quote only bare var() values, leaving styles/JSON untouched. Invalid " +
      "ellipsis paths are removed only when decorative; any path carrying a part, " +
      "component, or important-layout binding stays blocking. Telemetry tags: " +
      "bare-css-var and invalid-svg-placeholder.",
  },
  {
    id: "normalize.moment-demote-last-resort",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/directComposition.test.ts",
    addedBecause:
      "Phase-5 completion (2026-07-06 sentinel-p6-longcopy): the author ladder " +
      "exhausted with a runnable, browser-clean draft blocked SOLELY by an " +
      "unbound PRIMARY moment ('hairline-grow has no executable timeline " +
      "evidence' x 5 paid attempts -> fail-loud). The pre-throw salvage demotes " +
      "exactly the unbound primaries to supporting (they re-anchor onto authored " +
      "evidence or drop with a warning — the path supporting moments already " +
      "take), re-validates, and ships only if the draft then passes static + " +
      "browser gates. Any other finding still fails the salvage; STORYBOARD.md " +
      "and the moment strip show the true bound set. Telemetry tag: " +
      "moment-demote-last-resort.",
  },

  {
    id: "normalize.camera-sparse-zoom",
    group: "normalize",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/framingCoverage.browser.test.ts",
    addedBecause:
      "2026-07-07 camera-sparse auto-framing (the live probe's ONLY shipping " +
      "degradation was least-bad-pick:penalty=7 from camera_framed_sparse on a " +
      "resolve-scene landing). correctSparseFraming raises a landing the browser " +
      "measured as a tiny subject adrift back to the 18% coverage floor with a " +
      "bounded zoom-in (sqrt(0.18/fraction), clamped 1.0..2.8 — the camera " +
      "contract's own fit-multiplier ceiling since the 2026-07-07 independent " +
      "audit, which also marks the move framingCorrection:\"camera-sparse-zoom\" " +
      "so browser QA keeps auditing the zoomed landing instead of skipping it) on " +
      "exactly the camera move that frames it — a storyboard mutation re-injected " +
      "through the persistUpgradedStoryboard seam, adopted in " +
      "authorCompositionLoop ONLY when the sparse finding clears, no new " +
      "camera_framed_clipped appears, and browserQualityPenalty strictly " +
      "decreases (enhancement-never-veto); the adopted storyboard also replaces " +
      "args.lockedStoryboard so later repair passes re-inject the corrected " +
      "island. It PREVENTS the camera.framing row's camera_framed_sparse; " +
      "drift/hold-only and camera-less scenes have no bumpable move and keep the " +
      "model/least-bad path (a storyboard zoom cannot invent content). Telemetry " +
      "tag: camera-sparse-zoom.",
  },
  {
    id: "normalize.focal-late-sample",
    group: "layout",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/layoutInspector.test.ts",
    addedBecause:
      "2026-07-07 attempt-economy sweep: spatial_focal_invisible repeated " +
      "VERBATIM across paid patch attempts when the declared focal simply " +
      "entered after the single 58% hero sample (a command palette opening a " +
      "beat later). The inspector now re-samples <=2 bounded later instants " +
      "inside the same shot and drops the finding when the subject is visible " +
      "there — measurement honesty (the WS7 thumbnail walk applied to QA), " +
      "never a gate change: a subject visible at NO sample still fires. " +
      "Telemetry tag: focal-late-sample.",
  },

  {
    id: "normalize.recipe-reconcile",
    group: "recipes",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/recipeContract.test.ts",
    addedBecause:
      "2026-07-07 Recipe Studio (RECIPE_STUDIO_PLAN.md §7): storyboards may " +
      "declare library recipes (proven, gate-passed motion patterns) that the " +
      "host instantiates verbatim at Level 1. reconcileRecipeDeclarations " +
      "(parseStoryboard tail) is the L2 governor: unknown/stale ids drop, " +
      "params default/clamp/drop against the typed slot schema, the " +
      "MAX_RECIPES_PER_FILM budget trims — degrade-never-veto, because the " +
      "recipe knowledge already reached the planner at Level 0 (retrieval), " +
      "so a dropped declaration costs influence, never a paid attempt. " +
      "Telemetry tags: recipe-reconcile, recipe-inject.",
  },
  {
    id: "normalize.plugin-lower",
    group: "plugins",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/pluginContract.test.ts",
    addedBecause:
      "2026-07-08 host plugins (the seventh contract): storyboards may invoke " +
      "parameterized GENERATORS as typed `plugins:[{kind,params}]` forms. " +
      "reconcileAndLowerPlugins (parseStoryboard, before the dive/pop/moment " +
      "machinery) is the L2 governor AND the lowering: unknown kinds no-op " +
      "with a note, params default/clamp/drop, the MAX_PLUGINS_PER_FILM " +
      "budget trims, and kept units lower into ordinary typed components " +
      "(stamped pluginUid) + beats so every existing gate judges the executed " +
      "plan. A unit counts ONCE in complexity/pacing budgets " +
      "(componentUnitCount / sceneIntroductionTimes) and its children are " +
      "never trimmed piecemeal. Probe-audit-01/02/03 motivation: geometry, " +
      "believable content, and N-element entrances are host strengths the " +
      "model reliably fumbles. 2026-07-09 plugin-live-1 lessons folded in: " +
      "entrance beats wait for the camera's arrival at the unit's station " +
      "(cameraArrivalSec — count-ups no longer play off-screen), the injected " +
      "wrapper carries placement self-defense (grid-column:1/-1, min-width:0) " +
      "so an author grid station can never squeeze it, and author-drawn " +
      "markup duplicating an ABSORBED component (pluginAbsorbedParts) is " +
      "hidden by a host style block at injection. Telemetry tags: " +
      "plugin-reconcile, plugin-inject.",
  },
  {
    id: "normalize.asset-lower",
    group: "plugins",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/assetRuntime.test.ts",
    addedBecause:
      "2026-07-09 asset animation runtime (ASSETS.md): each declared " +
      "asset-<id> unit lowers to ONE internal `asset` component (host-only " +
      "kind — normalizeStoryboardComponents rejects it from models) plus " +
      "host-derived typed `animate` beats (the asset's trigger:enter " +
      "animation at the shared entrance anchor, then each trigger:payoff in " +
      "sequence), so pacing/motion-density/moments/complexity judge the " +
      "spring choreography like any other beat while " +
      "applyDeterministicSourceRepairs injects the sequences-assets island + " +
      "runtime + compile call from the SAME resolved timing. Kill switch " +
      "SLACK_SEQUENCES_ASSETS. Telemetry tag: asset-inject.",
  },
  {
    id: "normalize.kit-chart-complete",
    group: "markup-audit",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-08 attempt-economy (kit_markup_incomplete absorption — the top " +
      "static-rejection class, 64 historical): a chart beat whose SOLE root has " +
      "neither an svg stroke nor bar children aborts the component compile, the " +
      "same mechanical bind gap topUpRowsMarkup fixes. topUpChartMarkup " +
      "(applyDeterministicSourceRepairs) injects the kit exemplar's required " +
      "structure host-side — direct <i> bars for a bars/generic chart, an svg " +
      "polyline for a line chart — marked data-sequences-neutral=\"chart\" so a " +
      "SHIPPED placeholder records the chart-neutral-bars-shipped degradation " +
      "(never a clean publish). Fires only on the mechanically certain case: " +
      "exactly one root with no stroke, no revealable children, and no stray " +
      "<i>. Anything content-bearing stays the markup-audit finding. It PREVENTS " +
      "the markup-audit row's kit_markup_incomplete for chartless charts.",
  },
  {
    id: "normalize.kit-progress-complete",
    group: "markup-audit",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-08 attempt-economy (kit_markup_incomplete absorption): a progress " +
      "beat whose SOLE root has no .cmp-ring-fg, [data-cmp-fill], or direct <i> " +
      "fill aborts the compile. topUpProgressMarkup injects the kit exemplar's " +
      "fill host-side — <i data-cmp-fill> for a horizontal bar, an svg arc for a " +
      "ring (ONLY into a root with no <svg>; a partial svg is ambiguous and " +
      "stays a finding) — marked data-sequences-neutral=\"progress\" " +
      "(progress-neutral-fill-shipped on ship). Same host-completion pattern as " +
      "topUpRowsMarkup. It PREVENTS the markup-audit row's kit_markup_incomplete " +
      "for fill-less progress.",
  },
  {
    id: "normalize.world-layout-derive",
    group: "camera",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/directComposition.test.ts",
    addedBecause:
      "2026-07-09 fix-probe-1: a camera scene naming regions but declaring NO " +
      "worldLayout reached the skeleton as rect-less stations, and the author " +
      "freestyled geometry — a 7680px wall station put the plugin unit in a " +
      "quarter-frame void at fit zoom and shipped stations without " +
      "position:absolute. parseStoryboard now synthesizes one viewport-sized " +
      "cell per camera-path region (first-appearance order) so " +
      "worldStationRects/cameraWorldStyle emit sane rects by construction. " +
      "Declared worldLayout always wins. Telemetry tag world-layout-derive.",
  },
  {
    id: "normalize.gsap-repeat-clamp",
    group: "runtime-invariants",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/directComposition.test.ts",
    addedBecause:
      "2026-07-09 plugin-probe-1 attempt 1 died on the static invariant " +
      "`repeat: -1` (infinite repeats are unbounded under deterministic " +
      "capture). The author's intent — an ambient pulse — survives a finite " +
      "clamp, so applyDeterministicSourceRepairs rewrites repeat:-1 to " +
      "repeat: 2 before the lint (telemetry tag gsap-repeat-clamp). The " +
      "invariant gate is unchanged; the obligation moved to L2.",
  },
  {
    id: "normalize.station-position",
    group: "camera",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/directComposition.test.ts",
    addedBecause:
      "2026-07-09 plugin-live-1: a camera-world station authored with a " +
      "left/top placement rect but NO position:absolute is static flow — the " +
      "rect is ignored, the station spans the full world plane, and its " +
      "content (including host plugin units) overflows every clip audit " +
      "(canvas_overflow 240px on plugin tiles). The intent is mechanically " +
      "certain, so repairStationPositioning completes the declaration " +
      "(telemetry tag station-position).",
  },
  {
    id: "normalize.brand-base",
    group: "brand",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/directComposition.test.ts",
    addedBecause:
      "2026-07-09 probes 2/3 both burned browser attempts on `frame/type: " +
      "body family not used` — a committed-brand fact the host already knows. " +
      "injectBrandBase (applyDeterministicSourceRepairs) renders frame.md's " +
      "committed tokens as a host style block BEFORE authored styles: :root " +
      "custom properties (--canvas/--accent/--font-*), base body/heading/mono " +
      "font rules, and the kit's var() fallbacks bind to brand instead of " +
      "default blue. Authored rules still win the cascade; the frame/type " +
      "warning class becomes unrepresentable and the first frame carries the " +
      "tinted canvas (no white flash). Telemetry tag brand-base.",
  },
  {
    id: "normalize.dead-tween-strip",
    group: "runtime-invariants",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: [],
    promptCostChars: 0,
    test: "test/authorReliability.test.ts",
    addedBecause:
      "2026-07-09 asset-probe-2: the author emitted literal-selector GSAP tweens " +
      "against markup it did not ship. GSAP reports a browser warning but executes " +
      "a no-op, so stripDeadGsapTweens queries the parsed final document and removes " +
      "only standalone literal calls with invalid/missing selectors after host markup " +
      "injection. Dynamic and chained calls remain untouched; moment/motion gates " +
      "still catch any load-bearing missing animation. Telemetry tag dead-tween-strip.",
  },

  // ── L3 static — linkedom / regex / plan-stage audits; cheap findings-retry ──
  {
    id: "recipes.contract",
    group: "recipes",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: [
      "recipe_unknown",
      "recipe_island_missing",
      "recipe_motion_missing",
      "recipe_slot_unfilled",
    ],
    promptCostChars: 0,
    test: "test/recipeContract.test.ts",
    addedBecause:
      "2026-07-07 Recipe Studio: validateRecipeContract is a host-plumbing " +
      "self-check (the validateFxContract disposition) — the host strips and " +
      "re-injects every declared recipe's fragment from the library on every " +
      "repair pass (injectRecipeContract in applyDeterministicSourceRepairs, " +
      "before the time-wrap), so these codes are reachable only if the " +
      "injection seam breaks or a declaration survives reconciliation without " +
      "a library entry. Never a routine authoring finding; no prompt prose.",
  },
  {
    id: "plugins.contract",
    group: "plugins",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: ["plugin_unknown", "plugin_island_missing"],
    promptCostChars: 0,
    test: "test/pluginContract.test.ts",
    addedBecause:
      "2026-07-08 host plugins: validatePluginContract is a host-plumbing " +
      "self-check (the validateRecipeContract disposition) — the host strips " +
      "and re-generates every declared unit's markup from the locked " +
      "storyboard on every repair pass (injectPluginContract in " +
      "applyDeterministicSourceRepairs, before component-binding " +
      "reconciliation), so these codes are reachable only if the injection " +
      "seam breaks. Never a routine authoring finding; no prompt prose.",
  },
  {
    id: "assets.contract",
    group: "plugins",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: ["asset_island_missing", "asset_island_stale", "asset_runtime_missing"],
    promptCostChars: 0,
    test: "test/assetRuntime.test.ts",
    addedBecause:
      "2026-07-09 asset animation runtime (ASSETS.md): validateAssetContract " +
      "is a host-plumbing self-check (the validatePluginContract disposition) " +
      "— the asset plugin lowering emits typed `animate` beats and the host " +
      "injects the sequences-assets island + sequences-assets.v1.js + compile " +
      "call itself (applyDeterministicSourceRepairs, telemetry tag " +
      "asset-inject, behind SLACK_SEQUENCES_ASSETS), so these codes are " +
      "reachable only if the injection seam breaks. Stands down when the " +
      "assets flag is off (animate beats then no-op in the components " +
      "runtime). Never a routine authoring finding; no prompt prose.",
  },
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
    id: "pacing.opening-subject",
    group: "pacing",
    layer: "static",
    blocking: "blocking",
    findingPrefixes: ["storyboard/opening-subject"],
    promptCostChars: 0,
    test: "test/pacingAudit.test.ts",
    addedBecause:
      "2026-07-10 session26-camera-probe-6: a 4s cold open withheld its first " +
      "declared product subject until 2.8s, so browser QA correctly rejected the " +
      "film as near-blank only after source authoring. auditPacing now requires " +
      "the first declared subject within 1.25s. This story-structure failure is " +
      "always blocking and intentionally does not share the advisory-late pacing/ " +
      "prefix used for marginal hold arithmetic.",
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
      "are first absorbed deterministically by normalize.pacing-stretch above. " +
      "2026-07-08 adds pacing/interaction-hold: no full move in flight during a " +
      "cursor interaction's arrive→result window (dive exempt) — repaired first " +
      "by normalize.interaction-hold-retime, so the finding is residue-only.",
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
    id: "interactions.near-miss-normalize",
    group: "interactions",
    layer: "normalize",
    blocking: "deterministic-repair",
    findingPrefixes: ["cursor_near_miss"],
    promptCostChars: 0,
    test: "test/layoutInspector.test.ts",
    addedBecause:
      "2026-07-07: a measured cursor endpoint within 3px of its target is " +
      "sub-perceptual easing drift, not a defect — auditInteractions snaps the " +
      "evidence to the measured target anchor and labels it " +
      "normalized:\"cursor_near_miss\" instead of burning a paid retry on an " +
      "interaction_target_miss. >3px stays a hard blocking miss (the 4px " +
      "regression test). Recorded as normalization tag cursor-near-miss so the " +
      "ledger never hides the snap.",
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
      "change is a moment_static_frame finding. Primary moments consume source " +
      "repair budget and weigh least-bad selection; supporting moments remain " +
      "diagnostic. Neither alone unpublishes a runnable draft. " +
      "SLACK_SEQUENCES_TEMPORAL_JUDGE=0 disables.",
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
    blocking: "advisory-late",
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
      "camera transits and for off-frame world stations. Findings request repair " +
      "on early attempts but may ship only through the explicitly degraded final rung.",
  },
  {
    id: "layout.hyperframes-spatial",
    group: "layout",
    layer: "browser",
    blocking: "advisory-late",
    findingPrefixes: [
      "clipped_text",
      "text_box_overflow",
      "canvas_overflow",
      "text_occluded",
      "motion_appears_late",
      "motion_out_of_order",
      "motion_off_frame",
      "motion_frozen",
      "motion_selector_missing",
      "motion_selector_ambiguous",
    ],
    promptCostChars: 0,
    test: "test/layoutInspector.test.ts",
    addedBecause:
      "2026-07-06 final audit: HyperFrames' own layout/motion audit codes flow " +
      "through normalizeHyperframesIssue as DYNAMIC strings, so the closed-world " +
      "scan never saw them and probes shipped unregistered clipped_text / " +
      "text_box_overflow findings (p7-denseui). The closed world for these is the " +
      "vendored LayoutIssueCode union (vendor/hyperframes/packages/cli/src/utils/" +
      "layoutAudit.ts, now in FINDING_SOURCE_FILES). Disposition: layoutInspector " +
      "converts visual severities to repair-pressure warnings (resilience policy): " +
      "they block clean acceptance early but may ship on the final rung, where " +
      "the degradation ledger records " +
      "published-degraded, never clean.",
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
  "recipeContract.ts",
  "pluginContract.ts",
  "assetRuntime.ts",
  "frameValidation.ts",
  "layoutInspector.ts",
  "directComposition.ts",
  "compositionRunner.ts",
  "sceneSlots.ts",
  // timeRamp's findings are prose-form today (no codes), but its errors flow
  // into direct validation — scanned so a future typed code cannot slip past.
  "timeRamp.ts",
  // The vendored HyperFrames layout/motion audit: its LayoutIssueCode union is
  // the closed world for the codes normalizeHyperframesIssue passes through
  // dynamically (they never appear as literals in our own engine sources).
  "../../vendor/hyperframes/packages/cli/src/utils/layoutAudit.ts",
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
