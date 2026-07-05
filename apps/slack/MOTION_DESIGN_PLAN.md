# MOTION_DESIGN_PLAN — "produced, not just choreographed" (2026-07-05)

**Mandate:** add real SaaS motion-design *texture* — light, trails, draws,
letter energy, color moves — on top of the now-hardened choreography layer
(the 2026-07-04/05 WS1–WS7 + fallback-elimination work is COMPLETE, audited,
and recorded in ROADMAP's 2026-07-05 sections; its planning docs are retired). Everything here follows the house architecture: typed
declarations → deterministic host compile → static + browser QA →
degrade-never-veto. **No new fallback classes, no author-model hand-tuning,
no vocabulary explosion.**

Prerequisite state assumed throughout: pacing gate (`pacingAudit.ts`),
eye-trace QA (`eyeTrace.ts`), exit discipline (WS4), transition-coherence +
penalty weights (WS6), moment-visible thumbnails (WS7), rows/select top-up,
source rescue rung, shared planning cache.

---

## 0. Why this plan — the evidence

Look at the latest published paid run (`codexfix-probe-2`, 2026-07-05,
`.data/projects/codexfix-probe-2/build/thumbs/`):

- `m01-red-flash.png` — a **fully black frame** at a primary moment. The
  "red alert flash" was authored so low-contrast it reads as nothing.
- `m05-chat-streaming.png` — a competent chat panel, but dark-on-dark, no
  light response visible at thumbnail scale, floating in a void.
- `m09-stat-resolve.png` — the best frame of the film: bloom + material +
  count-up. This is the *floor* the rest of the film should meet.

The choreography machinery (cuts, camera, beats, pacing, eye-trace) is now
sound. What separates these frames from a produced SaaS launch film is the
**garnish layer real motion designers add in After Effects**: light sweeps
over surfaces, glow that answers a payoff, stroke draw-ons, letter-level
text energy, echo/trail on fast movers, and a disciplined 2–3-transition
language with motion blur. That layer is what this plan builds — as host
compiled, seek-safe runtimes, never as author-side GSAP freestyle.

### The one-line architecture rule for every feature below

> If the effect can be applied **automatically by the host** from data the
> storyboard already carries (moments, beats, cuts, camera), do that — zero
> new planner options, zero new author paperwork, zero new failure classes.
> Only when the effect is a *creative choice* does it get a typed knob, and
> then it is ONE optional field on an EXISTING concept, never a new system
> the model must learn.

---

## 1. Technique research — what each one actually is, and what we already have

Each entry: the real-world technique, its job in SaaS motion design, and the
honest status in our codebase.

### 1.1 Light sweep + glow (After Effects: CC Light Sweep + Glow)

A band of light travels diagonally across a surface (logo, card, button),
reading as a specular highlight moving over glass/metal; usually paired with
a soft glow bloom on the swept element. In SaaS explainer work this is the
standard "premium surface" tell, applied at brand resolves and hero payoffs
— analysis of SaaS launch videos found sweep/shine moves in the large
majority of high-performing examples (see the Figma-style "sweep" pattern in
[trydemotion's SaaS motion breakdown](https://trydemotion.com/blog/figmotion-animation-tool)
and the light-sweep + glow finishing pass taught in
[SaaS Explainer Animation, Skillshare](https://www.skillshare.com/en/classes/saas-explainer-animation-from-ui-design-to-motion-in-after-effects/1147733669)).

**Status here:** the cinema kit has the *static* half — `.material` sheen
gradient, `.bloom` halo, key lights — and deliberately no motion
(`sequences-cinema.v1.css` header: "no animation… motion stays in the one
paused GSAP timeline"). The moving sweep and the answering glow pulse do
not exist. **Gap: the light never *moves*.** This is buildable with pure
transform/opacity (a masked gradient band translated across the surface) —
no CSS filters anywhere near the world element.

### 1.2 Echo / motion trails (After Effects: Echo)

AE's Echo composites time-offset copies of a layer behind it, so a fast
mover leaves a decaying trail. In UI films it sells speed on short violent
motion (a card flying to its slot, a whip) without true motion blur.

**Status here:** nothing. The closest mechanism is the cut runtime's
**bridge clones** (`bridgeElement` in `sequences-cuts.v1.js`) — a clone that
flies an interpolated rect path, updated per-frame as a pure function of a
proxy. Echo is a natural extension: N extra ghost clones evaluated at
`ease(p − kδ)` with decaying opacity. **Creative decision: echo is a
host-applied garnish on fast flights (morph bridges, letter assembly), NOT a
planner option.** A general "echo anything" knob would be overused into
noise and multiplies DOM cost; trails on slow movers are mud.

### 1.3 Trim paths (After Effects: shape-layer Trim Paths)

Animating a stroke's drawn-on percentage — lines, underlines, borders,
connectors, chart lines "draw" themselves. The signature "engineered"
detail of modern SaaS motion.

**Status here:** *partially built and proven*: `compileChart` and
`compileProgress` already animate `strokeDashoffset` on SVG strokes — that
IS trim paths. **Gap: it's trapped inside chart/progress components.** The
technique's best uses elsewhere: (a) an underline/rule that draws under a
headline word, (b) hairline connector lines between camera-world stations
that draw as the camera travels, (c) a border trace around a hero card at
its payoff. All are the same `strokeDashoffset` fromTo we already ship.

### 1.4 Better text effects — typewriter and bounce

Kinetic-typography practice ([ikagency guide](https://www.ikagency.com/graphic-design-typography/kinetic-typography/),
[GSAP text patterns](https://gsapify.com/gsap-text-animations/)): the
workhorse reveals are (1) typewriter, (2) per-character/word **staggered
rise** (fade + small y, ease-out, 40–60ms/char), (3) **scale pop** with a
single overshoot for energetic headlines. The craft consensus matches our
existing doctrine: one well-timed effect beats ten simultaneous ones, and
overshoot ("bounce") is an accent, not a house style.

**Status here:** typewriter exists and is hardened (`type` beat + caret +
reading-time floors in `pacingAudit`). Word-stream exists (`stream`).
**Gap: no letter/word-level stagger machinery at all** — headlines are
authored as plain HTML with whatever entrance the author writes, so hero
copy always arrives as a block. There is also no typed home for hero copy:
headlines are not components, so beats/moments/camera can't address them.

### 1.5 Echo word split (scattered letters → converge into the word, with trails)

A hero-title assembly: letters start displaced (each along one axis —
rectilinear), travel to their resting positions, trails decaying behind
them; the word "locks" with a settle. This is a composite of 1.2 + 1.4:
per-letter stagger + echo ghosts. Reads as a *logo/thesis resolve* gesture.

**Status here:** nothing. Needs deterministic letter splitting (spans that
do not reflow the measured layout), a **seeded** scatter (seed = beat id
hash, so renders are byte-identical), and the echo garnish. **Creative
decision: cap at ONE per film, allowed only on a `primary` moment's
headline** — this is the film's loudest text gesture; twice is kitsch.

### 1.6 Background shape morph (expanding shape recolors the scene)

A shape (circle from a press point, or a full-height panel) expands to
become the new background color — Material Design's "container transform" /
color-wipe idiom. In SaaS films it marks a *state change of the story*
(problem→solution) without a cut.

**Status here:** nothing moving — but the **color script already exists**
statically: cinema-kit grades (`.grade-cold` → `.grade-warm`) give each
scene a fixed tint. **Gap: a grade can only change AT a cut.** The strongest
use of this technique is exactly a mid-scene grade shift: the payoff beat
lands and warmth spreads from it. That framing (an animated *grade
transition*, not a free-color paint tool) keeps the model inside the
existing color-arc doctrine.

### 1.7 Zoom in / zoom out around dense frames ("zoom in, type, zoom out")

The operator's report: with many assets on screen, they want the camera to
dive to the typing surface, hold while it types, and return. Standard
push-in/pull-back grammar — the failure is ours, not the technique's.

**Status here — root cause analysis:** the rig CAN do this (`push-in` →
`hold`/`drift` → `pull-back` with `blend`), but the planner must choreograph
**three coordinated segments whose window must exactly cover the beat +
reading floor**, against the camera-segment budget (`auditPacing` caps full
moves/scene) and the energy audit. GLM reliably fails multi-segment
arithmetic (the whole lesson of the host-owned timing re-base — ROADMAP
2026-07-05). So the clean
dive-and-return almost never survives planning. **Fix: make it ONE typed
move (`dive`) whose hold window the HOST derives from the overlapping beat**
— vocabulary that *replaces* three error-prone segments with one intent.

### 1.8 Playful pops (bouncy kick on appearance)

Scale-from-small with a single overshoot (`back.out`-family), often +2–4°
rotation settle — the "energetic cascade" in Premiere/AE tutorial canon
([pixflow](https://pixflow.net/blog/captivating-text-in-minutes-master-eye-catching-animations-in-premiere-pro/)).
Correct for *compact acknowledgment surfaces*: toasts, badges, chips,
avatar stacks, count seals — not windows or tables.

**Status here:** `seqMicrobounce` exists (~3% overshoot, used by toggle
knobs); the prompt currently *bans* bounce as default ("overshoot is a
rare, explicitly playful exception"). **Keep the ban as house style; give
the exception a typed, capped home** instead of hoping the author freestyles
it tastefully.

### 1.9 Blur during transitions + motion blur on cuts

Whip-pans hide the cut inside blur; zoom transitions blur through the seam
([In Depth Cine on editing transitions](https://www.indepthcine.com/videos/editing-transitions),
[invisible cuts](https://medium.com/applaudience/invisible-cuts-a-new-trend-in-video-editing-b858ede7403d)).

**Status here:** *mostly built*: zoom-through/inverse-zoom cuts tween
`filter: blur(18px)` on scene wrappers; whips drive a 7px backdrop-filter
on the `.seq-whip-lens` overlay (deliberately off the world element — the
preserve-3d landmine). **Gap: directional (swipe) cuts have NO blur** — they
are the one seam that still reads "CSS slide" instead of "camera move".

### 1.10 Extended ease keyframes

Multi-phase custom curves (AE keyframe-velocity craft): hesitate-then-
commit, arrive-overshoot-settle. **Status here: largely done** — the
`seq*` library is exactly this (8 curated curves, registered in every
composition). **Gap: no overshoot ease tuned for pops** (`seqMicrobounce`'s
3% is a toggle-knob whisper; a pop needs ~8–12% with a faster attack). Add
1–2 curves, not a zoo.

### 1.11 The 3-transition language (operator's proposal — adopted)

Film-editing craft says a film keeps 1–2 signature transitions
([StudioBinder's transitions guide](https://www.studiobinder.com/blog/types-of-editing-transitions-in-film/));
WS6 already audits style-zoo boundaries. Today the planner chooses from
**ten** cut styles (hard, 4 directionals, zoom-through, inverse-zoom,
flash-white, object-match, shape-match). That's a real "too many options"
problem: the model demonstrably scatters across the palette (probe-cutfix-3
used 5 styles in 4 boundaries).

**Adopted with one amendment:** the planner-facing language becomes **three
named transitions + `hard`** (hard is punctuation, not a transition):

1. **`swipe`** — directional family. Covers both requested variants: the
   velocity-matched pan we already compile (the "camera pan to next scene"
   IS this — exit and entry share one axis at matched velocity), and a new
   **cover variant** where a palette-colored panel wipes across the frame,
   fully covering it at the swap instant (the "object swipes the camera"
   form — a *natural wipe*; see [Backstage on wipes](https://www.backstage.com/magazine/article/video-transitions-75727/)).
   Both now carry directional motion blur (§1.9 gap).
2. **`morph`** — the existing shape-match dual-bridge (different elements,
   rhyming silhouettes), unchanged mechanics, WS1's honesty ladder intact.
3. **`match`** — object-match when one element literally crosses the seam;
   otherwise a hard cut whose incoming focal target must land where the eye
   already is (we can *enforce* that now — it's exactly `eye_trace_jump`
   with a tighter threshold). A match cut is "a simple cut, but the
   component is similar" — the eye-trace audit is what makes it real.

Zoom-through, inverse-zoom, and flash-white **stay executable** (compile
targets, degrade paths, the fallback film, old cached storyboards) but leave
the planner prompt and schema enum. Morph's degrade target changes from
zoom-through to **swipe along the axis from the outgoing focal center to
the incoming focal center** — a degraded morph then still carries the eye
(better eye-trace than a zoom), and the shipped film shows only the
3-transition language. Every degrade keeps WS1's honest-paperwork rewrite.

---

## 2. What I disagree with / creative decisions (owner asked for them)

1. **Echo as a general effect — rejected.** Applied broadly it's the #1
   "template video" tell and a DOM-cost multiplier. It ships as automatic
   garnish on exactly two fast movers: morph bridge flights and the one
   word-assembly gesture. No planner knob.
2. **Bounce as a text house style — rejected; pop as a typed exception —
   adopted.** The smooth `power3/seqSettle` doctrine is correct for a
   premium register. Pops get a typed, capped, compact-kind-only home.
3. **"Only 3 transitions" — adopted**, plus `hard` (a film with zero plain
   cuts is its own tell), with old styles kept as internal compile/degrade
   targets so nothing existing breaks.
4. **Background shape morph — narrowed to an animated grade shift.** A
   free "recolor the background any color" knob fights the frame.md palette
   contract and the contrast gate. As a grade transition it *strengthens*
   the existing color-arc doctrine and stays inside validated tokens.
5. **Zoom in/out — treated as a vocabulary bug, not a motion bug.** We fix
   it by collapsing the three-segment dive choreography into one typed move
   with host-derived timing (the "host owns arithmetic" philosophy from the
   fallback-elimination pass), not by loosening framing audits.
6. **Light sweep — automatic first, optional second.** The host applies the
   hero sweep at moments it can prove (primary payoff, logo/CTA resolve).
   The planner gets only a `style:"sweep"` variant on the existing
   `highlight` beat. Models over-order garnish when it's a menu item;
   automatic application keeps taste host-owned.
7. **Addition the operator didn't ask for: draw-on connectors on camera
   worlds** (§1.3b). Cheap (existing trim-path compile), uniquely ours
   (nobody's SaaS-ad camera travels a world with hairline circuitry drawing
   itself toward the next station), and it *aids* eye-trace: the drawn line
   literally points where the camera goes next.

---

## 3. Workstreams

Order of build: **MD1 → MD5 → MD2 → MD3 → MD4 → MD6.** MD1 (transition
language) is prompt/schema surgery with the highest option-overload payoff;
MD5 kills the operator's top functional complaint; MD2 is the FX substrate
MD3/MD4 reuse; MD6 is garnish. Sizes: S (hours), M (a day).

Shared plumbing note for all: new injected passes go through the existing
injection-anchor machinery in `directComposition.ts` / `compositionRunner.ts`
— **the time-wrap rewrite stays LAST** (`test/timeRamp.test.ts` guards it).
Any storyboard schema field ⇒ storyboard cache `contract` bump (v10→v11 once,
for the whole plan — land the schema fields together even if compiles land
incrementally). Any inspector-semantics change ⇒ `QA_CACHE_VERSION` 7→8.
Every new runtime bind query gets its linkedom mirror in `kitMarkupAudit.ts`.

### MD1 — The 3-transition language: `swipe` / `morph` / `match` (+ `hard`) (M)

**Where:** `cutContract.ts` (style enum + resolution), `sequences-cuts.v1.js`
(cover variant + directional blur), `cutDiscovery.ts` (discovery emits the
new names), `compositionRunner.ts` (degrade rewrites), WS6's
`auditCutCoherence` (trivially satisfied after this), `prompts/
planning-director.md` §"Typed boundary cuts", storyboard schema.

**Approach:**
1. **Vocabulary mapping, not a rewrite.** The schema accepts
   `swipe` (+ required `axis: left|right|up|down`, optional `cover: true`),
   `morph`, `match`, `hard` — and continues to accept every legacy name
   (normalized at parse: `cut-right`→swipe/right, `shape-match`→morph,
   `object-match`→match, zoom/flash→accepted-but-undocumented). Old cached
   storyboards and the fallback film replay byte-identically.
2. **`swipe` cover variant.** In `bindDirectional`, when `cover` is set:
   a full-frame panel (in the existing `overlayLayer`, colored
   `var(--accent)`-derived from the frame tokens, `data-layout-ignore`)
   enters along the axis ahead of the outgoing scene's exit, fully covers
   the frame for 2–4 frames spanning `atSec` (the swap hides under it —
   the *invisible cut* mechanic), and exits revealing the incoming scene.
   Pure transform + opacity on an overlay child; the existing exit/entry
   scene tweens stay (they're what the panel reveals).
3. **Directional blur on swipes.** Reuse the whip-lens pattern: a
   backdrop-filter lens in the overlay layer ramps 0→~6px→0 across
   `exitSec+entrySec` (sine in/out, proxy-driven — the exact
   `makeWhipBlur` shape). Never a filter on scene wrappers for directionals
   (they can contain perspective'd orbit scenes; the zoom cuts' existing
   wrapper filter stays as-is — grandfathered, boundary-only).
4. **`match` = object-match ∪ disciplined hard.** With both focal parts
   declared and bindable → the existing object-match bridge. With
   `focalPartIn` only (or geometry that can't bridge) → compiles as `hard`
   BUT the boundary gets a tightened eye-trace budget (~20% of frame
   diagonal instead of 38%) so "match" is a *promise the QA enforces*, and
   the WS1 honest-paperwork pass records which form executed.
5. **Morph degrade retarget.** `degradeMismatchedShapeHintCuts` +
   `rewriteDegradedCutStoryboard` + the runtime's `shapeMatchAudit` degrade
   path all retarget to `swipe` whose axis is computed from the two focal
   centers (fallback: right). The measured-numbers repair finding from WS1
   is unchanged.
6. **Prompt surgery.** The cuts section teaches exactly four words and when
   each earns its place (swipe = movement/continuation; morph = one thing
   *becomes* another; match = same subject either side; hard = register
   break), plus "pick ONE signature transition and repeat it; morph/match
   are premium — at most one or two per film."

**Tricky:**
- The cover panel must be ignored by: framing-coverage sampling, eye-trace
  boundary inventory (sample outgoing gaze *before* panel entry — WS
  item 16 already samples pre-exit), near-blank detection at the covered
  instant, and WS4's stale-asset audit (`data-layout-ignore` +
  `data-sequences-runtime-cut` already exempt runtime artifacts — verify,
  don't assume).
- Thumbnails/temporal-judge frames must never sample inside the covered
  window (WS7's capture logic + the judge's before/mid/after triples —
  extend the existing "before the outgoing cut window" exclusion to include
  the cover span).
- `cutDiscovery` currently upgrades only hard/directional boundaries to
  shape-match; its output should now *say* `morph`. Its aspect cap and
  one-per-film rule are unchanged.
- Bump `QA_CACHE_VERSION` (eye-trace threshold change for `match`) and the
  storyboard contract (new fields). `test/cutShapeMatch.browser.test.ts`
  gains: cover swipe covers (pixel-sample mid-boundary), degraded morph
  compiles as swipe, legacy names normalize.

### MD5 — `dive`: one typed move for zoom-in→act→zoom-out (M)

**Where:** `cameraContract.ts` (move enum, resolver, `auditCameraEnergy`),
`sequences-camera.v1.js` (compile), `pacingAudit.ts` (dive-aware holds),
`componentContract.ts` (beat window lookup), prompt camera section.

**Approach:**
1. Schema: `{ move:"dive", toPart:"...", startSec, durationSec,
   zoom?: 1.0–1.4 }` — durationSec is the TOTAL window (in + hold + out).
2. **The host owns the internal arithmetic** (lever-10 philosophy): the
   resolver finds beats/interactions targeting `toPart` (or inside it)
   whose windows overlap the dive; hold = union of those windows plus the
   pacing reading floor for any `type`/`swap` text among them, clamped
   inside the window; push-in ≈ min(0.8s, 25% of window), pull-back
   mirrors, both returning **exactly to the pre-dive camera state** (the
   compiler already tracks `state` — end the dive on the saved state, so
   the surrounding path is undisturbed). No overlapping beat → resolver
   warning + degrade to `push-in` with blend (never veto).
3. Runtime compile: three proxy tweens from the saved state to the
   part-framed state (existing `frameState` with `PART_MARGIN_RATIO`) and
   back — `seqSettle` in, `seqSwoosh`/`power3.inOut` out. A dive with
   zoom ≥1.3 counts as the film's high-energy peak in `auditCameraEnergy`.
4. Audits: `auditPacing` treats the dive hold as development time (it IS
   the "hold ≠ freeze" pattern — the typed beat develops the held frame);
   the camera-segment budget counts a dive as ONE full move; the arrival
   framing/coverage audits sample the dive landing like any fit-zoom
   landing (they already iterate landings — the dive lands twice: on the
   part and back on the prior frame; sample both).
5. Prompt: replace the "zoom in, type, zoom out" choreography advice with
   one sentence: *"to work inside a dense frame, declare `dive` at the
   surface you're about to change — the host times the hold to your beat
   and returns the camera itself."*

**Tricky:**
- Interaction overlap: like `orbit`, forbid a dive window overlapping a
  cursor interaction's screen-space approach unless the interaction targets
  the dive part (the resolver has the interaction windows — deterministic
  check, findings-retry).
- In-flight-move conflicts (WS item 10): the dive's pull-back is a framing
  change — the pacing outcome-hold rule must see it (it will, once dive
  segments resolve to ordinary full moves in the resolved path).
- Time ramps: a ramped scene stretches viewer time — hold math must run in
  content time but the reading floor is viewer time; convert via the
  resolved warp exactly like `pacingAudit` does today.
- Tests: resolver unit tests (hold derivation, no-beat degrade, state
  return) + a browser test beside `cameraDepth.browser.test.ts` proving
  out-of-order seek determinism and exact return-to-state.

### MD2 — `sequences-fx.v1` — the host FX runtime: sweep, glow pulse, draw-on, echo (M, the substrate)

One new versioned runtime file + island, injected like the other four, and
one host pass that *derives* its plan — mostly with no planner involvement.

**Where:** new `engine/fxContract.ts` + `templates/sequences-fx.v1.js`;
injection in `compositionRunner.ts` (before the time-wrap, after
components); `cinemaKit.ts` docs; `kitMarkupAudit.ts` mirror;
`componentContract.ts` (`highlight` style variant).

**Approach — four compilers, all pure functions of timeline time:**
1. **`sweep`** (§1.1): appends a masked gradient band child
   (`overflow:hidden` wrapper honoring the target's border-radius,
   `data-layout-ignore`, band at ~30° with `--cinema-sheen`-derived color)
   and tweens its `x` across the target over ~0.7s, `seqGlide`. Zero
   filters, zero layout impact.
2. **`glow-pulse`**: finds the scene's `.bloom` (or the target's nearest
   bloom) and tweens opacity 1→~1.6×→1 over ~0.9s. If none exists, appends
   a kit bloom behind the target sized from its rect. Enhancement-only.
3. **`draw`** (§1.3): generalized trim-path — target an SVG stroke child
   (kit provides `.fx-underline` / `.fx-connector` markup patterns: an SVG
   line/path in a wrapper) and compile the `strokeDashoffset` fromTo we
   already ship in `compileChart`. Underline width follows the word wrapper
   (same rule the layout doctrine already teaches for static underlines).
4. **`echo`** (§1.2): a garnish flag other systems set — for a morph
   bridge, 2 extra ghost clones sampling the SAME interpolated path at
   `ease(max(0, p − k·0.06))`, opacity 0.35/0.18, killed at flight end
   (they ride the existing per-frame `onUpdate`, so they are free of new
   seeks and deterministic by construction).

**Who orders FX — the taste ladder:**
- **Automatic (host-derived, no planner surface):** at each `primary`
  moment whose evidence is a payoff class (`count`/`press`/`set-state`
  completion, logo/CTA resolve — the classifier exists in
  `storyboardMoments`), schedule `sweep` + `glow-pulse` on the bound
  element at evidence-settle time (WS7 already computes "after evidence
  settles"). Cap: ≤1 sweep per scene, ≤3 per film, none in scene 1's first
  second. Deterministic, so film:demo/fallback get it too — free proof
  path.
- **Planner opt-in (one field, existing beat):** `highlight` beat gains
  `style: "ring" | "sweep" | "underline"` (default ring = today's
  behavior). `underline` requires the kit underline markup — covered by
  the same childless-target top-up philosophy as rows: if the SVG child is
  absent, inject the kit pattern host-side (never burn a paid repair).
- **Author opt-in (markup only):** `.fx-connector` paths on camera worlds;
  the fx pass times each connector's draw to end at the camera's arrival
  at its `data-fx-toward="<region>"` station (arrival seconds come from
  the resolved camera plan). Pure decoration; absent attribute = no tween.

**Tricky:**
- FX artifacts must be invisible to: framing coverage (decoration counts
  toward nothing — `data-layout-ignore` is already excluded; verify for the
  appended bloom), WS4 stale-asset overlap, contrast AA (the sweep band
  crosses text momentarily — sample times are beat/moment anchored, so keep
  sweeps off `atSec` sample instants by scheduling at settle+ε; state this
  in the fx pass, don't rely on luck).
- The temporal judge: a sweep IS a visible change — it can *satisfy* a
  `moment_static_frame` only if the moment's claimed change is the payoff
  itself, so schedule sweeps strictly AFTER the evidence's own change
  window (settle time, not atSec).
- Injection anchor: island + script + `SequencesFx.compile(tl, root)`
  between components and interactions compile calls; time-wrap stays last.
- Tests: `test/fxRuntime.browser.test.ts` — sweep determinism under
  out-of-order seek, glow pulse returns to rest, draw honors reduced
  timeline, echo ghosts die at flight end; linkedom audit test for the
  underline top-up.

### MD3 — Text FX: the `headline` component + letter machinery (M)

**Where:** `componentContract.ts` (new kind + `type` beat `style` field),
`sequences-components.v1.js` (letter split + three compilers),
`sequences-components.v1.css` (headline kit class), `pacingAudit.ts`
(reading floors — already keyed on typed copy), prompt component section,
`kitMarkupAudit.ts`.

**Approach:**
1. **New catalog kind `headline`** (23rd): kit markup
   `<h1 class="cmp cmp-headline" data-component="headline" data-part="...">
   <span class="cmp-text" data-cmp-text>Final copy</span></h1>`. Beats:
   `type`, `swap` (+ universals). This gives hero copy what product
   surfaces already have: a stable `data-part` (camera `track-to-anchor`,
   `dive`, cuts, and moments can address it), beat-bound moments, and the
   pacing reading floor *automatically* (floors key off typed copy — a
   headline `type` beat is typed copy).
2. **`type` beat gains `style: "typewriter" | "rise" | "pop" | "assemble"`**
   (default typewriter — zero change to existing plans):
   - `rise`: deterministic split into per-word (>6 words) or per-letter
     spans; staggered fromTo `{opacity:0, y:"0.35em"}` → rest, 45ms
     stagger, `power3.out` — the "refined reveal" (§1.4).
   - `pop`: per-word scale 0.6→1 with the new `seqPop` ease (MD6), 55ms
     stagger. Compact-kind + headline only.
   - `assemble` (§1.5, the echo word split): per-letter; each letter's
     start = rest + rectilinear offset on ONE axis, from a seeded PRNG
     (`hashCode(beat.id + index)` — byte-identical renders); letters
     travel with `seqSettle`, echo garnish (MD2) on the 3 longest-travel
     letters; ends with a single whole-word `glow-pulse`. **Hard cap: one
     `assemble` per film, `headline` kind only, must coincide with a
     `primary` moment** — enforced as a deterministic storyboard finding
     (findings-retry), degrading extras to `rise` on the final attempt
     (degrade-never-veto).
3. **Split mechanics (the load-bearing detail):** split at compile time in
   the runtime (browser + linkedom see the same DOM only if the audit
   mirrors the split — mirror it), spans `display:inline-block;
   white-space:pre`, wrapper keeps its authored text metrics (no width
   change: transforms only), and the **final state is the authored text** —
   authored-final-state doctrine intact. Overflow/AA audits measure the
   wrapper as before.
4. Reading floors: `assemble`/`rise`/`pop` are typed copy — floors apply
   unchanged; `assemble` additionally requires its moment to hold ≥1.2s
   after lock (it's a resolve gesture, not a drive-by). One pacing-audit
   branch.

**Tricky:**
- Kerning: per-letter inline-blocks drop ligatures/kerning pairs — accept
  for display headlines (real kinetic type does), but split per-WORD
  whenever the copy is a sentence (>6 words rule) so body-adjacent text
  never gets letter-chopped.
- `swap` on a split headline: run swap on the wrapper (the split spans
  belong to the old text and leave with it) — add a regression test.
- The WS7 thumbnail visibility walk must see mid-assembly letters as "not
  settled" — capture at lock time (the beat's endSec), which the existing
  "after evidence settles" rule already produces from the beat window.
- Tests: `test/textFx.browser.test.ts` — deterministic scatter (two
  compiles, identical positions), out-of-order seek, floors fire, the
  one-per-film cap degrades, linkedom mirror.

### MD4 — Animated grade shift: the background color morph (S/M)

**Where:** storyboard schema (optional scene field
`gradeShift: { atSec, toGrade: "cold"|"neutral"|"warm"|"noir",
fromPart?: string }`), resolved + validated beside `timeRamp` in
`compositionRunner.ts`; compiled in the fx runtime (MD2); cinema-kit CSS
gains per-grade *panel* colors; prompt cinematography section.

**Approach:**
1. The scene starts with its authored grade class. At `atSec`, an oversized
   `border-radius:50%` panel (kit-owned child, `data-layout-ignore`,
   z-index between background texture and midground content, color =
   the target grade's wash color at panel opacity) **scales from ~0 at
   `fromPart`'s center** (default: frame center) to cover the frame over
   ~0.9s, `seqSwoosh`; at cover instant the fx runtime `timeline.set`s the
   scene's grade class attribute to the target (CSS custom props snap —
   key light/bloom tints change under the panel) and the panel fades to
   the target grade's steady wash opacity. Transform + opacity only.
2. Validation (deterministic, findings-retry): `atSec` inside the scene
   window with ≥1.2s remaining (a shift needs aftermath); at most one per
   scene, two per film; the shift must coincide (±0.5s) with a declared
   moment (it IS a story state change — and that makes it bindable moment
   evidence, a new evidence class beside `component`). Violations degrade:
   drop the shift with a warning on final attempts, never veto.
3. Contrast: text AA is measured at sample times — a mid-scene wash change
   means AA must be sampled after `atSec` too. The layout inspector's
   sample scheduler gains the shift instant + settle as a sample point
   (bump `QA_CACHE_VERSION`). Wash opacities stay in the grades' existing
   near-transparent range, so AA failures should be rare-but-caught.
4. Prompt: one paragraph in the color-script bullet: *"a scene may carry
   one `gradeShift` — the story's temperature turning at a payoff —
   expanding from the element that caused it."*

**Tricky:**
- Grade classes own the scene wrapper's `::after` (the static wash); the
  panel must be an element, not a pseudo, and the class swap must not
  double-wash during the crossover (set the class at full cover, fade the
  panel into exactly the incoming wash's steady state).
- `fromPart` binding is locked-storyboard paperwork → give it the same
  deterministic reconciliation as cut focal parts in
  `applyDeterministicSourceRepairs` (exact id / unique semantic candidate),
  so it never burns a paid repair.
- The fallback film should adopt one grade shift (cold→warm at its payoff)
  as the deterministic proof path.

### MD6 — Playful pops + the two missing eases (S)

**Where:** `sequences-camera.v1.js` EASES table + `SEQUENCES_EASES` in
`cameraContract.ts`; `sequences-components.v1.js` (`open` beat style);
prompt ease-library + motion-doctrine sections.

**Approach:**
1. New eases: **`seqPop`** — back-out-family, ~10% overshoot, fast attack
   (`c1≈1.7` scaled), for pops; **`seqStamp`** — arrive 4% oversized and
   settle down (scale-in overshoot for seals/badges landing). Registered
   everywhere like the existing eight; prompt gets one line each with the
   same "choose by intent" framing.
2. **`open` beat gains `style: "pop"`** for compact kinds only (toast,
   button, stat-card, toggle, progress-ring, avatar-stack, badge-class) —
   compiles scale 0.6→1 `seqPop` + opacity, replacing the default
   panel-open gesture; the WS3-era complexity/dedupe audits already cap
   beat density, and a deterministic rule caps `pop`-styled opens at 2 per
   scene (excess degrades to default style with a warning).
3. Prompt motion doctrine keeps the ban and names the exception precisely:
   *"overshoot lives ONLY in typed `pop`/`seqPop` on compact acknowledgment
   surfaces; never on windows, tables, text blocks, or cameras."*

**Tricky:** `dedupeRedundantBeats` collapses a press-under-cursor to
`set-state` — a popped open under a cursor press should keep the pop
(entrance) since press ≠ open; add one dedupe test. The support-map degrade
(the unsupported-beat parse degrade) must treat an unsupported `style` as
style-dropped, not beat-dropped.

---

## 4. Vocabulary budget — proof this doesn't overwhelm the agent

| Surface | Before | After | Delta |
|---|---|---|---|
| Cut styles (planner-facing) | 10 | 4 (`swipe`+axis+cover, `morph`, `match`, `hard`) | **−6** |
| Camera moves | 10 | 11 (`dive`) — but dive *replaces* 3-segment choreography | +1 name, −2 segments per use |
| Component kinds | 22 | 23 (`headline`) | +1 |
| Beat kinds | 14 | 14 (zero new kinds) | 0 |
| Beat fields | — | `type.style`, `open.style`, `highlight.style` (each optional, defaulting to today) | +3 optional enums |
| Scene fields | `timeRamp` | + `gradeShift` (optional) | +1 |
| Eases | 8 | 10 | +2 |

Everything else (sweeps at payoffs, glow pulses, echo trails, blur on
swipes, connector draws) is **host-automatic** — the planner never sees it,
the author at most places optional kit markup. Net planner-facing surface
*shrinks*.

## 5. Global tricky things (read before coding any of it)

1. **The world element NEVER carries a CSS filter** — sweeps/echo/panels
   are transform+opacity children or overlay-layer lenses. Ancestor filters
   flatten preserve-3d too: never add a filter to a scene wrapper that can
   host an orbit (the zoom cuts' existing wrapper blur is grandfathered
   and boundary-only; don't extend that pattern).
2. **Every FX value is a pure function of timeline time** — fromTo with
   `immediateRender:false` for later-owned properties, seeded PRNG for any
   "random", per-frame reads only inside existing onUpdate proxies.
3. **Degrade-never-veto** for every volunteered effect: unsupported style →
   default style; hopeless morph → axis-derived swipe; extra assemble →
   rise; unplaceable gradeShift → dropped with warning. Only brief-required
   intents stay blocking. Honest paperwork (WS1 pattern) records every
   degrade in STORYBOARD.md / outline / manifest.
4. **Nothing new for the author to hand-write**: islands, runtimes, compile
   calls, kit CSS are host-injected; missing kit children (underline SVG,
   headline text slot) get the rows-style deterministic top-up. A paid
   attempt must never die on FX paperwork.
5. **Audit blind spots are the failure mode**: every overlay/panel/ghost is
   `data-layout-ignore` + runtime-marked; coverage, eye-trace, stale-asset,
   near-blank, AA, thumbnails, and the temporal judge each need one
   explicit exemption-or-sample decision per feature (listed per-WS above).
   Bump `QA_CACHE_VERSION` once per landed inspector change.
6. **Fallback film + film:demo remain the deterministic proof path** — they
   should *adopt* one automatic sweep, one grade shift, and swipe cuts, so
   the golden gate proves the new runtimes on every CI pass; if a new audit
   fires on them, the audit is wrong.
7. **linkedom mirrors the browser** (`kitMarkupAudit.ts`) for every new
   bind query: headline split, underline SVG, fx targets.
8. `apps/slack` isolation: everything is copied-in, nothing imported from
   paused apps; templates stay v1-edited-in-place (per-job copies freeze
   old behavior) except the NEW `sequences-fx.v1.js`.

## 6. Verification ladder

Per workstream: unit tests (`npx vitest run --root ../..
apps/slack/test/<file>` from `apps/slack`), then the standard gate:

```powershell
npm run typecheck --workspace @sequences/slack
npm run test --workspace @sequences/slack
npm run film:demo --workspace @sequences/slack
npm run sequence:check --workspace @sequences/slack -- --demo --no-mcp --format both
```

Then paid probes with briefs that *demand* each shape (fresh `--job-id`
per retry; `SLACK_SEQUENCES_ALLOW_DETERMINISTIC_FALLBACK=0` on probes):
- after MD1+MD5: a dense-UI brief with "type into the palette mid-scene"
  (assert: one dive, ≤2 transition styles film-wide, cover swipe visible
  in thumbnails — LOOK at them);
- after MD2+MD3: a hero-headline brief ("make the product name land hard")
  (assert: one assemble on a primary moment, sweep at the payoff, floors
  hold, zero new fallback classes in `planning/author-run.json`);
- after MD4+MD6: a problem→solution brief (assert: gradeShift at the turn,
  AA clean after the shift, pops only on compact kinds).

Finish = update ROADMAP.md/CLAUDE.md (+ `.claude/skills/slack-map`
locally) → commit → `bash scripts/publish-public.sh "<msg>"` →
`railway up` (publish ≠ deploy) → `/healthz` → `ready`.

---

## Appendix — research sources

- [SaaS Explainer Animation: From UI Design to Motion in After Effects (Skillshare)](https://www.skillshare.com/en/classes/saas-explainer-animation-from-ui-design-to-motion-in-after-effects/1147733669) — light sweep + glow as the standard finishing pass.
- [trydemotion — SaaS motion graphics: shape layers, bounce, sweeps](https://trydemotion.com/blog/figmotion-animation-tool) — the Figma-style sweep-as-cleanup pattern and its prevalence.
- [GSAPify — GSAP text animation patterns](https://gsapify.com/gsap-text-animations/) and [IK Agency — Kinetic Typography guide (2026)](https://www.ikagency.com/graphic-design-typography/kinetic-typography/) — stagger timing (40–60ms/char), rise/pop/typewriter taxonomy, restraint doctrine.
- [Pixflow — text animation craft in Premiere](https://pixflow.net/blog/captivating-text-in-minutes-master-eye-catching-animations-in-premiere-pro/) — the energetic cascade (scale-from-zero + overshoot + stagger).
- [StudioBinder — The Ultimate Guide to Editing Transitions](https://www.studiobinder.com/blog/types-of-editing-transitions-in-film/) and [Backstage — Video Transitions guide](https://www.backstage.com/magazine/article/video-transitions-75727/) — match cuts, natural/object wipes, consistency of transition language.
- [In Depth Cine — Editing Transitions](https://www.indepthcine.com/videos/editing-transitions) and [Medium — Invisible Cuts](https://medium.com/applaudience/invisible-cuts-a-new-trend-in-video-editing-b858ede7403d) — hiding the cut inside blur/cover frames (the swipe-cover mechanic).
- After Effects effect references: CC Light Sweep (Generate effects), Echo (Time effects), Trim Paths (shape-layer attribute) — the AE names the operator's technique list maps to.
