import type { AgentProvider, CompleteOptions } from "@sequences/platform/providers";
import { createHash } from "node:crypto";
import fs from "node:fs";
import type { DirectBrowserQaResult } from "../layoutInspector.ts";
import { slackSequencesEnvRawValue } from "../featureFlags.ts";

/** Independent kill switch for the multimodal taste-tail pass (WS-I). */
export function visionCriticEnabled(): boolean {
  return slackSequencesEnvRawValue("SLACK_SEQUENCES_VISION_CRITIC") !== "0";
}

/**
 * A rendered draft that is strict-clean with zero measured quality penalty can
 * waive the separate taste-tail call. The ladder still runs the vision critic
 * for every non-pristine draft, and `SLACK_SEQUENCES_CRITIC_SKIP_CLEAN=0`
 * remains the explicit always-run override at the call site.
 */
export function cleanCriticSkipAllowed(
  _visionEnabled = visionCriticEnabled(),
): boolean {
  return true;
}

/**
 * Convert browser-owned PNG evidence into provider-native image inputs. Images
 * never enter prompt text/base64 logs. A genuinely absent blocking sheet is a
 * valid strip-only generation; partial or corrupt declared blocking evidence
 * invalidates the whole visual transport instead of silently dropping image 2.
 */
export function visionCriticImages(
  browserQa: DirectBrowserQaResult | undefined,
): NonNullable<CompleteOptions["images"]> {
  if (!visionCriticEnabled()) return [];
  const evidence = browserQa?.visionCriticEvidence;
  if (!evidence?.stripPngBase64) return [];
  const digest = (base64: string): string => createHash("sha256")
    .update(Buffer.from(base64, "base64"))
    .digest("hex");
  if (digest(evidence.stripPngBase64) !== evidence.stripSha256) return [];
  const blockingFields = [
    evidence.blockingPngBase64,
    evidence.blockingSha256,
    evidence.blockingPath,
  ];
  const hasBlocking = blockingFields.every((value) => value !== undefined);
  if (!hasBlocking && blockingFields.some((value) => value !== undefined)) return [];
  if (hasBlocking &&
      digest(evidence.blockingPngBase64!) !== evidence.blockingSha256) return [];
  return [
    { mimeType: "image/png", base64: evidence.stripPngBase64 },
    ...(hasBlocking
      ? [{ mimeType: "image/png", base64: evidence.blockingPngBase64! }]
      : []),
  ];
}

export function visionCriticPromptLines(imageCount: number): string[] {
  if (!imageCount) return [];
  return [
    "## Rendered visual evidence (native image attachments)",
    "Image 1 is the temporal strip (five interior frames per shot, including",
    "transit). Image 2, when present, is the matching blocking sheet with the",
    "addressed subject outlined in yellow.",
    "Judge value hierarchy, semantic graphics, accidental clipping versus",
    "intentional depth, background motivation, and whether the product fills",
    "the frame. Treat the images as rendered evidence, not as new product facts.",
    "",
  ];
}

function immutableEvidenceFileMatches(
  file: string | undefined,
  expectedSha256: string | undefined,
): boolean {
  if (!file || !expectedSha256) return false;
  try {
    if (!fs.lstatSync(file).isFile()) return false;
    return createHash("sha256")
      .update(fs.readFileSync(file))
      .digest("hex") === expectedSha256;
  } catch {
    return false;
  }
}

export function visionCriticReviewInputs(
  provider: Pick<AgentProvider, "id" | "kind">,
  browserQa: DirectBrowserQaResult | undefined,
): {
  images: NonNullable<CompleteOptions["images"]>;
  promptLines: string[];
  transport: "native" | "read-files" | "unavailable";
} {
  const verified = visionCriticImages(browserQa);
  if (!verified.length) return { images: [], promptLines: [], transport: "unavailable" };
  if (provider.kind === "api") {
    return {
      images: verified,
      promptLines: visionCriticPromptLines(verified.length),
      transport: "native",
    };
  }
  const evidence = browserQa?.visionCriticEvidence;
  if (
    evidence &&
    (provider.id === "codex-cli" || provider.id === "claude-code-cli")
  ) {
    const blockingFields = [
      evidence.blockingPngBase64,
      evidence.blockingSha256,
      evidence.blockingPath,
    ];
    const hasBlocking = blockingFields.every((value) => value !== undefined);
    if (
      (!hasBlocking && blockingFields.some((value) => value !== undefined)) ||
      !immutableEvidenceFileMatches(evidence.stripPath, evidence.stripSha256) ||
      (hasBlocking &&
        !immutableEvidenceFileMatches(evidence.blockingPath, evidence.blockingSha256))
    ) {
      return { images: [], promptLines: [], transport: "unavailable" };
    }
    const paths = [evidence.stripPath, evidence.blockingPath].filter(
      (value): value is string => Boolean(value),
    );
    return {
      images: [],
      promptLines: [
        "## Rendered visual evidence (read-only local PNG files)",
        `Read and visually inspect ${paths.map((value) => JSON.stringify(value)).join(" and ")}.`,
        "The first is the temporal strip (interior and typed-transit frames);",
        "the second, when present, outlines addressed blocking subjects.",
        "Judge value hierarchy, semantic graphics, accidental clipping versus",
        "intentional depth, background motivation, and product frame occupancy.",
        "Treat these files as rendered evidence, not as new product facts.",
        "",
      ],
      transport: "read-files",
    };
  }
  return { images: [], promptLines: [], transport: "unavailable" };
}
