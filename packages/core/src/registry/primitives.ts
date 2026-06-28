/**
 * The Phase-1 motion primitive set (16 — full planned set; camera moves live
 * in registry/camera.ts as scene-level stage transforms, not primitives).
 *
 * Every primitive is token-pure: it computes exclusively from EmitContext
 * values that the compiler resolved from tokens. `maskRevealUp` is here per
 * the review amendment ("first primitives implemented after fadeIn").
 */
import type { EmitContext, GsapStep, MotionPrimitive } from "./types.ts";
import {
  BLUR_TOKENS,
  DURATION_TOKENS,
  framesToSeconds,
  PRIMITIVE_STYLE_TOKENS,
  STAGGER_TOKENS,
} from "../tokens.ts";

function js(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export const fadeIn: MotionPrimitive = {
  id: "enter.fadeIn",
  kind: "enter",
  summary:
    "A gentle reveal that lets an element arrive without calling attention to itself. Use for background glow, small labels, and supporting copy.",
  tags: { energy: "calm", style: "organic" },
  defaults: { duration: "base", easing: "enter.glide" },
  emit(ctx: EmitContext): GsapStep[] {
    return [
      {
        kind: "fromTo",
        target: ctx.innerSel,
        from: { opacity: 0 },
        to: { opacity: 1 },
        durationSec: ctx.durationSec,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
    ];
  },
};

export const slideUpSoft: MotionPrimitive = {
  id: "enter.slideUpSoft",
  kind: "enter",
  summary:
    "A small upward lift with a soft settle. Reliable for captions, bullets, and secondary text that should feel polished but quiet.",
  tags: { energy: "calm", style: "organic" },
  defaults: { duration: "base", easing: "enter.glide", distance: "step" },
  emit(ctx: EmitContext): GsapStep[] {
    return [
      {
        kind: "fromTo",
        target: ctx.innerSel,
        from: { y: ctx.distancePx, opacity: 0 },
        to: { y: 0, opacity: 1 },
        durationSec: ctx.durationSec,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
    ];
  },
};

export const maskRevealUp: MotionPrimitive = {
  id: "enter.maskRevealUp",
  kind: "enter",
  summary:
    "A clean headline reveal where type rises from a hidden baseline. Signature SaaS move for confident openers and feature titles.",
  tags: { energy: "punchy", style: "mechanical" },
  defaults: { duration: "base", easing: "enter.snap" },
  needsMask: true,
  emit(ctx: EmitContext): GsapStep[] {
    return [
      {
        kind: "fromTo",
        target: ctx.innerSel,
        from: { yPercent: PRIMITIVE_STYLE_TOKENS.maskRevealOffsetPercent },
        to: { yPercent: 0 },
        durationSec: ctx.durationSec,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
    ];
  },
};

export const slideInDirectional: MotionPrimitive = {
  id: "enter.slideInDirectional",
  kind: "enter",
  summary:
    "A panel-style entrance from the side that matches where the element lives on screen. Good for UI panels, steps, and callouts.",
  tags: { energy: "punchy", style: "mechanical" },
  defaults: { duration: "base", easing: "enter.snap", distance: "travel" },
  emit(ctx: EmitContext): GsapStep[] {
    const centerX = ctx.layer.box.x + ctx.layer.box.w / 2;
    const fromX = centerX < ctx.stageWidth / 2 ? -ctx.distancePx : ctx.distancePx;
    return [
      {
        kind: "fromTo",
        target: ctx.innerSel,
        from: { x: fromX, opacity: 0 },
        to: { x: 0, opacity: 1 },
        durationSec: ctx.durationSec,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
    ];
  },
};

export const blurIn: MotionPrimitive = {
  id: "enter.blurIn",
  kind: "enter",
  summary:
    "A soft focus-to-sharp arrival. Good for screenshots and atmospheric support when the scene needs a little depth, not for dense copy.",
  tags: { energy: "calm", style: "organic" },
  defaults: { duration: "relaxed", easing: "enter.glide", distance: "step" },
  emit(ctx: EmitContext): GsapStep[] {
    const blurPx = Math.round(BLUR_TOKENS.soft * (ctx.stageHeight / 1080));
    return [
      {
        kind: "fromTo",
        target: ctx.innerSel,
        from: { opacity: 0, filter: `blur(${blurPx}px)` },
        to: { opacity: 1, filter: "blur(0px)" },
        durationSec: ctx.durationSec,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
    ];
  },
};

export const charCascade: MotionPrimitive = {
  id: "enter.charCascade",
  kind: "enter",
  summary:
    "Letters step on quickly like kinetic launch typography. Best for very short hook lines, product names, and logo stings.",
  tags: { energy: "punchy", style: "mechanical" },
  defaults: { duration: "relaxed", easing: "enter.snap" },
  emit(ctx: EmitContext): GsapStep[] {
    const stagger = framesToSeconds(STAGGER_TOKENS.tight, ctx.fps);
    // Chars are inline-block (yPercent transforms need it), grouped into
    // per-word nowrap spans separated by real spaces. Everything sits in one
    // block wrapper because the layer's .seq-inner is a flex container —
    // bare text-node spaces would be ignored as flex items and long copy
    // would never wrap.
    const code =
      `(function(){var el=document.querySelector(${js(ctx.innerSel)});if(!el)return;` +
      `var text=el.textContent||"";el.textContent="";var spans=[];` +
      `var wrap=document.createElement("span");wrap.style.display="block";wrap.style.width="100%";` +
      `var words=text.split(" ");` +
      `for(var w=0;w<words.length;w++){` +
      `if(w>0)wrap.appendChild(document.createTextNode(" "));` +
      `var ws=document.createElement("span");ws.style.display="inline-block";ws.style.whiteSpace="nowrap";` +
      `for(var i=0;i<words[w].length;i++){var s=document.createElement("span");` +
      `s.textContent=words[w][i];s.style.display="inline-block";` +
      `ws.appendChild(s);spans.push(s);}` +
      `wrap.appendChild(ws);}` +
      `el.appendChild(wrap);` +
      `tl.fromTo(spans,{yPercent:${PRIMITIVE_STYLE_TOKENS.charRisePercent},opacity:0},{yPercent:0,opacity:1,duration:${ctx.durationSec},ease:${js(ctx.ease)},stagger:${stagger}},${ctx.startSec});})();`;
    return [{ kind: "custom", code, easesUsed: [ctx.ease] }];
  },
};

export const scaleIn: MotionPrimitive = {
  id: "enter.scaleIn",
  kind: "enter",
  summary:
    "A card or media element grows into place from its anchor with a subtle snap. Use for screenshots, badges, and feature cards.",
  tags: { energy: "punchy", style: "organic" },
  defaults: { duration: "base", easing: "enter.settle", scale: "pop" },
  emit(ctx: EmitContext): GsapStep[] {
    const fromScale = Math.round((1 / ctx.scale) * 1000) / 1000;
    return [
      {
        kind: "fromTo",
        target: ctx.innerSel,
        from: { scale: fromScale, opacity: 0 },
        to: { scale: 1, opacity: 1 },
        durationSec: ctx.durationSec,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
    ];
  },
};

export const countUp: MotionPrimitive = {
  id: "enter.countUp",
  kind: "enter",
  summary:
    "A number reveal that races to the final value and lands cleanly. Use for one hero metric that should feel earned.",
  tags: { energy: "punchy", style: "mechanical" },
  defaults: { duration: "slow", easing: "enter.snap" },
  emit(ctx: EmitContext): GsapStep[] {
    const num = ctx.layer.content.number ?? { value: 0, prefix: "", suffix: "" };
    // Counters never run linear and must land on the exact value (Part V §5).
    const code =
      `(function(){var el=document.querySelector(${js(ctx.innerSel)});` +
      `var o={v:0};var fmt=function(v){return ${js(num.prefix)}+Math.round(v).toLocaleString("en-US")+${js(num.suffix)};};` +
      `el.textContent=fmt(0);` +
      `tl.fromTo(${js(ctx.innerSel)},{opacity:0},{opacity:1,duration:${Math.min(framesToSeconds(DURATION_TOKENS[PRIMITIVE_STYLE_TOKENS.countRevealDuration], ctx.fps), ctx.durationSec)},ease:${js(ctx.ease)}},${ctx.startSec});` +
      `tl.to(o,{v:${num.value},duration:${ctx.durationSec},ease:${js(ctx.ease)},onUpdate:function(){el.textContent=fmt(o.v);}},${ctx.startSec});})();`;
    return [{ kind: "custom", code, easesUsed: [ctx.ease] }];
  },
};

export const fadeDown: MotionPrimitive = {
  id: "exit.fadeDown",
  kind: "exit",
  summary: "A quiet send-off that lets an element drift away without stealing the cut. Good for warm, calm scenes.",
  tags: { energy: "calm", style: "organic" },
  defaults: { duration: "quick", easing: "exit.fade", distance: "nudge" },
  emit(ctx: EmitContext): GsapStep[] {
    return [
      {
        kind: "to",
        target: ctx.innerSel,
        vars: { opacity: 0, y: ctx.distancePx },
        durationSec: ctx.durationSec,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
    ];
  },
};

export const slideExit: MotionPrimitive = {
  id: "exit.slideExit",
  kind: "exit",
  summary: "A crisp upward departure that carries energy into the next beat. Use when the cut should feel like continued motion.",
  tags: { energy: "punchy", style: "mechanical" },
  defaults: { duration: "quick", easing: "exit.swift", distance: "step" },
  emit(ctx: EmitContext): GsapStep[] {
    return [
      {
        kind: "to",
        target: ctx.innerSel,
        vars: { opacity: 0, y: -ctx.distancePx },
        durationSec: ctx.durationSec,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
    ];
  },
};

export const scaleAway: MotionPrimitive = {
  id: "exit.scaleAway",
  kind: "exit",
  summary:
    "A decisive shrink-and-clear exit for cards, badges, and UI pieces when the scene needs a clean reset.",
  tags: { energy: "punchy", style: "organic" },
  defaults: { duration: "quick", easing: "exit.swift", scale: "subtle" },
  emit(ctx: EmitContext): GsapStep[] {
    const toScale = Math.round((1 / ctx.scale) * 1000) / 1000;
    return [
      {
        kind: "to",
        target: ctx.innerSel,
        vars: { opacity: 0, scale: toScale },
        durationSec: ctx.durationSec,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
    ];
  },
};

export const pop: MotionPrimitive = {
  id: "emphasis.pop",
  kind: "emphasis",
  summary:
    "A quick attention tap on one element. Use for a CTA, metric, or hotspot when it deserves the scene's single accent.",
  tags: { energy: "punchy", style: "organic" },
  defaults: { duration: "quick", easing: "enter.settle", scale: "pop" },
  emit(ctx: EmitContext): GsapStep[] {
    const half = Math.round((ctx.durationSec / 2) * 1000) / 1000;
    return [
      {
        kind: "to",
        target: ctx.innerSel,
        vars: { scale: ctx.scale },
        durationSec: half,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
      {
        kind: "to",
        target: ctx.innerSel,
        vars: { scale: 1 },
        durationSec: half,
        ease: ctx.ease,
        atSec: ctx.startSec + half,
      },
    ];
  },
};

export const pulseGlow: MotionPrimitive = {
  id: "emphasis.pulseGlow",
  kind: "emphasis",
  summary:
    "A brief accent glow that points the eye at one CTA, metric, or UI hotspot. Keep it rare and intentional.",
  tags: { energy: "punchy", style: "organic" },
  defaults: { duration: "quick", easing: "enter.settle", distance: "nudge" },
  emit(ctx: EmitContext): GsapStep[] {
    const glow = Math.round(BLUR_TOKENS[PRIMITIVE_STYLE_TOKENS.glowBlur] * (ctx.stageHeight / 1080));
    const half = Math.round((ctx.durationSec / 2) * 1000) / 1000;
    return [
      {
        kind: "to",
        target: ctx.innerSel,
        vars: { boxShadow: `0 0 ${glow}px var(--c-accent)` },
        durationSec: half,
        ease: ctx.ease,
        atSec: ctx.startSec,
      },
      {
        kind: "to",
        target: ctx.innerSel,
        vars: { boxShadow: "0 0 0 rgba(0,0,0,0)" },
        durationSec: half,
        ease: ctx.ease,
        atSec: ctx.startSec + half,
      },
    ];
  },
};

export const underlineSweep: MotionPrimitive = {
  id: "emphasis.underlineSweep",
  kind: "emphasis",
  summary:
    "An accent underline that draws under the key word. Use to make one phrase feel chosen, not shouted.",
  tags: { energy: "calm", style: "mechanical" },
  defaults: { duration: "base", easing: "move.glide" },
  emit(ctx: EmitContext): GsapStep[] {
    const code =
      `(function(){var el=document.querySelector(${js(ctx.innerSel)});if(!el)return;` +
      `el.style.backgroundImage="linear-gradient(var(--c-accent),var(--c-accent))";` +
      `el.style.backgroundRepeat="no-repeat";el.style.backgroundPosition="0 ${PRIMITIVE_STYLE_TOKENS.underlineYPercent}%";` +
      `el.style.backgroundSize="0% ${PRIMITIVE_STYLE_TOKENS.underlineThicknessEm}em";` +
      `tl.to(${js(ctx.innerSel)},{backgroundSize:"100% ${PRIMITIVE_STYLE_TOKENS.underlineThicknessEm}em",duration:${ctx.durationSec},ease:${js(ctx.ease)}},${ctx.startSec});})();`;
    return [{ kind: "custom", code, easesUsed: [ctx.ease] }];
  },
};

export const kenBurns: MotionPrimitive = {
  id: "continuous.kenBurns",
  kind: "continuous",
  summary:
    "A slow camera-like drift for held screenshots and media. Keeps a product shot alive while copy lands around it.",
  tags: { energy: "calm", style: "organic" },
  defaults: { duration: "dramatic", easing: "linear.mech", scale: "subtle", distance: "nudge" },
  emit(ctx: EmitContext): GsapStep[] {
    return [
      {
        kind: "fromTo",
        target: ctx.innerSel,
        from: { scale: 1, x: 0 },
        to: { scale: ctx.scale, x: -ctx.distancePx },
        durationSec: ctx.sceneDurationSec,
        ease: ctx.ease,
        atSec: ctx.sceneStartSec,
      },
    ];
  },
};

export const floatIdle: MotionPrimitive = {
  id: "continuous.floatIdle",
  kind: "continuous",
  summary:
    "A gentle hover for cards and badges during a hold. Background motion only, quieter than the main entrance.",
  tags: { energy: "calm", style: "organic" },
  defaults: { duration: "dramatic", easing: "move.glide", distance: "nudge" },
  emit(ctx: EmitContext): GsapStep[] {
    const half = Math.round((ctx.sceneDurationSec / 2) * 1000) / 1000;
    return [
      {
        kind: "to",
        target: ctx.innerSel,
        vars: { y: -ctx.distancePx },
        durationSec: half,
        ease: ctx.ease,
        atSec: ctx.sceneStartSec,
      },
      {
        kind: "to",
        target: ctx.innerSel,
        vars: { y: 0 },
        durationSec: half,
        ease: ctx.ease,
        atSec: ctx.sceneStartSec + half,
      },
    ];
  },
};

export const PRIMITIVES: Record<string, MotionPrimitive> = Object.fromEntries(
  [
    fadeIn,
    slideUpSoft,
    maskRevealUp,
    slideInDirectional,
    blurIn,
    charCascade,
    scaleIn,
    countUp,
    fadeDown,
    slideExit,
    scaleAway,
    pop,
    pulseGlow,
    underlineSweep,
    kenBurns,
    floatIdle,
  ].map((p) => [p.id, p]),
);
