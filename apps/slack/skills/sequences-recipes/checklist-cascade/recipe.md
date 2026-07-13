# checklist-cascade — rows cascade in, ticks land in rhythm, bar completes

**What it is.** A four-row checklist that performs its own completion: rows
slide in as a quick cascade, then each row is ticked off in a steady rhythm —
an accent disc pops behind a checkmark that DRAWS on with a real stroke while
the row's copy brightens — and when the last tick lands, a completion bar
sweeps under the title. The drawn strokes and the tick rhythm are the
signature; a model-authored imitation reliably ships instant checkmarks and
uneven timing.

**When to declare it.** Briefs about finishing, coverage, or accumulation:
onboarding steps completed, a launch/release checklist, "everything you
shipped this quarter", a feature list where each item lands as *done*, setup
flows ("connect, configure, invite, ship"). The final tick is a natural
PRIMARY moment: place a declared moment at roughly `sceneStart + settleSec`
with motionIntent "resolve" or "set-state".

**How to stage the shot around it.**
- The ticks run from `settleSec - 2.0` to `settleSec`; keep the camera calm
  through that window (a slow drift or a gentle push-in works; ticks read as
  the scene's rhythm section).
- Escalate the items: weakest first, the thesis item fourth — the last tick
  is the payoff.
- Keep row copy short and parallel (verb-first reads best: "Threads
  summarized", "Video rendered").
- Pairs naturally with a `timeRamp` dip on the final tick or a cut whose
  continuity anchor is the completed list.

**Slots.** `title` (the list's claim), `item1..item4` (row copy, ticked in
order — all four required), `accent` (a `var(--…)` brand token), `settleSec`
(seconds after scene start when the LAST checkmark finishes; leave ≥1s of
scene after it).
