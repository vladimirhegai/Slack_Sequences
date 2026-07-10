/**
 * Reap stranded headless QA browsers.
 *
 *   npm run browsers:clean --workspace @sequences/slack           # orphans only (safe anytime)
 *   npm run browsers:clean --workspace @sequences/slack -- --all  # also kill live Sequences-tagged browsers
 *
 * "Orphan" = a headless Chromium whose launching process is gone (a killed
 * test worker, an interrupted sequence:check). Those accumulate silently —
 * this reaps them plus their temp profile dirs. `--all` additionally kills
 * Sequences-tagged browsers whose parent is still alive; only use it when no
 * gate/test/render is deliberately running.
 */
import { sweepOrphanBrowsers } from "../src/engine/browserLifecycle.ts";

const includeLive = process.argv.includes("--all");
const killed = await sweepOrphanBrowsers({
  includeLive,
  log: (line) => process.stdout.write(`  ${line}\n`),
});
process.stdout.write(
  killed === 0
    ? `No stranded headless browsers found${includeLive ? "" : " (pass --all to also kill live Sequences-tagged ones)"}.\n`
    : `Reaped ${killed} headless browser process(es).\n`,
);
