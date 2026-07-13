# metric-odometer — masked digit columns, wave landing, accent lock

**What it is.** A hero metric built from real odometer machinery: each digit
of the final figure is a masked vertical column that spins through a full
digit cycle and decelerates onto its target, landing in a left-to-right wave.
Separators (`.`, `,`, `:`) stay printed while digits move. The lock is
acknowledged by an accent underline sweep, one committed scale pop, and a soft
glow that releases. The label reads beneath the number the whole time, so the
claim has context while the digits are still rolling.

**When to declare it.** The brief's proof moment: an uptime/accuracy
percentage, revenue or user count, latency figure, a multiplier — any single
number the film hangs its credibility on. The landing is a natural PRIMARY
moment: place a declared moment at roughly `sceneStart + settleSec` with
motionIntent "count" or "resolve". Prefer it over a plain `count` beat when
the number IS the shot (a `stat-card` count suits dashboards; this suits hero
typography).

**How to stage the shot around it.**
- Give the roll its focal window: the columns spin from `settleSec - 1.2` to
  `settleSec`; no competing motion there, and ≥1s of read after the lock.
- Calm or slowly drifting camera; a push-in that lands just before the lock
  pairs beautifully. Avoid whipping away before the underline finishes.
- The number reads as the scene's hero copy — keep other copy small and
  out of the center band.
- `value` is at most 6 characters with one separator; put units in `suffix`
  ("%", "ms", "x") and currency/sign in `prefix` ("$", "+").

**Slots.** `value` (the final figure — digits roll, separators print),
`label` (what it measures), `prefix`/`suffix` (static accent-colored unit
marks), `accent` (a `var(--…)` brand token), `settleSec` (seconds after scene
start when the last digit locks; leave ≥1s of scene after it).
