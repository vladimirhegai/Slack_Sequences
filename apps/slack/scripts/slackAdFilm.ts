/**
 * Golden Slack ad film — the hackathon hero demo as a model-free fixture.
 *
 * Proves the executable-cut vertical slice AND the host cinematography kit end
 * to end on the real engine gate: typed boundary cuts (directional carry,
 * flash reset, object-match handoff, inverse-zoom arrival) compiled by the
 * deterministic cut runtime; lit `.material` surfaces, key lights, blooms, and
 * a graded color arc (cold fragmentation world → neutral Slack calm → warm
 * payoff) from `sequences-cinema.v1.css`; component state choreography;
 * masked-rise typography; sequential back-half reveals; and an intentional
 * closing hold. Runs through submit_composition → validation → checkpoint →
 * browser QA → previews, then writes a temporal evidence report (frame strip +
 * cut triptychs) under build/qa/temporal.
 *
 * Usage:
 *   npm run film:demo --workspace @sequences/slack            # thumbnails + temporal report
 *   VERIFY_RENDER=1 npm run film:demo --workspace @sequences/slack  # + MP4
 */
import fs from "node:fs";
import { initializeProject, projectDirFor } from "../src/engine/projectTemplates.ts";
import { McpClient } from "../src/engine/mcpClient.ts";
import { resolveCutPlan } from "../src/engine/cutContract.ts";
import { resolveTimeRampPlan } from "../src/engine/timeRamp.ts";
import { cinemaKitStyleTag } from "../src/engine/cinemaKit.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { reportTemporalEvidence } from "../src/engine/temporalInspector.ts";

const dir = projectDirFor("slack-ad-film");
try {
  fs.rmSync(dir, { recursive: true, force: true });
} catch {
  // Windows can hold the directory handle itself (an explorer/shell CWD);
  // emptying its contents gives the same clean-fixture guarantee.
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(`${dir}/${entry}`, { recursive: true, force: true });
  }
}
initializeProject(dir, { name: "Sequences for Slack", brandName: "Sequences", seedScreenshot: false });

const storyboard: DirectScene[] = [
  {
    id: "fragments",
    title: "Launch day lives in six apps",
    purpose: "Make the familiar tool sprawl visible and personal",
    incomingIdea: "A launch is assembled across scattered work surfaces",
    foreground: "Editorial copy left; a cold field of lit app windows accumulating and bleeding off frame right",
    background: "Cold graphite set, top-left key light, cold grade",
    cameraIntent: "Static editorial frame; the accumulation is the motion",
    startSec: 0,
    durationSec: 5,
    blueprint: "compose",
    rules: ["spring-pop-entrance"],
    outgoingCut: "The whole cluttered frame is carried left at matched velocity into the overload",
    cut: { version: 1, style: "cut-left" },
    continuityAnchor: "Leftward momentum of the window field",
  },
  {
    id: "overload",
    title: "The sprawl becomes noise",
    purpose: "Escalate fragmentation into a felt problem",
    incomingIdea: "The same surfaces, now shouting over each other",
    foreground: "A giant unread counter with a cold bloom; notification toasts stacking on the right",
    background: "Same cold set, tighter and darker",
    cameraIntent: "One slow front-half push on the inner world, then stillness",
    startSec: 5,
    durationSec: 4.5,
    blueprint: "dataviz-countup",
    rules: ["counting-dynamic-scale"],
    outgoingCut: "A white flash resets the register — Slack as the organizing surface",
    cut: { version: 1, style: "flash-white" },
    continuityAnchor: "The reset flash lands on the calm thread",
  },
  {
    id: "thread",
    title: "One thread already has everything",
    purpose: "Show the real Slack conversation becoming the source of truth",
    incomingIdea: "Calm: the launch thread, composing itself message by message; the brand gold enters with the bot",
    foreground: "A hero Slack channel surface under a center key light; messages arrive, a /sequences command is typed",
    background: "Neutral grade, quiet vignette behind the single lit surface",
    cameraIntent: "Locked frame; the component does the acting",
    startSec: 9.5,
    durationSec: 6,
    blueprint: "cursor-ui-demo",
    rules: ["discrete-text-sequence"],
    outgoingCut: "The bot's preview thumbnail travels out of the card and becomes the film player",
    cut: {
      version: 1,
      style: "object-match",
      focalPartOut: "preview-frame",
      focalPartIn: "film-frame",
    },
    continuityAnchor: "The preview frame is the carried object",
  },
  {
    id: "film",
    title: "From shipped to shown",
    purpose: "Deliver the payoff: the thread became a launch film",
    incomingIdea: "The carried preview lands as a full player with a filmstrip, warm grade",
    foreground: "Split: claim copy left, bloomed hero player with filmstrip right",
    background: "Warm grade, gold accent carrying the brand",
    cameraIntent: "Static split; the player's own playback is the motion",
    startSec: 15.5,
    durationSec: 5,
    blueprint: "device-surface-showcase",
    rules: ["stat-bars-and-fills"],
    outgoingCut: "Pull back and arrive at the closing lockup",
    cut: { version: 1, style: "inverse-zoom" },
    // Deterministic speed-ramp proof: slow motion as the payoff title and
    // filmstrip land (17.1s), repaid at speed before the inverse-zoom exit.
    timeRamp: { version: 1, atSec: 17.1, slowTo: 0.4, holdSec: 0.5, recoverSec: 0.9 },
    continuityAnchor: "The gold accent resolves into the lockup",
    spatialIntent: {
      version: 1,
      focalPart: "film-frame",
      composition: "Player-dominant split with editorial copy rail",
      relationships: ["filmstrip sits directly under the player it summarizes"],
    },
  },
  {
    id: "lockup",
    title: "Sequences for Slack",
    purpose: "Close on a restrained brand payoff and hold",
    incomingIdea: "Everything resolves to one still, warmly lit lockup",
    foreground: "Centered mark over a gold bloom, lockup, one-line promise",
    background: "Warm near-black, no texture competition",
    cameraIntent: "Dead still after 22s — the hold is the statement",
    startSec: 20.5,
    durationSec: 3.5,
    blueprint: "titlecard-reveal",
    rules: ["svg-path-draw"],
    outgoingCut: "Hold to black",
  },
];

const cutPlan = JSON.stringify(resolveCutPlan(storyboard));
const timePlan = JSON.stringify(resolveTimeRampPlan(storyboard));

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <title>Sequences for Slack</title>
  <script src="gsap.min.js"></script>
  <script src="sequences-cuts.v1.js"></script>
  <script src="sequences-time.v1.js"></script>
  __CINEMA_KIT__
  <style>
    * { box-sizing: border-box; margin: 0; }
    html, body { width: 1920px; height: 1080px; overflow: hidden; background: #0e0b13; }
    body { color: #f6f3f9; font-family: Inter, sans-serif; }
    #root {
      --canvas: #0e0b13; --surface: #1f1929; --surface-2: #2a2138;
      --text: #f6f3f9; --muted: #a99fb8; --accent: #ffc24d;
      --cold: #9fb3d9; --alert: #e05a5a;
      --border: #3a3050; --space-safe: 72px;
      --cinema-key: rgba(159, 179, 217, 0.12);
      --cinema-bloom: rgba(255, 194, 77, 0.18);
      position: relative; width: 1920px; height: 1080px; overflow: hidden;
      background: radial-gradient(1300px 900px at 68% 30%, #181226 0%, #0e0b13 62%);
    }
    .scene { position: absolute; inset: 0; padding: var(--space-safe); opacity: 0; }
    .grid-bg {
      position: absolute; inset: 0; pointer-events: none;
      background-image: linear-gradient(rgba(169,159,184,.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(169,159,184,.045) 1px, transparent 1px);
      background-size: 96px 96px;
    }
    .eyebrow {
      font-family: "JetBrains Mono", monospace; font-size: 21px; font-weight: 700;
      letter-spacing: .18em; text-transform: uppercase;
    }
    .display { font-family: "Archivo Black", sans-serif; letter-spacing: -.02em; }
    .mono { font-family: "JetBrains Mono", monospace; }
    .muted { color: var(--muted); }
    /* Masked-rise typography: the mask clips, the inner span rises. */
    .line { display: block; overflow: hidden; padding-bottom: .06em; margin-bottom: -.06em; }
    .line b { display: block; font-weight: inherit; }

    /* Shot 1 — fragments (cold world) */
    #fragments { display: grid; grid-template-columns: 730px minmax(0,1fr); gap: 56px; align-items: center; }
    .frag-copy { display: flex; flex-direction: column; gap: 34px; }
    .frag-copy .eyebrow { color: var(--cold); }
    .frag-copy h1 { font-size: 126px; line-height: .98; }
    .frag-tools {
      font-family: "JetBrains Mono", monospace; font-size: 21px; color: var(--muted);
      letter-spacing: .08em;
    }
    .frag-field { position: relative; width: 100%; height: 100%; }
    .appwin {
      position: absolute; width: 400px; border-radius: 12px; overflow: hidden;
    }
    .appwin .bar {
      display: flex; align-items: center; gap: 11px; padding: 13px 16px;
    }
    .appwin .dot { width: 15px; height: 15px; border-radius: 5px; }
    .appwin .name { font-size: 17px; font-weight: 700; color: var(--text); }
    .appwin .badge {
      margin-left: auto; min-width: 28px; padding: 3px 8px; border-radius: 999px;
      background: var(--alert); color: #fff; font-size: 14px; font-weight: 700; text-align: center;
    }
    .appwin .body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
    .appwin .row-line { display: flex; align-items: center; gap: 10px; }
    .appwin .txt { font-size: 15px; color: var(--muted); white-space: nowrap; overflow: hidden; }
    .appwin .txt strong { color: #d9d2e6; font-weight: 600; }
    .appwin .ln { height: 9px; border-radius: 4px; background: rgba(169,159,184,.16); }

    /* Shot 2 — overload (cold world, pushed in) */
    #overload { display: grid; grid-template-columns: minmax(0,1.15fr) 560px; gap: 72px; align-items: center; }
    .load-world { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 34px; }
    .unread-wrap { position: relative; }
    .unread-num {
      font-family: "Archivo Black", sans-serif; font-size: 400px; line-height: .9;
      color: #e8ecf6; letter-spacing: -.03em;
    }
    .unread-cap { font-size: 36px; color: var(--muted); max-width: 700px; margin-top: 30px; }
    .load-questions { display: flex; flex-direction: column; gap: 12px; margin-top: 18px; }
    .load-questions .q { font-family: "JetBrains Mono", monospace; font-size: 22px; color: var(--cold); }
    .toasts { display: flex; flex-direction: column; gap: 18px; justify-content: center; }
    .toast {
      display: flex; align-items: center; gap: 16px; padding: 20px 22px;
      border-radius: 14px;
    }
    .toast .dot { width: 17px; height: 17px; border-radius: 6px; flex: none; }
    .toast .t-copy { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .toast .t-title { font-size: 20px; font-weight: 700; }
    .toast .t-sub { font-size: 17px; color: var(--muted); }

    /* Shot 3 — thread (neutral calm; the gold enters here) */
    #thread { display: grid; align-content: center; justify-items: center; }
    .channel { width: 1240px; border-radius: 18px; overflow: hidden; }
    .ch-head { display: flex; align-items: center; gap: 14px; padding: 22px 30px; }
    .ch-name { font-size: 24px; font-weight: 800; }
    .ch-meta { font-size: 17px; color: var(--muted); margin-left: auto; font-family: "JetBrains Mono", monospace; }
    .msgs { display: flex; flex-direction: column; gap: 24px; padding: 30px; }
    .msg { display: flex; gap: 18px; }
    .avatar {
      width: 48px; height: 48px; border-radius: 11px; flex: none;
      display: grid; place-items: center;
      font-family: "Archivo Black", sans-serif; font-size: 21px; color: #17121f;
    }
    .m-body { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
    .m-head { display: flex; align-items: baseline; gap: 11px; }
    .m-name { font-size: 20px; font-weight: 800; }
    .m-time { font-size: 15px; color: var(--muted); font-family: "JetBrains Mono", monospace; }
    .m-text { font-size: 21px; color: #e2dbec; }
    .chip {
      display: inline-flex; align-items: center; gap: 8px; margin-top: 6px;
      padding: 9px 13px; border: 1px solid var(--border); border-radius: 9px;
      font-size: 16px; color: var(--muted); font-family: "JetBrains Mono", monospace;
      background: var(--surface-2); align-self: flex-start;
    }
    .bot-card {
      border-left: 3px solid var(--accent); background: var(--surface-2);
      border-radius: 0 12px 12px 0; padding: 18px 20px;
      display: grid; grid-template-columns: minmax(0,1fr) 340px; gap: 24px; align-items: center;
    }
    .bot-copy { display: flex; flex-direction: column; gap: 9px; }
    .bot-line { font-size: 20px; color: #e2dbec; }
    .bot-strong { font-weight: 800; color: var(--text); }
    .preview { /* the carried object */
      position: relative; width: 340px; height: 190px; border-radius: 12px; overflow: hidden;
      background: linear-gradient(135deg, #2a2138 0%, #181226 100%);
      border: 1px solid rgba(255,194,77,.35); display: flex; flex-direction: column; justify-content: flex-end;
      box-shadow: 0 18px 50px rgba(0,0,0,.5);
    }
    .preview .p-glow { position: absolute; inset: 0; background: radial-gradient(70% 90% at 30% 25%, rgba(255,194,77,.24) 0%, transparent 65%); }
    .preview .p-title { position: absolute; left: 8%; top: 15%; width: 55%; height: 13%; border-radius: 4px; background: rgba(246,243,249,.92); }
    .preview .p-sub { position: absolute; left: 8%; top: 34%; width: 38%; height: 7%; border-radius: 4px; background: rgba(169,159,184,.7); }
    .preview .p-strip { position: relative; display: flex; gap: 4%; padding: 4% 6%; }
    .preview .p-cell { flex: 1; height: 30px; border-radius: 5px; background: rgba(255,194,77,.3); border: 1px solid rgba(255,194,77,.45); }
    .preview .p-progress { position: relative; height: 6px; background: rgba(169,159,184,.25); }
    .preview .p-progress i { display: block; height: 100%; background: var(--accent); transform: scaleX(0); transform-origin: left; }
    .composer {
      margin: 0 30px 30px; border-radius: 13px; padding: 18px 20px;
      display: flex; align-items: center; gap: 13px;
    }
    .composer .cmd {
      font-family: "JetBrains Mono", monospace; font-size: 21px; color: var(--accent);
      white-space: nowrap; clip-path: inset(0 100% 0 0);
    }
    .composer .caret { width: 2px; height: 26px; background: var(--accent); opacity: 0; }
    .composer .send {
      margin-left: auto; width: 44px; height: 44px; border-radius: 10px; background: var(--accent);
      display: grid; place-items: center; color: #17121f; font-weight: 900; font-size: 19px;
    }

    /* Shot 4 — film (warm payoff) */
    #film { display: grid; grid-template-columns: 620px minmax(0,1fr); gap: 64px; align-items: center; }
    .film-copy { display: flex; flex-direction: column; gap: 30px; }
    .film-copy .eyebrow { color: var(--accent); }
    .film-copy h2 { font-size: 108px; line-height: .98; }
    .film-copy .sub { font-size: 31px; color: var(--muted); }
    .film-right { position: relative; display: flex; flex-direction: column; gap: 22px; align-items: stretch; }
    .player { /* landing object for the match cut */
      position: relative; width: 100%; height: 600px; border-radius: 16px; overflow: hidden;
      background: linear-gradient(135deg, #2a2138 0%, #150f1e 100%);
    }
    .player .f-glow { position: absolute; inset: 0; background: radial-gradient(70% 90% at 30% 25%, rgba(255,194,77,.2) 0%, transparent 65%); }
    .player .f-eyebrow { position: absolute; left: 7%; top: 15%; font-family: "JetBrains Mono", monospace; font-size: 21px; letter-spacing: .16em; color: var(--accent); }
    .player .f-title { position: absolute; left: 7%; top: 22%; font-family: "Archivo Black", sans-serif; font-size: 96px; letter-spacing: -.02em; }
    .player .f-rule { position: absolute; left: 7%; top: 46%; width: 340px; height: 6px; background: var(--accent); transform: scaleX(0); transform-origin: left; }
    .player .f-chrome {
      position: absolute; left: 0; right: 0; bottom: 0; padding: 20px 26px;
      display: flex; align-items: center; gap: 20px;
      background: linear-gradient(transparent, rgba(0,0,0,.6));
    }
    .player .f-time { font-family: "JetBrains Mono", monospace; font-size: 19px; color: var(--text); }
    .player .f-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(246,243,249,.22); overflow: hidden; }
    .player .f-bar i { display: block; height: 100%; background: var(--accent); transform: scaleX(0); transform-origin: left; }
    .strip { display: flex; gap: 18px; }
    .cell {
      flex: 1; height: 104px; border-radius: 12px;
      background: linear-gradient(135deg, #2a2138, #181226); position: relative; overflow: hidden;
    }
    .cell i { position: absolute; left: 12%; top: 26%; width: 50%; height: 15%; border-radius: 3px; background: rgba(255,194,77,.55); display: block; }

    /* Shot 5 — lockup (warm hold) */
    #lockup { display: grid; align-content: center; justify-items: center; text-align: center; gap: 32px; }
    .mark-wrap { position: relative; display: grid; place-items: center; }
    .mark {
      position: relative; width: 104px; height: 104px; border-radius: 24px; background: var(--accent);
      display: grid; place-items: center; color: #17121f;
      font-family: "Archivo Black", sans-serif; font-size: 50px;
      box-shadow: 0 24px 80px rgba(255,194,77,.28);
    }
    #lockup h3 { font-size: 96px; letter-spacing: -.02em; }
    #lockup .promise { font-family: "JetBrains Mono", monospace; font-size: 25px; color: var(--muted); }
    #lockup .rule { width: 240px; height: 3px; background: var(--border); transform: scaleX(0); }
  </style>
</head>
<body>
  <main id="root" data-composition-id="slack-ad" data-width="1920" data-height="1080" data-duration="24">

    <section id="fragments" class="scene clip grade-cold" data-scene="fragments" data-start="0" data-duration="5" data-track-index="1">
      <div class="grid-bg" data-layout-ignore></div>
      <div class="keylight keylight-tl" data-layout-ignore></div>
      <div class="frag-copy" data-layout-important>
        <div class="eyebrow" id="frag-eyebrow">Launch week &middot; T&minus;2 days</div>
        <h1 class="display" id="frag-h1"><span class="line" data-layout-allow-overflow><b data-layout-allow-overflow>Launch day</b></span><span class="line" data-layout-allow-overflow><b data-layout-allow-overflow>lives in</b></span><span class="line" data-layout-allow-overflow><b data-layout-allow-overflow>six apps.</b></span></h1>
        <div class="frag-tools" id="frag-tools">channels &middot; docs &middot; tickets &middot; decks &middot; dms &middot; drive</div>
      </div>
      <div class="frag-field" data-layout-allow-overlap data-layout-allow-overflow>
        <div class="appwin material" id="win-1" style="left:1%;top:3%">
          <div class="bar material-chrome"><span class="dot" style="background:#7aa7d9"></span><span class="name">Threads</span><span class="badge">12</span></div>
          <div class="body"><div class="txt"><strong>ana:</strong> is the hero copy final??</div><div class="ln" style="width:82%"></div><div class="ln" style="width:58%"></div></div>
        </div>
        <div class="appwin material" id="win-2" style="left:50%;top:-5%">
          <div class="bar material-chrome"><span class="dot" style="background:#c9a06a"></span><span class="name">Docs</span><span class="badge">4</span></div>
          <div class="body"><div class="txt"><strong>launch-copy-FINAL-v4</strong> &middot; edited 2m ago</div><div class="ln" style="width:88%"></div><div class="ln" style="width:64%"></div></div>
        </div>
        <div class="appwin material" id="win-3" style="left:14%;top:35%">
          <div class="bar material-chrome"><span class="dot" style="background:#8fb98b"></span><span class="name">Tickets</span><span class="badge">23</span></div>
          <div class="body"><div class="txt"><strong>LNCH-214</strong> Ship gating &middot; In review</div><div class="ln" style="width:76%"></div><div class="ln" style="width:84%"></div></div>
        </div>
        <div class="appwin material" id="win-4" style="left:58%;top:30%">
          <div class="bar material-chrome"><span class="dot" style="background:#b98bb1"></span><span class="name">Decks</span><span class="badge">2</span></div>
          <div class="body"><div class="txt">3 comments on <strong>slide 12</strong></div><div class="ln" style="width:66%"></div><div class="ln" style="width:78%"></div></div>
        </div>
        <div class="appwin material" id="win-5" style="left:3%;top:67%">
          <div class="bar material-chrome"><span class="dot" style="background:#d9d17a"></span><span class="name">Calendar</span><span class="badge">6</span></div>
          <div class="body"><div class="txt"><strong>Launch review</strong> moved to 4:30</div><div class="ln" style="width:72%"></div><div class="ln" style="width:60%"></div></div>
        </div>
        <div class="appwin material" id="win-6" style="left:48%;top:62%">
          <div class="bar material-chrome"><span class="dot" style="background:#d98b8b"></span><span class="name">Drive</span><span class="badge">9</span></div>
          <div class="body"><div class="txt"><strong>hero.mp4</strong> needs access</div><div class="ln" style="width:84%"></div><div class="ln" style="width:56%"></div></div>
        </div>
      </div>
    </section>

    <section id="overload" class="scene clip grade-cold" data-scene="overload" data-start="5" data-duration="4.5" data-track-index="1">
      <div class="grid-bg" data-layout-ignore></div>
      <div class="keylight keylight-tr" data-layout-ignore></div>
      <div class="load-world" data-camera-world data-layout-important data-layout-allow-overflow>
        <div class="unread-wrap">
          <span class="bloom" style="left:-160px;top:-180px;width:820px;height:820px" data-layout-ignore></span>
          <div class="unread-num" id="unread-num">12</div>
          <div class="unread-cap">unread across the tools that own your launch</div>
        </div>
        <div class="load-questions">
          <div class="q" id="q-1">&gt; where's the final cut?</div>
          <div class="q" id="q-2">&gt; who has the numbers?</div>
          <div class="q" id="q-3">&gt; is the video done?</div>
        </div>
      </div>
      <div class="toasts" data-layout-important>
        <div class="toast material" id="toast-1"><span class="dot" style="background:#7aa7d9"></span><span class="t-copy"><span class="t-title">Threads</span><span class="t-sub">7 new replies in #launch</span></span></div>
        <div class="toast material" id="toast-2"><span class="dot" style="background:#c9a06a"></span><span class="t-copy"><span class="t-title">Docs</span><span class="t-sub">"launch-copy-FINAL-v4" edited</span></span></div>
        <div class="toast material" id="toast-3"><span class="dot" style="background:#8fb98b"></span><span class="t-copy"><span class="t-title">Tickets</span><span class="t-sub">LNCH-214 moved to Done</span></span></div>
        <div class="toast material" id="toast-4"><span class="dot" style="background:#b98bb1"></span><span class="t-copy"><span class="t-title">Decks</span><span class="t-sub">3 comments on slide 12</span></span></div>
        <div class="toast material" id="toast-5"><span class="dot" style="background:#d98b8b"></span><span class="t-copy"><span class="t-title">Drive</span><span class="t-sub">"hero.mp4" needs access</span></span></div>
      </div>
    </section>

    <section id="thread" class="scene clip grade-neutral" data-scene="thread" data-start="9.5" data-duration="6" data-track-index="1">
      <div class="keylight keylight-c" data-layout-ignore></div>
      <div class="channel material-hero" id="channel" data-layout-important>
        <div class="ch-head material-chrome">
          <span class="ch-name">#launch-swift</span>
          <span class="ch-meta">14 members &middot; launch thread</span>
        </div>
        <div class="msgs">
          <div class="msg" id="msg-1">
            <span class="avatar" style="background:#b9d4a1">M</span>
            <span class="m-body">
              <span class="m-head"><span class="m-name">maya</span><span class="m-time">10:02</span></span>
              <span class="m-text">Design handoff is in &mdash; final frames attached.</span>
              <span class="chip">frames-v3.fig &middot; 2.4 MB</span>
            </span>
          </div>
          <div class="msg" id="msg-2">
            <span class="avatar" style="background:#a1c4d4">D</span>
            <span class="m-body">
              <span class="m-head"><span class="m-name">devon</span><span class="m-time">10:04</span></span>
              <span class="m-text">Ship confirmed. p99 latency 84ms, error budget green.</span>
            </span>
          </div>
          <div class="msg" id="msg-3">
            <span class="avatar" style="background:#d4b3a1">P</span>
            <span class="m-body">
              <span class="m-head"><span class="m-name">pri</span><span class="m-time">10:07</span></span>
              <span class="m-text">Can we get a launch film out of this thread before the announce?</span>
            </span>
          </div>
          <div class="msg" id="msg-bot">
            <span class="avatar" style="background:#ffc24d">S</span>
            <span class="m-body" style="min-width:0;flex:1">
              <span class="m-head"><span class="m-name">Sequences</span><span class="m-time">APP &middot; 10:09</span></span>
              <span class="bot-card">
                <span class="bot-copy">
                  <span class="bot-line"><span class="bot-strong">Building your launch film</span></span>
                  <span class="bot-line muted">4 scenes &middot; from 12 messages in this thread</span>
                </span>
                <span class="preview" id="preview-frame" data-part="preview-frame">
                  <span class="p-glow" data-layout-ignore></span>
                  <span class="p-title"></span>
                  <span class="p-sub"></span>
                  <span class="p-strip"><span class="p-cell" id="pc-1"></span><span class="p-cell" id="pc-2"></span><span class="p-cell" id="pc-3"></span><span class="p-cell" id="pc-4"></span></span>
                  <span class="p-progress"><i id="p-progress"></i></span>
                </span>
              </span>
            </span>
          </div>
        </div>
        <div class="composer inset-well">
          <span class="cmd" id="cmd">/sequences make the launch film</span>
          <span class="caret" id="caret"></span>
          <span class="send" id="send">&#9658;</span>
        </div>
      </div>
    </section>

    <section id="film" class="scene clip grade-warm" data-scene="film" data-start="15.5" data-duration="5" data-track-index="1">
      <div class="grid-bg" data-layout-ignore></div>
      <div class="keylight keylight-tr" data-layout-ignore></div>
      <div class="film-copy" data-layout-important>
        <div class="eyebrow" id="film-eyebrow">From the thread you already have</div>
        <h2 class="display" id="film-h2"><span class="line" data-layout-allow-overflow><b data-layout-allow-overflow>From shipped</b></span><span class="line" data-layout-allow-overflow><b data-layout-allow-overflow>to shown.</b></span></h2>
        <div class="sub" id="film-sub">One command. One film. In the channel.</div>
      </div>
      <div class="film-right">
        <span class="bloom" style="left:-8%;top:-12%;width:1100px;height:900px" data-layout-ignore></span>
        <div class="player material-hero" id="film-frame" data-part="film-frame" data-layout-important>
          <span class="f-glow" data-layout-ignore></span>
          <span class="f-eyebrow" id="ff-eyebrow">Swift 2.0 &middot; Launch</span>
          <span class="f-title" id="ff-title">Ship it. Show it.</span>
          <span class="f-rule" id="ff-rule"></span>
          <span class="f-chrome">
            <span class="f-time" id="ff-time">00:00 / 00:24</span>
            <span class="f-bar"><i id="ff-bar"></i></span>
          </span>
        </div>
        <div class="strip">
          <span class="cell material" id="cell-1"><i></i></span>
          <span class="cell material" id="cell-2"><i></i></span>
          <span class="cell material" id="cell-3"><i></i></span>
          <span class="cell material" id="cell-4"><i></i></span>
          <span class="cell material" id="cell-5"><i></i></span>
        </div>
      </div>
    </section>

    <section id="lockup" class="scene clip grade-warm" data-scene="lockup" data-start="20.5" data-duration="3.5" data-track-index="1">
      <div class="keylight keylight-c" data-layout-ignore></div>
      <div class="mark-wrap">
        <span class="bloom" style="left:-310px;top:-310px;width:720px;height:720px" data-layout-ignore></span>
        <div class="mark" id="lk-mark" data-layout-important>S</div>
      </div>
      <h3 class="display" id="lk-title" data-layout-important><span class="line" data-layout-allow-overflow><b data-layout-allow-overflow>Sequences for Slack</b></span></h3>
      <div class="rule" id="lk-rule"></div>
      <div class="promise" id="lk-promise">make a launch film from any thread</div>
    </section>
  </main>

  <script type="application/json" id="sequences-cuts">__CUT_PLAN__</script>
  <script type="application/json" id="sequences-time">__TIME_PLAN__</script>
  <script>
    window.__timelines = window.__timelines || {};
    var tl = gsap.timeline({ paused: true });

    // Scene windows (hard swaps; the cut runtime shapes the velocity around them).
    tl.set("#fragments", { opacity: 1 }, 0);
    tl.set("#fragments", { opacity: 0 }, 4.99);
    tl.set("#overload", { opacity: 1 }, 5);
    tl.set("#overload", { opacity: 0 }, 9.49);
    tl.set("#thread", { opacity: 1 }, 9.5);
    tl.set("#thread", { opacity: 0 }, 15.49);
    tl.set("#film", { opacity: 1 }, 15.5);
    tl.set("#film", { opacity: 0 }, 20.49);
    tl.set("#lockup", { opacity: 1 }, 20.5);
    tl.set("#lockup", { opacity: 0 }, 24);

    // ── Shot 1: fragments (masked-rise copy; the accumulation IS the development) ──
    tl.fromTo("#frag-eyebrow", { x: -26, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.15);
    tl.fromTo("#frag-h1 .line b", { y: "112%" }, { y: "0%", duration: 0.8, ease: "power4.out", stagger: 0.13 }, 0.3);
    var winRot = [-5, -6, 4, 6, 2, -3];
    var wins = ["#win-1", "#win-6", "#win-2", "#win-5", "#win-3", "#win-4"];
    for (var w = 0; w < wins.length; w += 1) {
      tl.fromTo(wins[w],
        { y: 46, rotation: winRot[w] * 2.2, opacity: 0 },
        { y: 0, rotation: winRot[w], opacity: 1, duration: 0.6, ease: "power3.out" }, 1.0 + w * 0.52);
      tl.fromTo(wins[w] + " .badge", { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "power3.out" }, 1.27 + w * 0.52);
    }
    tl.fromTo("#frag-tools", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 4.25);

    // ── Shot 2: overload (front-half push, count-up, sequential toasts, still hold) ──
    tl.fromTo("#overload [data-camera-world]", { scale: 1 }, { scale: 1.055, duration: 2.2, ease: "power1.inOut" }, 5.0);
    tl.fromTo("#overload .unread-wrap", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 5.15);
    var unreadEl = null;
    var unread = { v: 12 };
    tl.to(unread, {
      v: 47, duration: 1.8, ease: "power2.out",
      onUpdate: function () {
        if (!unreadEl) unreadEl = document.getElementById("unread-num");
        unreadEl.textContent = String(Math.round(unread.v));
        gsap.set(unreadEl, { scale: 1 + ((unread.v - 12) / 35) * 0.07, transformOrigin: "0% 100%" });
      }
    }, 5.5);
    var toasts = ["#toast-1", "#toast-2", "#toast-3", "#toast-4", "#toast-5"];
    for (var t = 0; t < toasts.length; t += 1) {
      tl.fromTo(toasts[t], { x: 48, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 5.4 + t * 0.6);
    }
    tl.fromTo("#q-1", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, 7.6);
    tl.fromTo("#q-2", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, 8.05);
    tl.fromTo("#q-3", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, 8.5);
    // 8.9–9.32: intentional stillness before the reset flash.

    // ── Shot 3: thread (the component acts: messages arrive, a command is typed) ──
    tl.fromTo("#channel", { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 9.62);
    tl.fromTo("#msg-1", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 10.15);
    tl.fromTo("#msg-2", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 10.95);
    tl.fromTo("#msg-3", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 11.75);
    tl.fromTo("#caret", { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, 12.35);
    tl.fromTo("#cmd", { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 1.0, ease: "steps(26)" }, 12.45);
    tl.fromTo("#send", { scale: 1 }, { scale: 0.92, duration: 0.09, ease: "power2.in" }, 13.55);
    tl.fromTo("#send", { scale: 0.92 }, { scale: 1, duration: 0.22, ease: "power3.out", immediateRender: false }, 13.64);
    tl.fromTo("#caret", { opacity: 1 }, { opacity: 0, duration: 0.1, ease: "none", immediateRender: false }, 13.6);
    tl.fromTo("#msg-bot", { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: "power3.out" }, 13.85);
    var pcs = ["#pc-1", "#pc-2", "#pc-3", "#pc-4"];
    for (var p = 0; p < pcs.length; p += 1) {
      tl.fromTo(pcs[p], { opacity: 0.15 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, 14.35 + p * 0.18);
    }
    tl.fromTo("#p-progress", { scaleX: 0 }, { scaleX: 1, duration: 0.95, ease: "power1.inOut" }, 14.3);

    // ── Shot 4: film (payoff; the player performs its own playback) ──
    tl.fromTo("#film-eyebrow", { x: -24, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 16.05);
    tl.fromTo("#film-h2 .line b", { y: "112%" }, { y: "0%", duration: 0.75, ease: "power4.out", stagger: 0.13 }, 16.2);
    tl.fromTo("#film-sub", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 17.05);
    tl.fromTo("#ff-eyebrow", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "none" }, 16.3);
    tl.fromTo("#ff-title", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: "power3.out" }, 16.45);
    tl.fromTo("#ff-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power2.inOut" }, 16.9);
    var timeEl = null;
    var playhead = { v: 0 };
    tl.fromTo("#ff-bar", { scaleX: 0 }, { scaleX: 0.8, duration: 3.4, ease: "none" }, 16.4);
    tl.to(playhead, {
      v: 19, duration: 3.4, ease: "none",
      onUpdate: function () {
        if (!timeEl) timeEl = document.getElementById("ff-time");
        var s = Math.floor(playhead.v);
        timeEl.textContent = "00:" + (s < 10 ? "0" + s : String(s)) + " / 00:24";
      }
    }, 16.4);
    var cells = ["#cell-1", "#cell-2", "#cell-3", "#cell-4", "#cell-5"];
    for (var c = 0; c < cells.length; c += 1) {
      tl.fromTo(cells[c], { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, 16.6 + c * 0.45);
    }
    // 19.9–20.26: still beat before the pull-back arrival.

    // ── Shot 5: lockup (land by 22s, then a dead-still intentional hold) ──
    tl.fromTo("#lk-mark", { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "power4.out" }, 20.75);
    tl.fromTo("#lk-title .line b", { y: "112%" }, { y: "0%", duration: 0.7, ease: "power4.out" }, 20.95);
    tl.fromTo("#lk-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power2.inOut" }, 21.45);
    tl.fromTo("#lk-promise", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 21.55);

    SequencesCuts.compile(tl, document.getElementById("root"));
    var __seqWarped = SequencesTime.wrap(tl); window.__timelines["slack-ad"] = __seqWarped;
    tl.seek(0);
  </script>
</body>
</html>`
  .replace("__CUT_PLAN__", cutPlan)
  .replace("__TIME_PLAN__", timePlan)
  .replace("__CINEMA_KIT__", () => cinemaKitStyleTag());

const client = await McpClient.connect(dir);
try {
  console.log("→ submit_composition");
  console.log(await client.callTool("submit_composition", {
    title: "Sequences for Slack — hero ad",
    html,
    storyboard,
  }));
  console.log("\n→ render_preview");
  console.log(await client.callTool("render_preview"));
  if (process.env.VERIFY_RENDER === "1") {
    console.log("\n→ render");
    console.log(await client.callTool("render", { quality: "draft" }));
  }
} finally {
  client.close();
}

console.log("\n→ temporal evidence");
const report = await reportTemporalEvidence(dir);
console.log(report.summary);
