import type { CompleteOptions } from "@sequences/platform/providers";
import type { RetrievedSkillContext } from "../../agent/skillContext.ts";
import type { DirectCompositionDraft, DirectScene } from "../directComposition.ts";
import type { DirectBrowserQaResult } from "../layoutInspector.ts";
import type { ParsedSceneSlots } from "../sceneSlots.ts";

export interface DirectCompositionArgs {
  brief: string;
  projectDir: string;
  skills: RetrievedSkillContext;
  frameMd?: string;
  current?: DirectCompositionDraft;
  lockedStoryboard?: DirectScene[];
  revisionInstruction?: string;
  options?: CompleteOptions;
  /** @deprecated Attempt counts are folded from ledger events; ignored. */
  attempts?: { count: number };
}

export interface CompositionRunResult {
  draft: DirectCompositionDraft;
  raw: string;
  attempts: number;
  /** Browser QA of the returned draft when a pass ran (feeds cut discovery). */
  browserQa?: DirectBrowserQaResult;
  /**
   * Static frame/motion repair warnings the returned draft still carries (the
   * least-bad pick weights these; the critic-skip predicate must too — a
   * repaired-but-pixel-pristine draft is exactly a draft the critic can help).
   */
  staticRepairWarnings?: string[];
  /**
   * The scene-slot map that assembled the returned draft, present only when the
   * draft came straight from the slot path (Sentinel Phase 2) and no post-author
   * mutation replaced it. The continuity critic reuses it to route scene-named
   * directives through the scene-scoped repair instead of a whole-document
   * patch. A `Map`, so it is never serialized — the orchestrator reads only
   * `.draft`.
   */
  slots?: ParsedSceneSlots;
  /**
   * The economy-exit reason the run shipped a banked least-bad draft under
   * (`publishRuntimeValidCandidate`), when it did. The critic reads it to skip a
   * run that already proved it resists targeted patches
   * (`stagnant-polish-early-ship`) — a third patch will not absorb what two
   * identical-signature rejections already left untouched.
   */
  earlyShipReason?: string;
}
