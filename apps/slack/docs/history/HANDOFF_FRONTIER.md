# HANDOFF_FRONTIER.md — make the films feel designed

You are the strongest model we have access to, working in `apps/slack`
(Sequences for Slack — a Slack bot that turns a launch brief into a short
motion-design film; hackathon deadline **Jul 13 2026**). This handoff
deliberately does NOT prescribe a solution. It gives you the problem, the
evidence, one hypothesis we've considered, and the boundaries. **Diagnose
first, form your own thesis, then build.** We are explicitly asking for
judgment a generic model can't supply.

## The problem

The pipeline is *correctness*-complete and *taste*-poor. Films publish
reliably, every mechanical failure class has a gate or a deterministic
repair — and the result still doesn't feel like a human motion designer made
it. In the owner's words: *"I'm not too happy with the animations/motion
design currently being produced. It's kinda awkward."* and (about
model-drawn visuals) *"the assets in our current probes are kinda… shit."*

The maintainers' diagnosis so far (verify or refute it): every motion
PRIMITIVE exists — typed cuts (`swipe`/`morph`/`match`), a spatial camera rig
with 11 move verbs, component beats, FX, grade shifts, spring eases, time
ramps — but the *composition* of those primitives per scene is chosen ad-hoc
by a Flash-tier planner (GLM) and a Flash-tier author (DeepSeek). The gates
police floors and ceilings (density, pacing, framing, eye-trace), not
*phrasing* — nothing owns anticipation→action→settle relationships, motif
repetition, or why THIS move follows THAT one. Taste is currently an
emergent property of two cheap models. It doesn't emerge.

## Look before you touch (the evidence)

- **Watch films.** `npm run film:demo --workspace @sequences/slack` builds
  the model-free golden film (the quality CEILING of the deterministic
  path); `VERIFY_RENDER=1` gets you an MP4. Then build 2–3 live films with
  `npm run sequence:check --workspace @sequences/slack -- ...` (paid; uses
  OpenRouter) and *watch them next to a real Linear/Stripe/Apple launch
  video*. Write down, in motion-design language, what reads as amateur.
- **Past probes.** Job dirs under `.data/projects/<id>/` keep everything:
  `planning/` (concept, storyboard, attempts, findings, sentinel-run.json),
  `STORYBOARD.md`, QA artifacts, thumbnails, `motion-plan.json`,
  temporal-evidence strips. [PROBE_LOG.md](PROBE_LOG.md) and ROADMAP.md's
  2026-07-0x audit sections carry the incident history and the owner's
  running complaints.
- **What was already tried for texture:**
  [MOTION_DESIGN_PLAN.md](MOTION_DESIGN_PLAN.md) (MD1–MD6 shipped: FX
  runtime, `dive`, letter machinery, pops, grade shifts) — it added garnish
  and the films still feel assembled. That gap between "more texture" and
  "feels designed" is precisely the target.
- **The machinery map:** the `slack-map` skill, or CLAUDE.md's feature
  state; contracts live in `src/engine/*Contract.ts`; the Recipe Studio
  (`npm run studio`) can gate + preview any motion pattern you author
  against the REAL production gate, zero tokens (`npm run studio:canvas`).
- **The new asset layer** ([ASSETS.md](ASSETS.md)): pre-built parametric
  assets with real spring physics (`motionSpring.ts`) — the same
  quality-is-a-library-property philosophy, applied to visuals. Consider
  whether it generalizes.

## One hypothesis we've considered (yours to adopt, adapt, or discard)

A host-owned **choreography phrase library**: ~10 multi-second motion
phrases ("reveal-and-settle", "cascade-then-punch", "type-and-commit",
"orbit showcase") — each a typed, gate-proven coordination of camera + beats
+ FX + springs with exact anticipation/action/settle timing — plus a
deterministic mapper from storyboard intent to phrases, so per-scene motion
stops being freestyled. Rationale: it moves taste off the cheap models the
way plugins moved geometry and recipes moved proven fragments. Known risks:
phrase sameness across films; the mapper becoming a second planner. If you
have a better thesis (a motion-grammar critic, a timing-relationship gate,
learned-from-reference constraint sets, something else), argue it in a short
plan doc first, then build.

## Boundaries (hard)

- **Gates are never loosened** — SENTINEL.md's placement tree governs every
  new obligation; register finding classes in `src/engine/sentinel.ts`.
- **Deterministic under seek, byte-stable under strip-and-reinject** — all
  motion compiles into the one paused timeline; no `Math.random`/`Date.now`
  in anything the host injects.
- **Attempt economy** (owner mandate): nothing you add may burn paid
  attempts on mechanical misses — degrade-never-veto, deterministic repair
  first, and the live-probe policy in [PROBE_LOG.md](PROBE_LOG.md) applies
  to every probe you run.
- **Prompt bytes are budgeted** (`test/promptBudget.test.ts`) — prefer
  host-computed structure over prose instruction.
- **Isolation:** never import `apps/forge`/`apps/sequences`; never modify
  `packages/*`. New env flags follow `sentinelFlags.ts` + SENTINEL.md's
  table; engine seams you touch update `studio/INTEGRATION.md`.
- **Proof:** the full verify ladder (CLAUDE.md §Verification), a green
  `film:demo`, and at least one paid live probe judged by WATCHING the
  film, not by the gates passing. "Better" must be arguable frame-by-frame
  against the before.

## Definition of done

A reviewer who watches a before/after pair should say the after looks
*directed* — motivated moves, phrased timing, one motif carried through —
without being told which is which. Leave behind: the code, tests, a short
doc of your thesis + what you rejected and why, and updated
CLAUDE.md/ROADMAP.md state so the next agent isn't confused about what's
done.
