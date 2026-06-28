/**
 * The deterministic motion linter (T3): codified motion-design heuristics as
 * zero-token compile passes. Each finding may carry a fix - and fixes are
 * COMMANDS, so auto-fixes are logged and undoable like any other edit.
 *
 * Full Phase-1 rule set (13 rules). Note: exit-coverage is a guard for
 * future profile authors — the shipped profiles can't trigger it (see
 * README_dev.md §8).
 */
import type { Project } from "./schema.ts";
import { ARCHETYPES, PROFILES } from "./registry/index.ts";
import { resolveProject } from "./materialize.ts";
import { compile, allowedRuntimeEases } from "./compiler.ts";
import { SAFE_MARGIN_FRAC, snapBoxToGrid, wordCount } from "./layout.ts";
import { CHOREO_DEFAULTS, scaleFrames30, STAGGER_TOKENS } from "./tokens.ts";
import type { Command } from "./commands.ts";
import type { ProjectStore } from "./store.ts";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  rule: string;
  severity: Severity;
  sceneId?: string;
  layerId?: string;
  message: string;
  fix?: Command;
}

function hexLuminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = hexLuminance(hexA);
  const lb = hexLuminance(hexB);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function bestContrastToken(
  colors: Project["brand"]["colors"],
  background: string,
): keyof Project["brand"]["colors"] | null {
  let best: { token: keyof Project["brand"]["colors"]; ratio: number } | null = null;
  for (const [token, color] of Object.entries(colors) as Array<
    [keyof Project["brand"]["colors"], string]
  >) {
    const ratio = contrastRatio(color, background);
    if (!best || ratio > best.ratio) best = { token, ratio };
  }
  return best && best.ratio >= 3 ? best.token : null;
}

export function lintProject(project: Project): Finding[] {
  const findings: Finding[] = [];
  const resolved = resolveProject(project);
  const { width: W, height: H } = project.meta;
  const fps = project.meta.fps;

  for (const { scene, layers, schedule } of resolved) {
    const archetype = ARCHETYPES[scene.archetype]!;
    const minDur = scaleFrames30(archetype.duration.min, fps);
    const maxDur = scaleFrames30(archetype.duration.max, fps);

    // scene-duration-range - scene length within the archetype's heuristics.
    if (scene.durationFrames < minDur || scene.durationFrames > maxDur) {
      const clamped = Math.min(Math.max(scene.durationFrames, minDur), maxDur);
      findings.push({
        rule: "scene-duration-range",
        severity: "warn",
        sceneId: scene.id,
        message: `scene is ${scene.durationFrames}f; ${archetype.id} wants ${minDur}-${maxDur}f at ${fps}fps`,
        fix: { type: "SetSceneDuration", sceneId: scene.id, durationFrames: clamped },
      });
    }

    // text-readability - frames on screen >= 12f + 9fxwords (~180wpm).
    for (const layer of layers) {
      if (layer.kind !== "text" || layer.role === "decor") continue;
      const words = wordCount(layer.content.text ?? "");
      if (words === 0) continue;
      const required = scaleFrames30(12 + 9 * words, fps);
      const enter = schedule.motions.find(
        (m) => m.layerId === layer.id && m.phase === "enter",
      );
      const available = scene.durationFrames - (enter?.startFrame ?? 0);
      if (available < required) {
        const target = Math.min(scene.durationFrames + (required - available), maxDur);
        findings.push({
          rule: "text-readability",
          severity: "warn",
          sceneId: scene.id,
          layerId: layer.id,
          message: `"${(layer.content.text ?? "").slice(0, 30)}..." has ${available}f, needs ${required}f (${words} words)`,
          ...(target > scene.durationFrames
            ? { fix: { type: "SetSceneDuration", sceneId: scene.id, durationFrames: target } }
            : {}),
        });
      }
    }

    // settle-gap - hold after last entrance before first exit / scene end.
    if (schedule.diagnostics.settleShortfallFrames > 0) {
      const target = Math.min(
        scene.durationFrames + schedule.diagnostics.settleShortfallFrames,
        maxDur,
      );
      findings.push({
        rule: "settle-gap",
        severity: "warn",
        sceneId: scene.id,
        message: `entrances end at ${schedule.diagnostics.lastEnterEndFrame}f with no settle hold (need ${schedule.diagnostics.settleShortfallFrames}f more)`,
        ...(target > scene.durationFrames
          ? { fix: { type: "SetSceneDuration", sceneId: scene.id, durationFrames: target } }
          : {}),
      });
    }

    // simultaneity-cap - the solver enforces this; firing means a core bug.
    if (schedule.diagnostics.peakConcurrency > CHOREO_DEFAULTS.simultaneityCap) {
      findings.push({
        rule: "simultaneity-cap",
        severity: "error",
        sceneId: scene.id,
        message: `INTERNAL: ${schedule.diagnostics.peakConcurrency} concurrent entrances (cap ${CHOREO_DEFAULTS.simultaneityCap}) - solver bug`,
      });
    }

    // stagger-required - every sibling entrance must respect at least tight.
    const entrances = schedule.motions
      .filter((motion) => motion.phase === "enter")
      .sort((a, b) => a.startFrame - b.startFrame);
    const staggerFloor = scaleFrames30(STAGGER_TOKENS.tight, fps);
    const tooTight = entrances.some(
      (motion, index) =>
        index > 0 && motion.startFrame - entrances[index - 1]!.startFrame < staggerFloor,
    );
    if (tooTight) {
      findings.push({
        rule: "stagger-required",
        severity: "warn",
        sceneId: scene.id,
        message: `sibling entrances must start at least ${staggerFloor}f apart`,
        fix: {
          type: "SetChoreography",
          sceneId: scene.id,
          choreography: { ...scene.choreography, stagger: PROFILES[project.motionProfile]!.defaults.stagger },
        },
      });
    }

    // one-loud-motion sanity.
    if (schedule.diagnostics.heroNotLoudest) {
      findings.push({
        rule: "hero-loudest",
        severity: "info",
        sceneId: scene.id,
        message: "a supporting layer's entrance outlasts the hero's - check profile/overrides",
      });
    }

    // copy-budget - slot text within archetype word budgets.
    for (const [slotName, spec] of Object.entries(archetype.slots)) {
      if (spec.maxWords === undefined) continue;
      const value = scene.slots[slotName];
      const texts =
        typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
      for (const text of texts) {
        const words = wordCount(text);
        if (words > spec.maxWords) {
          findings.push({
            rule: "copy-budget",
            severity: "warn",
            sceneId: scene.id,
            message: `slot "${slotName}": ${words} words (budget ${spec.maxWords}) - shorten the copy`,
          });
        }
      }
    }

    // safe-area - text inside title-safe margins (5% inset).
    const mx = SAFE_MARGIN_FRAC * W;
    const my = SAFE_MARGIN_FRAC * H;
    for (const layer of layers) {
      if (layer.kind !== "text" && layer.kind !== "number") continue;
      const b = layer.box;
      if (b.x < mx || b.y < my || b.x + b.w > W - mx || b.y + b.h > H - my) {
        const fixedW = Math.min(b.w, W - 2 * mx);
        const fixedH = Math.min(b.h, H - 2 * my);
        const fixedX = Math.min(Math.max(b.x, mx), W - mx - fixedW);
        const fixedY = Math.min(Math.max(b.y, my), H - my - fixedH);
        findings.push({
          rule: "safe-area",
          severity: "warn",
          sceneId: scene.id,
          layerId: layer.id,
          message: `layer "${layer.id}" leaves the title-safe area`,
          fix: {
            type: "OverrideLayerBox",
            sceneId: scene.id,
            layerId: layer.id,
            box: {
              x: Math.round(fixedX),
              y: Math.round(fixedY),
              ...(fixedW !== b.w ? { w: Math.round(fixedW) } : {}),
              ...(fixedH !== b.h ? { h: Math.round(fixedH) } : {}),
            },
          },
        });
      }
    }

    // grid-snap: explicit horizontal geometry lands on the 12-column grid.
    for (const layer of layers) {
      const override = scene.overrides[layer.id]?.box;
      if (!override) continue;
      const snappedGrid = snapBoxToGrid(W, layer.box);
      const tolerance = Math.max(2, Math.round(W / 240));
      if (
        Math.abs(layer.box.x - snappedGrid.x) > tolerance ||
        Math.abs(layer.box.w - snappedGrid.w) > tolerance
      ) {
        findings.push({
          rule: "grid-snap",
          severity: "info",
          sceneId: scene.id,
          layerId: layer.id,
          message: `layer "${layer.id}" is off the 12-column grid`,
          fix: {
            type: "OverrideLayerBox",
            sceneId: scene.id,
            layerId: layer.id,
            box: snappedGrid,
          },
        });
      }
    }

    for (const layer of layers) {
      if (layer.kind !== "text" && layer.kind !== "number") continue;
      const colorToken = (layer.colorToken ?? "text") as keyof typeof project.brand.colors;
      const fg = project.brand.colors[colorToken];
      const bg = layer.chrome
        ? project.brand.colors.accent // pill text sits on the accent chrome
        : project.brand.colors[project.meta.background];
      const ratio = contrastRatio(fg, bg);
      if (ratio < 3) {
        const best = bestContrastToken(project.brand.colors, bg);
        findings.push({
          rule: "contrast",
          severity: "warn",
          sceneId: scene.id,
          layerId: layer.id,
          ...(best && best !== colorToken
            ? {
                fix: {
                  type: "SetLayerOverride",
                  sceneId: scene.id,
                  layerId: layer.id,
                  patch: { colorToken: best },
                },
              }
            : {}),
          message: `contrast ${ratio.toFixed(2)}:1 (< 3:1) for "${layer.id}" - adjust brand colors or the layer's colorToken`,
        });
      }
    }
  }

  // motion-density and exit-coverage: scene readability checks before compile-only checks.

  for (const { scene, layers, schedule } of resolved) {
    const animatedForeground = schedule.motions.filter((motion) => {
      if (motion.phase === "continuous") return false;
      const layer = layers.find((l) => l.id === motion.layerId);
      return layer !== undefined && layer.role !== "decor";
    });
    const animatedFrames = animatedForeground.reduce(
      (sum, motion) => sum + motion.durationFrames,
      0,
    );
    const profile = PROFILES[project.motionProfile]!;
    const density = animatedFrames / scene.durationFrames;
    if (density > profile.defaults.motionDensityCeiling || animatedForeground.length > 7) {
      const removableEmphasis = [...animatedForeground]
        .filter((motion) => motion.phase === "emphasis")
        .sort((a, b) => {
          const rankA = layers.find((layer) => layer.id === a.layerId)?.rank ?? 0;
          const rankB = layers.find((layer) => layer.id === b.layerId)?.rank ?? 0;
          return rankB - rankA;
        })[0];
      findings.push({
        rule: "motion-density",
        severity: "warn",
        sceneId: scene.id,
        message: `motion density ${density.toFixed(2)} (${animatedForeground.length} foreground motions) exceeds ${profile.id} budget`,
        ...(removableEmphasis
          ? {
              fix: {
                type: "RemoveMotion",
                sceneId: scene.id,
                layerId: removableEmphasis.layerId,
                phase: "emphasis",
              } as Command,
            }
          : {}),
      });
    }

    if (profile?.defaults.exits) {
      for (const layer of layers) {
        if (layer.role === "decor") continue;
        if (!layer.motions.exit) {
          findings.push({
            rule: "exit-coverage",
            severity: "warn",
            sceneId: scene.id,
            layerId: layer.id,
            message: `profile "${profile.id}" uses exits, but "${layer.id}" has no exit motion`,
            fix: {
              type: "AddMotion",
              sceneId: scene.id,
              layerId: layer.id,
              phase: "exit",
              primitive: profile.selection[layer.role].exit?.primitive ?? "exit.fadeDown",
            },
          });
        }
      }
    }
  }

  // duration-tiling: nominal scene starts tile exactly and overlap windows fit
  // inside both adjacent scenes.
  const compiledForTiling = compile(project);
  let nominalCursor = 0;
  compiledForTiling.manifest.scenes.forEach((scene, index) => {
    if (scene.startFrame !== nominalCursor) {
      findings.push({
        rule: "duration-tiling",
        severity: "error",
        sceneId: scene.id,
        message: `scene starts at ${scene.startFrame}f; expected ${nominalCursor}f`,
      });
    }
    nominalCursor += scene.durationFrames;
    if (index > 0) {
      const previous = compiledForTiling.manifest.scenes[index - 1]!;
      const overlap = scene.startFrame - scene.clipStartFrame;
      if (overlap >= previous.durationFrames || overlap >= scene.durationFrames) {
        findings.push({
          rule: "duration-tiling",
          severity: "warn",
          sceneId: scene.id,
          message: `transition overlap ${overlap}f does not fit adjacent scene durations`,
          fix: {
            type: "SetSceneDuration",
            sceneId: scene.id,
            durationFrames: Math.max(scene.durationFrames, overlap + scaleFrames30(15, fps)),
          },
        });
      }
    }
  });

  const allowed = allowedRuntimeEases();
  const compiled = compiledForTiling;
  for (const step of compiled.steps) {
    const eases =
      step.kind === "custom" ? step.easesUsed : step.kind === "set" ? [] : [step.ease];
    for (const ease of eases) {
      if (!allowed.has(ease)) {
        findings.push({
          rule: "easing-whitelist",
          severity: "error",
          sceneId: step.sceneId,
          message: `INTERNAL: non-token ease "${ease}" emitted - compiler/primitive bug`,
        });
      }
    }
  }

  return findings;
}

export interface AutoFixResult {
  applied: Command[];
  remaining: Finding[];
}

/** Apply available fixes through the store (logged, undoable), re-lint,
 *  repeat until stable (max 5 passes). */
export function applyAutoFixes(store: ProjectStore): AutoFixResult {
  const applied: Command[] = [];
  for (let pass = 0; pass < 5; pass++) {
    const findings = lintProject(store.project);
    const fixes = findings.filter((f) => f.fix).map((f) => f.fix!);
    if (fixes.length === 0) return { applied, remaining: findings };
    let progressed = false;
    for (const fix of fixes) {
      const outcome = store.apply(fix, "autofix");
      if (outcome.ok) {
        applied.push(fix);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return { applied, remaining: lintProject(store.project) };
}

