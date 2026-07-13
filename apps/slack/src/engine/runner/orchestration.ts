import type { AgentProvider } from "@sequences/platform/providers";
import {
  validateDirectComposition,
  type DirectScene,
} from "../directComposition.ts";
import { inspectDirectComposition } from "../layoutInspector.ts";
import { normalizeStoryboardCutIntent } from "../cutContract.ts";
import { discoverShapeMatchUpgrades } from "../cutDiscovery.ts";
import {
  recordSentinelDegradation,
  recordSentinelQualityStatus,
  recordSentinelScaffold,
} from "../sentinelTelemetry.ts";
import {
  sentinelSkeletonEnabled,
  sentinelSlotsEnabled,
} from "../sentinelFlags.ts";
import {
  applyDeterministicSourceRepairs,
  rewriteDegradedCutStoryboard,
} from "./repairs.ts";
import {
  countScaffoldBindingsPresent,
  countScaffoldedBindings,
} from "./scaffold.ts";
import {
  applyContinuityCritique,
  authorComposition,
  persistUpgradedStoryboard,
} from "./ladder.ts";
import type { CompositionRunResult, DirectCompositionArgs } from "./types.ts";
import { slackSequencesEnvRawValue } from "../featureFlags.ts";
import { findingSignature } from "./findingSignatures.ts";


/**
 * Deterministic host-side shape-match upgrade (no model in the loop). Browser
 * QA measured every boundary's focal-part geometry; if exactly one
 * `hard`/directional boundary *provably* rhymes, mutate that scene's cut to
 * shape-match, re-run the deterministic injections + full validation with the
 * mutated storyboard, and ship it only when QA stays healthy — the mutated
 * storyboard then flows to everything downstream (critic, moments,
 * motion-plan.json, STORYBOARD.md, the persisted plan). Any regression keeps
 * the pre-upgrade draft: enhancement-never-veto, same as every contract.
 */
async function applyShapeMatchUpgrade(
  args: DirectCompositionArgs,
  result: CompositionRunResult,
): Promise<{ result: CompositionRunResult; storyboard: DirectScene[] } | undefined> {
  if (slackSequencesEnvRawValue("SLACK_SEQUENCES_CUT_DISCOVERY") === "0") return undefined;
  if (!args.lockedStoryboard?.length || args.revisionInstruction) return undefined;
  const boundaries = result.browserQa?.boundaries;
  if (!boundaries?.length) return undefined;
  // Mutate the storyboard that actually SHIPPED (authoring may have
  // quarantined optional interactions out of the locked plan); re-injecting
  // from the stale locked storyboard would resurrect exactly what the
  // authoring loop proved broken (2026-07-04 live run).
  const shipped = result.draft.storyboard;
  const upgrades = discoverShapeMatchUpgrades(shipped, boundaries);
  if (!upgrades.length) return undefined;
  const byScene = new Map(upgrades.map((upgrade) => [upgrade.fromScene, upgrade]));
  const storyboard = shipped.map((scene) => {
    const upgrade = byScene.get(scene.id);
    if (!upgrade) return scene;
    const cut = normalizeStoryboardCutIntent({
      version: 1,
      style: "shape-match",
      focalPartOut: upgrade.focalPartOut,
      focalPartIn: upgrade.focalPartIn,
    });
    if (!cut) return scene;
    return {
      ...scene,
      cut,
      // The artifacts (STORYBOARD.md, Slack outline, manifest) advertise
      // outgoingCut prose — rewrite it so paperwork matches the executed
      // boundary instead of describing the pre-upgrade cut.
      outgoingCut:
        `Morph: "${upgrade.focalPartOut}" becomes ` +
        `"${upgrade.focalPartIn}" (measured silhouette rhyme${
          upgrade.sharedEntityId ? ` + shared entity ${upgrade.sharedEntityId}` : ""
        }, discovered at QA).`,
    };
  });
  for (const upgrade of upgrades) {
    process.stderr.write(
      `[cut-discovery] upgrading ${upgrade.fromScene}->${upgrade.toScene} to morph ` +
        `(${upgrade.focalPartOut} → ${upgrade.focalPartIn}, score ${upgrade.score.toFixed(2)}` +
        `${upgrade.sharedEntityId ? `, entity ${upgrade.sharedEntityId}` : ""})\n`,
    );
  }
  try {
    const draft = applyDeterministicSourceRepairs(
      { storyboard, html: result.draft.html },
      args.projectDir,
      storyboard,
    );
    const validation = await validateDirectComposition(args.projectDir, draft);
    if (!validation.ok) {
      throw new Error(`static validation rejected the upgrade: ${validation.errors[0] ?? ""}`);
    }
    const browserQa = await inspectDirectComposition(args.projectDir, draft, {
      captureGuide: false,
    });
    if (browserQa.infraError || !browserQa.ok) {
      throw new Error(
        `browser QA could not prove the upgrade: ${
          browserQa.infraError ?? browserQa.errors[0] ?? "unknown failure"
        }`,
      );
    }
    // The runtime's bind-time audit stays the final safety net; if it chose
    // to degrade our upgraded boundary, the measured rhyme was not real —
    // keep the honest directional cut instead of shipping a zoom-through.
    const degraded = upgrades.some((upgrade) => browserQa.warnings.some((warning) =>
      warning.startsWith("cut_degraded:") &&
      warning.includes(`${upgrade.fromScene}->${upgrade.toScene}`)
    ));
    if (degraded) {
      throw new Error("the runtime bind-time audit degraded the upgraded boundary");
    }
    persistUpgradedStoryboard(args.projectDir, storyboard);
    process.stderr.write("[cut-discovery] upgrade validated; shipping the morph boundary\n");
    // Drop any banked slot map: this draft's html was rebuilt around the morph
    // boundary and no longer matches the slots, so the critic must not re-author
    // from a stale map — it falls back to the whole-document patch instead.
    return { result: { ...result, draft, browserQa, slots: undefined }, storyboard };
  } catch (error) {
    process.stderr.write(
      `[cut-discovery] upgrade rejected (${
        error instanceof Error ? error.message : String(error)
      }); keeping the pre-upgrade draft\n`,
    );
    return undefined;
  }
}


/**
 * Honest paperwork for boundaries the runtime degraded (WS1). When a declared
 * bridged cut survived every repair opportunity and still compiled as
 * zoom-through, the shipped artifacts — STORYBOARD.md, the Slack outline,
 * manifest.json, the cut island — must record the cut that actually executed,
 * never the morph that did not. Rewrite the shipped storyboard from the QA
 * result, re-inject deterministically, and accept the rewrite only when full
 * validation stays healthy; the executed motion is already a zoom-through, so
 * this changes records, not the film. Any regression keeps the pre-reconcile
 * draft (enhancement-never-veto).
 */
async function reconcileDegradedCutPaperwork(
  args: DirectCompositionArgs,
  result: CompositionRunResult,
): Promise<CompositionRunResult> {
  // Rewrite from the storyboard that actually SHIPPED (gotcha #10).
  const { storyboard, rewritten } = rewriteDegradedCutStoryboard(
    result.draft.storyboard,
    result.browserQa?.warnings ?? [],
  );
  if (!rewritten.length) return result;
  try {
    const draft = applyDeterministicSourceRepairs(
      { storyboard, html: result.draft.html },
      args.projectDir,
      storyboard,
    );
    const validation = await validateDirectComposition(args.projectDir, draft);
    if (!validation.ok) {
      throw new Error(`static validation rejected the rewrite: ${validation.errors[0] ?? ""}`);
    }
    const browserQa = await inspectDirectComposition(args.projectDir, draft, {
      captureGuide: false,
    });
    if (browserQa.infraError || !browserQa.ok) {
      throw new Error(
        `browser QA could not prove the rewrite: ${
          browserQa.infraError ?? browserQa.errors[0] ?? "unknown failure"
        }`,
      );
    }
    persistUpgradedStoryboard(args.projectDir, storyboard);
    process.stderr.write(
      `[cut-honesty] rewrote ${rewritten.length} runtime-degraded boundary/ies as the cut ` +
        `that actually executed in the shipped storyboard: ${rewritten.join(", ")}\n`,
    );
    recordSentinelDegradation(`cut-degraded-shipped:${rewritten.join(",")}`);
    return { ...result, draft, browserQa };
  } catch (error) {
    process.stderr.write(
      `[cut-honesty] paperwork reconcile rejected (${
        error instanceof Error ? error.message : String(error)
      }); keeping the shipped draft as-is\n`,
    );
    return result;
  }
}

export async function requestDirectComposition(
  provider: AgentProvider,
  args: DirectCompositionArgs,
): Promise<CompositionRunResult> {
  let result = await authorComposition(provider, args);
  // Upgrade BEFORE the critic, so the critic reviews the film that will
  // actually ship; the mutated storyboard flows into its evidence pack and
  // its repair re-injections.
  let critiqueArgs = args;
  const upgraded = await applyShapeMatchUpgrade(args, result);
  if (upgraded) {
    result = upgraded.result;
    critiqueArgs = { ...args, lockedStoryboard: upgraded.storyboard };
  }
  const critiqued = await applyContinuityCritique(provider, critiqueArgs, result);
  // LAST: whatever ships, its paperwork tells the truth about every boundary.
  const final = await reconcileDegradedCutPaperwork(args, critiqued);
  // L1 telemetry measured against the document that SHIPS: how many
  // host-guaranteed bindings the skeleton/slots path actually preserved, not
  // how many the templates planned (idempotent-by-max across revisions).
  if (sentinelSkeletonEnabled() || sentinelSlotsEnabled()) {
    recordSentinelScaffold(
      countScaffoldBindingsPresent(final.draft.storyboard, final.draft.html),
      countScaffoldedBindings(final.draft.storyboard),
    );
  }
  // Publish-time honesty scan: host-invented neutral placeholder structure
  // (`topUpRowsMarkup`/`topUpChartMarkup`/`topUpProgressMarkup`) that survived
  // into the SHIPPING document is host truth standing in for author content —
  // literal "Item 1…" rows copy (the s5-slotrepair probe's terminal did, on
  // frame), a placeholder bar set, or a placeholder progress fill. Each kind
  // records its own degradation so a salvaged film is never reported clean.
  // Detected here — not at injection — because an earlier attempt's injection
  // may be superseded by a real re-author.
  if (/\bdata-sequences-neutral\s*=\s*["']1["']/i.test(final.draft.html)) {
    // Record the source the host reused for the row labels (T5) so the ledger
    // shows whether "Item N" placeholder copy or real plan strings shipped.
    const rowSources = new Set<string>();
    for (const match of final.draft.html.matchAll(
      /data-sequences-rows-source\s*=\s*["']([^"']+)["']/gi,
    )) {
      rowSources.add(match[1]!);
    }
    if (rowSources.size) {
      for (const source of rowSources) {
        recordSentinelDegradation(`rows-neutral-children-shipped:${source}`);
      }
    } else {
      recordSentinelDegradation("rows-neutral-children-shipped");
    }
  }
  if (/\bdata-sequences-neutral\s*=\s*["']chart["']/i.test(final.draft.html)) {
    recordSentinelDegradation("chart-neutral-bars-shipped");
  }
  if (/\bdata-sequences-neutral\s*=\s*["']progress["']/i.test(final.draft.html)) {
    recordSentinelDegradation("progress-neutral-fill-shipped");
  }
  // Quarantined interactions likewise leave a detectable style tag; scanning
  // the shipping document (not the quarantine helpers, which also run on
  // attempts that later lose) keeps the ledger exact.
  if (/<style\s+data-sequences-quarantine\b/i.test(final.draft.html)) {
    recordSentinelDegradation("interaction-quarantine-shipped");
  }
  if (final.browserQa) {
    recordSentinelQualityStatus({
      runtimeValid: final.browserQa.ok,
      qualityResidue: final.browserQa.warnings.length,
      findingSignatures: final.browserQa.warnings.map(findingSignature),
    });
  }
  return final;
}
