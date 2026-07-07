/**
 * Recipe Studio — deterministic demo scaffold (zero tokens).
 *
 * Compiles a workspace's recipe declaration into a complete, valid
 * composition: a minimal dark stage whose single scene declares the recipe,
 * then the REAL author-pipeline injection pass
 * (`applyDeterministicSourceRepairs`) instantiates the fragment exactly the
 * way a live `/sequences` create would — same wrapper, same motion anchor,
 * same kits and runtimes. The studio never re-implements injection (plan
 * guardrail #2): if the demo passes the gate, a live film using this recipe
 * gets byte-identical mechanism markup/motion modulo params.
 */
import { applyDeterministicSourceRepairs } from "../src/engine/compositionRunner.ts";
import type {
  DirectCompositionDraft,
  DirectScene,
} from "../src/engine/directComposition.ts";

export interface RecipeDemoOptions {
  recipeId: string;
  params: Record<string, string | number>;
  title?: string;
  durationSec?: number;
  /** Stage tokens the fragment may reference (defaults match the golden film's set). */
  keyColor?: string;
  background?: string;
  textColor?: string;
}

const DEMO_FONT_STACK = "Montserrat, Inter, sans-serif";

export function buildRecipeDemoDraft(
  projectDir: string,
  options: RecipeDemoOptions,
): DirectCompositionDraft {
  const stageSec = Math.round((options.durationSec ?? 6) * 100) / 100;
  const slateSec = 1.6;
  const durationSec = Math.round((stageSec + slateSec) * 100) / 100;
  const keyColor = options.keyColor ?? "#ffc24d";
  const background = options.background ?? "#0b0f14";
  const textColor = options.textColor ?? "#f4f6f8";
  const stageEnd = (stageSec - 0.01).toFixed(2);
  // The engine gate requires 2+ scenes, so the proof film is stage + slate:
  // the recipe performs, then a quiet end card holds for the outgoing read.
  const storyboard: DirectScene[] = [
    {
      id: "stage",
      title: options.title ?? `Recipe proof — ${options.recipeId}`,
      purpose: "Prove the recipe fragment through the full deterministic gate",
      incomingIdea: "A dark stage; the recipe is the only performer",
      foreground: "The recipe fragment, centered",
      background: "Tinted near-black stage with a soft key gradient",
      cameraIntent: "Locked frame; the recipe does the acting",
      startSec: 0,
      durationSec: stageSec,
      outgoingCut: "Hard cut to the proof slate",
      continuityAnchor: "The recipe's focal element",
      recipes: [{ version: 1, id: options.recipeId, params: options.params }],
    },
    {
      id: "slate",
      title: "Proof slate",
      purpose: "Close the proof film with a quiet identification card",
      incomingIdea: "The pattern is proven; name it",
      foreground: "A small centered slate naming the recipe",
      background: "The same stage, dimmer",
      cameraIntent: "Locked frame",
      startSec: stageSec,
      durationSec: slateSec,
      outgoingCut: "End of film",
      continuityAnchor: "Center of frame",
    },
  ];
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Recipe proof — ${escapeHtml(options.recipeId)}</title>
    <script src="gsap.min.js"></script>
    <style>
      :root {
        --cinema-key: ${keyColor};
        --cinema-bloom: ${keyColor};
      }
      body { margin: 0; background: ${background}; color: ${textColor}; font-family: ${DEMO_FONT_STACK}; }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; background: ${background}; }
      .scene.clip { position: absolute; inset: 0; opacity: 0; }
      #stage { display: flex; align-items: center; justify-content: center; }
      .stage-key {
        position: absolute; inset: 0;
        background: radial-gradient(1200px 800px at 30% 18%, rgba(255, 255, 255, 0.07), transparent 70%);
      }
      .stage-floor {
        position: absolute; left: 0; right: 0; bottom: 0; height: 38%;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.35), transparent);
      }
      #slate { display: flex; align-items: center; justify-content: center; }
      .slate-card { text-align: center; }
      .slate-kicker { font-size: 22px; letter-spacing: 0.32em; text-transform: uppercase; color: ${keyColor}; }
      .slate-name { font-size: 54px; font-weight: 700; margin-top: 18px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="recipe-demo" data-width="1920" data-height="1080" data-duration="${durationSec}">
      <section id="stage" class="scene clip" data-scene="stage" data-start="0" data-duration="${stageSec}" data-track-index="1">
        <div class="stage-key" data-layout-ignore></div>
        <div class="stage-floor" data-layout-ignore></div>
      </section>
      <section id="slate" class="scene clip" data-scene="slate" data-start="${stageSec}" data-duration="${slateSec}" data-track-index="1">
        <div class="slate-card" data-layout-important data-layout-anchor="frame:center">
          <div class="slate-kicker">Recipe Studio proof</div>
          <div class="slate-name">${escapeHtml(options.recipeId)}</div>
        </div>
      </section>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      tl.set("#stage", { opacity: 1 }, 0);
      tl.set("#stage", { opacity: 0 }, ${stageEnd});
      tl.set("#slate", { opacity: 1 }, ${stageSec});
      tl.set("#slate", { opacity: 0 }, ${durationSec});
      // A slow key-light breath keeps the stage alive around the recipe.
      tl.fromTo(".stage-key", { opacity: 0.55 }, { opacity: 1, duration: ${Math.max(1, stageSec - 0.5).toFixed(2)}, ease: "none" }, 0.25);
      tl.fromTo(".slate-card", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, ${(stageSec + 0.1).toFixed(2)});
      window.__timelines["recipe-demo"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
  // The recipe fragment (and the always-on kits/runtimes) are injected by the
  // same pass live creates use — the studio is a cockpit over the engine,
  // never a second engine.
  return applyDeterministicSourceRepairs({ html, storyboard }, projectDir, storyboard);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
