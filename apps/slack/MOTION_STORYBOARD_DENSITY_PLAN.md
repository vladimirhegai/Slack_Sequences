# Motion Storyboard Density — Fable Handoff

> **Status (2026-07-02): IMPLEMENTED.** `StoryboardMomentV1` +
> evidence binding live in `src/engine/storyboardMoments.ts`; liveness and the
> moment floor are blocking publication errors; GLM runs as three bounded jobs
> (concept → beat expansion → continuity critic); `directOutline()` and the
> thumbnail strip are moment-led; `createVideo` names failed stages and labels
> the deterministic fallback explicitly (the fallback itself now carries 13
> evidence-bound moments). One deliberate deviation: the strict ≤2.6s moment
> interval applies to *declared* plans — synthesized (legacy) storyboards are
> governed by the blocking 3s activity-level quiet-gap check instead, because
> static tween extraction collapses loop-staggered beats to their first
> position. Verified via tests, `film:demo`, and `sequence:check` (including
> the exact 15s RADAR fallback path: 13 timestamped rows, `fallbackStage:
> "storyboard-plan"`). See ROADMAP.md for the feature map.

## Outcome

Make `/sequences` review like a motion-design storyboard, not a list of three
containers. A 15-second film must expose at least **7 meaningful visual moments**
in Slack, and the authored timeline must prove that each moment actually occurs.
Fable still chooses the concept, compositions, pacing, transitions, and motion
language.

## What is actually wrong

1. The reported `RADAR shipped / Release proof / Brand resolve` result is the
   exact model-free composition in `src/engine/fallbackComposition.ts`.
   `orchestrator.ts` catches every planning, authoring, parsing, and validation
   failure in one block and silently publishes that fallback. We cannot tell
   whether GLM timed out, returned an invalid plan, DeepSeek failed source
   generation, or QA rejected good-looking work.
2. The storyboard contract conflates **scene wrappers** with **storyboard
   moments**. Slack's `directOutline()` prints only `manifest.scenes`; typing a
   second phrase, changing UI state, revealing a metric, or traveling to another
   camera station remains invisible even when it exists.
3. Current gates explicitly allow 3 shots. For 15 seconds,
   `validateStoryboardPlan()` asks for only 4 "framings", and a camera move can
   satisfy the fourth. `motionDensity` findings are warnings, so they do not stop
   a slide-like result from publishing.
4. GLM currently makes one large storyboard decision. There is no separate
   concept pass, beat-expansion pass, or creative review of the implemented
   timeline.

Motion-design practice supports splitting these concerns: rough storyboards
describe the piece thumbnail by thumbnail, animatics establish what happens
where and when, and production boards cover camera changes and scenes. The
important unit is a meaningful changed state, not necessarily a hard cut.

## Build

### 1. Add `StoryboardMomentV1` beside scenes

Keep scenes as render containers, but add ordered, typed moments:

```ts
{
  id, sceneId, atSec, title,
  visualState,       // what the review frame shows
  change,            // what became meaningfully different
  motionIntent,      // type-on, UI state, camera arrival, cut, morph, etc.
  importance,        // primary | supporting
  evidence           // populated after authoring: tween/camera/interaction/cut
}
```

Use a duration-scaled floor of roughly one reviewable moment per 2.25 seconds,
with an explicit minimum of 7 for 12–18 second films. Do **not** require seven
cuts or seven complicated scenes: a typed word replacement, cursor arrival,
chart completion, camera landing, product state change, or logo resolve can be a
moment. Ambient drift alone cannot create extra storyboard moments.

### 2. Give GLM three bounded creative jobs

Do not ask GLM for full HTML.

1. **Concept/arc:** choose the visual thesis, narrative pressure, energy curve,
   recurring motif, and creative risks from the evidence and `frame.md`.
2. **Beat expansion:** turn that direction into scenes plus enough
   `StoryboardMomentV1` entries, cuts, camera paths, and interaction intentions.
3. **Continuity critic:** after DeepSeek authors source, inspect the resolved
   moment evidence, motion-density report, and temporal contact sheet; return a
   small list of creative repair directives. DeepSeek applies source patches;
   deterministic QA accepts or rejects them.

Each call gets a compact strict schema and its predecessor's artifact, not the
whole accumulated transcript. Cache each artifact independently. This spends
GLM on taste and judgment while staying comfortably below the effective
OpenRouter output ceiling and making a failed stage retryable.

### 3. Make liveness a publication contract

Before source authoring, reject plans that miss the moment floor, cluster all
moments at entrances, reuse the same visual state, or leave a long interval with
no planned development. After authoring:

- bind every moment to a cut, typed camera move, interaction, or explicitly
  positioned non-wrapper tween;
- render a thumbnail at every `atSec`;
- fail if a moment has no executable evidence or consecutive thumbnails are
  effectively unchanged;
- permit visual rests, but require subtle continuous motion during them and a
  meaningful beat at least every ~2.5 seconds (apart from a short final resolve);
- promote the existing quiet-gap/front-loading liveness findings from repair
  hints to blocking errors. Keep over-animation findings as warnings so Fable
  can preserve hierarchy.

### 4. Show the real storyboard in Slack

Change `directOutline()` and the thumbnail strip to use moments, grouped under
their parent scene. A successful 15-second result should visibly contain 7–10
timestamped rows/cards. Keep scene and blueprint metadata secondary; lead with
what visibly changes at each moment.

### 5. Stop disguising failures as creative output

Split the broad fallback boundary into named stages and record the provider,
attempt, finish reason, parse/validation errors, and cache usage. Retry only the
failed bounded artifact. If recovery is exhausted:

- label the Slack result clearly as a deterministic safe fallback;
- include the failed stage in the build trace;
- make the fallback obey the same 7-moment contract and show its internal beats;
- never cache a fallback under the key for a successful model artifact.

## Acceptance

- The exact 15-second RADAR request cannot publish a three-row storyboard.
- Every 12–18 second storyboard shows at least 7 visually distinct moments.
- Every displayed moment maps to executable timeline evidence and a preview.
- No unexplained interval longer than 2.5 seconds survives validation.
- Forced GLM timeout, malformed storyboard, truncated source, and QA failure
  identify different failed stages; fallback is explicit.
- Fable can vary shot count, moment count above the floor, rhythm, visual
  metaphor, camera strategy, and degree of complexity without changing schemas.

## Research notes

- [School of Motion's workflow](https://www.schoolofmotion.com/blog/guide-completing-motion-design-project)
  separates thumbnail storyboarding, timing animatic, and camera-change/scene
  production boards; its animatic communicates what happens, where, and when.
- [Adobe](https://helpx.adobe.com/uk/after-effects/using/animation-basics.html)
  defines keyframes as changed property states over time, supporting moments
  within a shot rather than equating every meaningful change with a cut.
- [TikTok's Creative Codes](https://ads.tiktok.com/business/library/TikTok_CreativeCodes_May2023.pdf)
  calls out scene changes, movement within assets, and text pop-ups as attention
  devices across the ad—not only at entrances.
- [Z.AI](https://docs.z.ai/guides/llm/glm-5.2) currently advertises a larger
  native GLM-5.2 maximum than our observed OpenRouter route. Treat provider
  telemetry and `finish_reason=length` as the operational truth; bounded staged
  calls remain the safer architecture.
