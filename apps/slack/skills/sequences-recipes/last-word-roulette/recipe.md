# last-word-roulette — locked sentence, final-word wheel, payoff snap

**What it is.** A hero headline whose sentence is locked while its final word
is a masked vertical roulette: the candidate words spin past twice in quick,
committed ticks that ease off, then the payoff word snaps in on a settle ease
with a small slot pop, an accent underline draws beneath it, and a soft glow
acknowledges the landing before releasing. The spin occupies ~1.3s before the
payoff locks at `settleSec`.

**When to declare it.** The brief positions the product against alternatives,
cycles through options, or builds to one decisive word — "everything becomes
___", "stop guessing, start ___", pricing/persona/verb roulettes, hook shots
that need a typographic signature, or a resolve shot that lands the thesis
word. The payoff landing is a natural PRIMARY moment: place a declared moment
at roughly `sceneStart + settleSec` with motionIntent "type-on" or "resolve".

**How to stage the shot around it.**
- Give the wheel its focal window: no competing motion from `settleSec - 1.5`
  until ~1s after the payoff (the pattern owns the eye through the snap).
- The sentence reads best as the scene's hero copy on a calm or slowly
  drifting camera; a whip INTO the scene works, a whip away before the payoff
  has ~1s of reading room does not.
- Pair naturally: a `timeRamp` dip at the payoff, a `gradeShift` warming at
  the landing, or a cut whose continuity anchor is the underlined word.
- The candidates should escalate toward the payoff (weakest first); keep all
  four words in one register (verbs with verbs, nouns with nouns).

**Slots.** `lead` (the locked sentence prefix), `word1..word3` (the candidate
ticks), `payoff` (the word that stays), `accent` (a `var(--…)` brand token for
the wheel/underline/glow), `settleSec` (seconds after scene start when the
payoff locks — leave ≥1s of scene after it).
