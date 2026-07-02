/**
 * Golden Slack ad film — the hackathon hero demo as a model-free fixture.
 *
 * Proves the executable-cut vertical slice end to end on the real engine gate:
 * typed boundary cuts (directional carry, flash reset, object-match handoff,
 * inverse-zoom arrival) compiled by the deterministic cut runtime, component
 * state choreography, a camera move that owns only its inner world, sequential
 * back-half reveals, and an intentional closing hold. Runs through
 * submit_composition → validation → checkpoint → browser QA → previews, then
 * writes a temporal evidence report (frame strip + cut triptychs) under
 * build/qa/temporal.
 *
 * Usage:
 *   npm run film:demo --workspace @sequences/slack            # thumbnails + temporal report
 *   VERIFY_RENDER=1 npm run film:demo --workspace @sequences/slack  # + MP4
 */
import fs from "node:fs";
import { initializeProject, projectDirFor } from "../src/engine/projectTemplates.ts";
import { McpClient } from "../src/engine/mcpClient.ts";
import { resolveCutPlan } from "../src/engine/cutContract.ts";
import type { DirectScene } from "../src/engine/directComposition.ts";
import { reportTemporalEvidence } from "../src/engine/temporalInspector.ts";

const dir = projectDirFor("slack-ad-film");
fs.rmSync(dir, { recursive: true, force: true });
initializeProject(dir, { name: "Sequences for Slack", brandName: "Sequences", seedScreenshot: false });

const storyboard: DirectScene[] = [
  {
    id: "fragments",
    title: "Launch day lives in six apps",
    purpose: "Make the familiar tool sprawl visible and personal",
    incomingIdea: "A launch is assembled across scattered work surfaces",
    foreground: "Editorial copy left; a field of abstract app windows accumulating right",
    background: "Aubergine-tinted graphite with a faint grid",
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
    foreground: "A large unread counter center-left; notification toasts stacking on the right",
    background: "Same set, tighter and darker",
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
    incomingIdea: "Calm: the launch thread, composing itself message by message",
    foreground: "A Slack-style channel surface; messages arrive, a /sequences command is typed",
    background: "Quiet vignette behind the single surface",
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
    incomingIdea: "The carried preview lands as a full player with a filmstrip",
    foreground: "Split: claim copy left, video player with filmstrip right",
    background: "Same set, one gold accent carrying the brand",
    cameraIntent: "Static split; the player's own playback is the motion",
    startSec: 15.5,
    durationSec: 5,
    blueprint: "device-surface-showcase",
    rules: ["stat-bars-and-fills"],
    outgoingCut: "Pull back and arrive at the closing lockup",
    cut: { version: 1, style: "inverse-zoom" },
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
    incomingIdea: "Everything resolves to one still lockup",
    foreground: "Centered mark, lockup, one-line promise",
    background: "Near-black aubergine, no texture competition",
    cameraIntent: "Dead still after 22s — the hold is the statement",
    startSec: 20.5,
    durationSec: 3.5,
    blueprint: "titlecard-reveal",
    rules: ["svg-path-draw"],
    outgoingCut: "Hold to black",
  },
];

const cutPlan = JSON.stringify(resolveCutPlan(storyboard));

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920, height=1080">
  <title>Sequences for Slack</title>
  <script src="gsap.min.js"></script>
  <script src="sequences-cuts.v1.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; }
    html, body { width: 1920px; height: 1080px; overflow: hidden; background: #100d14; }
    body { color: #f4f1f7; font-family: Inter, sans-serif; }
    #root {
      --canvas: #100d14; --surface: #1b1622; --surface-2: #241d2e;
      --text: #f4f1f7; --muted: #9b92a8; --accent: #ffc24d;
      --border: #322a3e; --space-safe: 72px;
      position: relative; width: 1920px; height: 1080px; overflow: hidden;
      background: radial-gradient(1200px 800px at 70% 30%, #17121f 0%, #100d14 60%);
    }
    .scene { position: absolute; inset: 0; padding: var(--space-safe); opacity: 0; }
    .grid-bg {
      position: absolute; inset: 0; pointer-events: none;
      background-image: linear-gradient(rgba(155,146,168,.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(155,146,168,.05) 1px, transparent 1px);
      background-size: 96px 96px;
    }
    .eyebrow {
      font-family: "JetBrains Mono", monospace; font-size: 20px; font-weight: 700;
      letter-spacing: .18em; text-transform: uppercase; color: var(--accent);
    }
    .display { font-family: "Archivo Black", sans-serif; line-height: .96; letter-spacing: -.02em; }
    .mono { font-family: "JetBrains Mono", monospace; }
    .muted { color: var(--muted); }

    /* Shot 1 — fragments */
    #fragments { display: grid; grid-template-columns: 640px minmax(0,1fr); gap: 64px; align-items: center; }
    .frag-copy { display: flex; flex-direction: column; gap: 28px; }
    .frag-copy h1 { font-size: 92px; }
    .frag-copy h1 .line { display: block; }
    .frag-field { position: relative; width: 100%; height: 100%; }
    .appwin {
      position: absolute; width: 300px; border-radius: 10px;
      background: var(--surface); border: 1px solid var(--border);
      box-shadow: 0 24px 60px rgba(0,0,0,.45); overflow: hidden;
    }
    .appwin .bar {
      display: flex; align-items: center; gap: 10px; padding: 12px 14px;
      border-bottom: 1px solid var(--border); background: var(--surface-2);
    }
    .appwin .dot { width: 14px; height: 14px; border-radius: 4px; }
    .appwin .name { font-size: 16px; font-weight: 600; color: var(--muted); }
    .appwin .badge {
      margin-left: auto; min-width: 26px; padding: 2px 7px; border-radius: 999px;
      background: #d94f4f; color: #fff; font-size: 14px; font-weight: 700; text-align: center;
    }
    .appwin .body { padding: 14px; display: flex; flex-direction: column; gap: 9px; }
    .appwin .ln { height: 9px; border-radius: 4px; background: #2c2438; }
    .frag-tools {
      font-family: "JetBrains Mono", monospace; font-size: 19px; color: var(--muted);
      letter-spacing: .08em;
    }

    /* Shot 2 — overload */
    #overload { display: grid; grid-template-columns: minmax(0,1.1fr) 520px; gap: 72px; align-items: center; }
    .load-world { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 40px; }
    .unread-num { font-family: "Archivo Black", sans-serif; font-size: 260px; line-height: 1; margin-bottom: 6px; color: var(--accent); }
    .unread-cap { font-size: 34px; color: var(--muted); max-width: 640px; }
    .load-questions { display: flex; flex-direction: column; gap: 10px; margin-top: 26px; }
    .load-questions .q { font-family: "JetBrains Mono", monospace; font-size: 21px; color: var(--muted); }
    .toasts { display: flex; flex-direction: column; gap: 16px; justify-content: center; }
    .toast {
      display: flex; align-items: center; gap: 14px; padding: 18px 20px;
      background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
      box-shadow: 0 16px 40px rgba(0,0,0,.4);
    }
    .toast .dot { width: 16px; height: 16px; border-radius: 5px; flex: none; }
    .toast .t-copy { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .toast .t-title { font-size: 18px; font-weight: 700; }
    .toast .t-sub { font-size: 16px; color: var(--muted); }

    /* Shot 3 — thread */
    #thread { display: grid; align-content: center; justify-items: center; }
    .channel {
      width: 1120px; border-radius: 16px; overflow: hidden;
      background: var(--surface); border: 1px solid var(--border);
      box-shadow: 0 40px 110px rgba(0,0,0,.55);
    }
    .ch-head {
      display: flex; align-items: center; gap: 14px; padding: 20px 26px;
      border-bottom: 1px solid var(--border); background: var(--surface-2);
    }
    .ch-name { font-size: 22px; font-weight: 800; }
    .ch-meta { font-size: 16px; color: var(--muted); margin-left: auto; font-family: "JetBrains Mono", monospace; }
    .msgs { display: flex; flex-direction: column; gap: 22px; padding: 28px 26px; }
    .msg { display: flex; gap: 16px; }
    .avatar {
      width: 44px; height: 44px; border-radius: 10px; flex: none;
      display: grid; place-items: center;
      font-family: "Archivo Black", sans-serif; font-size: 19px; color: #100d14;
    }
    .m-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .m-head { display: flex; align-items: baseline; gap: 10px; }
    .m-name { font-size: 18px; font-weight: 800; }
    .m-time { font-size: 14px; color: var(--muted); font-family: "JetBrains Mono", monospace; }
    .m-text { font-size: 19px; color: #dcd5e6; }
    .chip {
      display: inline-flex; align-items: center; gap: 8px; margin-top: 6px;
      padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px;
      font-size: 15px; color: var(--muted); font-family: "JetBrains Mono", monospace;
      background: var(--surface-2); align-self: flex-start;
    }
    .bot-card {
      border-left: 3px solid var(--accent); background: var(--surface-2);
      border-radius: 0 10px 10px 0; padding: 16px 18px;
      display: grid; grid-template-columns: minmax(0,1fr) 300px; gap: 20px; align-items: center;
    }
    .bot-copy { display: flex; flex-direction: column; gap: 8px; }
    .bot-line { font-size: 18px; color: #dcd5e6; }
    .bot-strong { font-weight: 800; color: var(--text); }
    .preview { /* the carried object */
      position: relative; width: 300px; height: 168px; border-radius: 10px; overflow: hidden;
      background: linear-gradient(135deg, #241d2e 0%, #17121f 100%);
      border: 1px solid var(--border); display: flex; flex-direction: column; justify-content: flex-end;
    }
    .preview .p-glow { position: absolute; inset: 0; background: radial-gradient(70% 90% at 30% 25%, rgba(255,194,77,.22) 0%, transparent 65%); }
    .preview .p-title { position: absolute; left: 8%; top: 16%; width: 55%; height: 12%; border-radius: 4px; background: rgba(244,241,247,.9); }
    .preview .p-sub { position: absolute; left: 8%; top: 34%; width: 38%; height: 7%; border-radius: 4px; background: rgba(155,146,168,.7); }
    .preview .p-strip { position: relative; display: flex; gap: 4%; padding: 4% 6%; }
    .preview .p-cell { flex: 1; height: 26px; border-radius: 4px; background: rgba(255,194,77,.28); border: 1px solid rgba(255,194,77,.4); }
    .preview .p-progress { position: relative; height: 5px; background: rgba(155,146,168,.25); }
    .preview .p-progress i { display: block; height: 100%; background: var(--accent); transform: scaleX(0); transform-origin: left; }
    .composer {
      margin: 0 26px 26px; border: 1px solid var(--border); border-radius: 12px;
      background: #17121f; padding: 16px 18px; display: flex; align-items: center; gap: 12px;
    }
    .composer .cmd {
      font-family: "JetBrains Mono", monospace; font-size: 19px; color: var(--accent);
      white-space: nowrap; clip-path: inset(0 100% 0 0);
    }
    .composer .caret { width: 2px; height: 24px; background: var(--accent); opacity: 0; }
    .composer .send {
      margin-left: auto; width: 40px; height: 40px; border-radius: 9px; background: var(--accent);
      display: grid; place-items: center; color: #100d14; font-weight: 900; font-size: 18px;
    }

    /* Shot 4 — film */
    #film { display: grid; grid-template-columns: 560px minmax(0,1fr); gap: 72px; align-items: center; }
    .film-copy { display: flex; flex-direction: column; gap: 26px; }
    .film-copy h2 { font-size: 88px; }
    .film-copy .sub { font-size: 30px; color: var(--muted); }
    .film-right { display: flex; flex-direction: column; gap: 20px; align-items: stretch; }
    .player { /* landing object for the match cut */
      position: relative; width: 100%; height: 560px; border-radius: 14px; overflow: hidden;
      background: linear-gradient(135deg, #241d2e 0%, #15101c 100%);
      border: 1px solid var(--border); box-shadow: 0 40px 110px rgba(0,0,0,.55);
    }
    .player .f-glow { position: absolute; inset: 0; background: radial-gradient(70% 90% at 30% 25%, rgba(255,194,77,.18) 0%, transparent 65%); }
    .player .f-eyebrow { position: absolute; left: 7%; top: 16%; font-family: "JetBrains Mono", monospace; font-size: 20px; letter-spacing: .16em; color: var(--accent); }
    .player .f-title { position: absolute; left: 7%; top: 23%; font-family: "Archivo Black", sans-serif; font-size: 84px; }
    .player .f-rule { position: absolute; left: 7%; top: 44%; width: 320px; height: 6px; background: var(--accent); transform: scaleX(0); transform-origin: left; }
    .player .f-chrome {
      position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 24px;
      display: flex; align-items: center; gap: 18px;
      background: linear-gradient(transparent, rgba(0,0,0,.55));
    }
    .player .f-time { font-family: "JetBrains Mono", monospace; font-size: 18px; color: var(--text); }
    .player .f-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(244,241,247,.22); overflow: hidden; }
    .player .f-bar i { display: block; height: 100%; background: var(--accent); transform: scaleX(0); transform-origin: left; }
    .strip { display: flex; gap: 16px; }
    .cell {
      flex: 1; height: 96px; border-radius: 10px; border: 1px solid var(--border);
      background: linear-gradient(135deg, #241d2e, #17121f); position: relative; overflow: hidden;
    }
    .cell i { position: absolute; left: 12%; top: 26%; width: 50%; height: 14%; border-radius: 3px; background: rgba(255,194,77,.5); display: block; }

    /* Shot 5 — lockup */
    #lockup { display: grid; align-content: center; justify-items: center; text-align: center; gap: 30px; }
    .mark {
      width: 84px; height: 84px; border-radius: 20px; background: var(--accent);
      display: grid; place-items: center; color: #100d14;
      font-family: "Archivo Black", sans-serif; font-size: 40px;
    }
    #lockup h3 { font-size: 84px; }
    #lockup .promise { font-family: "JetBrains Mono", monospace; font-size: 24px; color: var(--muted); }
    #lockup .rule { width: 220px; height: 3px; background: var(--border); transform: scaleX(0); }
  </style>
</head>
<body>
  <main id="root" data-composition-id="slack-ad" data-width="1920" data-height="1080" data-duration="24">

    <section id="fragments" class="scene clip" data-scene="fragments" data-start="0" data-duration="5" data-track-index="1">
      <div class="grid-bg" data-layout-ignore></div>
      <div class="frag-copy" data-layout-important>
        <div class="eyebrow" id="frag-eyebrow">Launch week &middot; T&minus;2 days</div>
        <h1 id="frag-h1"><span class="line">Launch day lives</span><span class="line">in six apps.</span></h1>
        <div class="frag-tools" id="frag-tools">channels &middot; docs &middot; tickets &middot; decks &middot; dms &middot; drive</div>
      </div>
      <div class="frag-field" data-layout-allow-overlap data-layout-allow-overflow>
        <div class="appwin" id="win-1" style="left:4%;top:6%;transform:rotate(-5deg)">
          <div class="bar"><span class="dot" style="background:#7aa7d9"></span><span class="name">Threads</span><span class="badge">12</span></div>
          <div class="body"><div class="ln" style="width:82%"></div><div class="ln" style="width:64%"></div><div class="ln" style="width:74%"></div></div>
        </div>
        <div class="appwin" id="win-2" style="left:46%;top:0%;transform:rotate(4deg)">
          <div class="bar"><span class="dot" style="background:#c9a06a"></span><span class="name">Docs</span><span class="badge">4</span></div>
          <div class="body"><div class="ln" style="width:88%"></div><div class="ln" style="width:70%"></div><div class="ln" style="width:52%"></div></div>
        </div>
        <div class="appwin" id="win-3" style="left:18%;top:36%;transform:rotate(2deg)">
          <div class="bar"><span class="dot" style="background:#8fb98b"></span><span class="name">Tickets</span><span class="badge">23</span></div>
          <div class="body"><div class="ln" style="width:76%"></div><div class="ln" style="width:84%"></div><div class="ln" style="width:58%"></div></div>
        </div>
        <div class="appwin" id="win-4" style="left:58%;top:32%;transform:rotate(-3deg)">
          <div class="bar"><span class="dot" style="background:#b98bb1"></span><span class="name">Decks</span><span class="badge">2</span></div>
          <div class="body"><div class="ln" style="width:66%"></div><div class="ln" style="width:78%"></div><div class="ln" style="width:70%"></div></div>
        </div>
        <div class="appwin" id="win-5" style="left:6%;top:64%;transform:rotate(6deg)">
          <div class="bar"><span class="dot" style="background:#d9d17a"></span><span class="name">Calendar</span><span class="badge">6</span></div>
          <div class="body"><div class="ln" style="width:72%"></div><div class="ln" style="width:60%"></div><div class="ln" style="width:80%"></div></div>
        </div>
        <div class="appwin" id="win-6" style="left:44%;top:62%;transform:rotate(-6deg)">
          <div class="bar"><span class="dot" style="background:#d98b8b"></span><span class="name">Drive</span><span class="badge">9</span></div>
          <div class="body"><div class="ln" style="width:84%"></div><div class="ln" style="width:56%"></div><div class="ln" style="width:68%"></div></div>
        </div>
      </div>
    </section>

    <section id="overload" class="scene clip" data-scene="overload" data-start="5" data-duration="4.5" data-track-index="1">
      <div class="grid-bg" data-layout-ignore></div>
      <div class="load-world" data-camera-world data-layout-important data-layout-allow-overflow>
        <div>
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
        <div class="toast" id="toast-1"><span class="dot" style="background:#7aa7d9"></span><span class="t-copy"><span class="t-title">Threads</span><span class="t-sub">7 new replies in #launch</span></span></div>
        <div class="toast" id="toast-2"><span class="dot" style="background:#c9a06a"></span><span class="t-copy"><span class="t-title">Docs</span><span class="t-sub">"launch-copy-FINAL-v4" edited</span></span></div>
        <div class="toast" id="toast-3"><span class="dot" style="background:#8fb98b"></span><span class="t-copy"><span class="t-title">Tickets</span><span class="t-sub">LNCH-214 moved to Done</span></span></div>
        <div class="toast" id="toast-4"><span class="dot" style="background:#b98bb1"></span><span class="t-copy"><span class="t-title">Decks</span><span class="t-sub">3 comments on slide 12</span></span></div>
        <div class="toast" id="toast-5"><span class="dot" style="background:#d98b8b"></span><span class="t-copy"><span class="t-title">Drive</span><span class="t-sub">"hero.mp4" needs access</span></span></div>
      </div>
    </section>

    <section id="thread" class="scene clip" data-scene="thread" data-start="9.5" data-duration="6" data-track-index="1">
      <div class="channel" id="channel" data-layout-important>
        <div class="ch-head">
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
        <div class="composer">
          <span class="cmd" id="cmd">/sequences make the launch film</span>
          <span class="caret" id="caret"></span>
          <span class="send" id="send">&#9658;</span>
        </div>
      </div>
    </section>

    <section id="film" class="scene clip" data-scene="film" data-start="15.5" data-duration="5" data-track-index="1">
      <div class="grid-bg" data-layout-ignore></div>
      <div class="film-copy" data-layout-important>
        <div class="eyebrow" id="film-eyebrow">From the thread you already have</div>
        <h2 id="film-h2">From shipped to shown.</h2>
        <div class="sub" id="film-sub">One command. One film. In the channel.</div>
      </div>
      <div class="film-right">
        <div class="player" id="film-frame" data-part="film-frame" data-layout-important>
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
          <span class="cell" id="cell-1"><i></i></span>
          <span class="cell" id="cell-2"><i></i></span>
          <span class="cell" id="cell-3"><i></i></span>
          <span class="cell" id="cell-4"><i></i></span>
          <span class="cell" id="cell-5"><i></i></span>
        </div>
      </div>
    </section>

    <section id="lockup" class="scene clip" data-scene="lockup" data-start="20.5" data-duration="3.5" data-track-index="1">
      <div class="mark" id="lk-mark" data-layout-important>S</div>
      <h3 id="lk-title" data-layout-important>Sequences for Slack</h3>
      <div class="rule" id="lk-rule"></div>
      <div class="promise" id="lk-promise">make a launch film from any thread</div>
    </section>
  </main>

  <script type="application/json" id="sequences-cuts">__CUT_PLAN__</script>
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

    // ── Shot 1: fragments (build; the accumulation IS the development) ──
    tl.fromTo("#frag-eyebrow", { x: -26, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 0.15);
    tl.fromTo("#frag-h1 .line", { y: 44, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power4.out", stagger: 0.16 }, 0.35);
    var wins = ["#win-1", "#win-2", "#win-3", "#win-4", "#win-5", "#win-6"];
    for (var w = 0; w < wins.length; w += 1) {
      tl.fromTo(wins[w], { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: "power3.out" }, 1.1 + w * 0.6);
      tl.fromTo(wins[w] + " .badge", { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "expo.out" }, 1.35 + w * 0.6);
    }
    tl.fromTo("#frag-tools", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 4.2);

    // ── Shot 2: overload (front-half push, count-up, sequential toasts, still hold) ──
    tl.fromTo("#overload [data-camera-world]", { scale: 1 }, { scale: 1.055, duration: 2.2, ease: "power1.inOut" }, 5.0);
    tl.fromTo("#overload .load-world > div:first-child", { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 5.15);
    var unreadEl = null;
    var unread = { v: 12 };
    tl.to(unread, {
      v: 47, duration: 1.8, ease: "power2.out",
      onUpdate: function () {
        if (!unreadEl) unreadEl = document.getElementById("unread-num");
        unreadEl.textContent = String(Math.round(unread.v));
        gsap.set(unreadEl, { scale: 1 + ((unread.v - 12) / 35) * 0.08, transformOrigin: "0% 100%" });
      }
    }, 5.5);
    var toasts = ["#toast-1", "#toast-2", "#toast-3", "#toast-4", "#toast-5"];
    for (var t = 0; t < toasts.length; t += 1) {
      tl.fromTo(toasts[t], { x: 44, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 5.4 + t * 0.6);
    }
    tl.fromTo("#q-1", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, 7.6);
    tl.fromTo("#q-2", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, 8.05);
    tl.fromTo("#q-3", { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, 8.5);
    // 8.9–9.32: intentional stillness before the reset flash.

    // ── Shot 3: thread (the component acts: messages arrive, a command is typed) ──
    tl.fromTo("#channel", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" }, 9.62);
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
    tl.fromTo("#film-h2", { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power4.out" }, 16.25);
    tl.fromTo("#film-sub", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 17.0);
    tl.fromTo("#ff-eyebrow", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "none" }, 16.3);
    tl.fromTo("#ff-title", { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: "power3.out" }, 16.45);
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
    tl.fromTo("#lk-mark", { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "expo.out" }, 20.75);
    tl.fromTo("#lk-title", { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.65, ease: "power3.out" }, 20.95);
    tl.fromTo("#lk-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power2.inOut" }, 21.45);
    tl.fromTo("#lk-promise", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, 21.55);

    SequencesCuts.compile(tl, document.getElementById("root"));
    window.__timelines["slack-ad"] = tl;
    tl.seek(0);
  </script>
</body>
</html>`.replace("__CUT_PLAN__", cutPlan);

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
