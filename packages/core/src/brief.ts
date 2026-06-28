import { z } from "zod";
import type { Project } from "./schema.ts";
import type { Plan } from "./plan.ts";

export const StructuredBriefSchema = z.object({
  productName: z.string().trim().min(1).max(60),
  audience: z.string().trim().max(80).default("product teams"),
  promise: z.string().trim().min(1).max(120),
  features: z.array(z.string().trim().min(1).max(80)).min(1).max(3),
  cta: z.string().trim().min(1).max(50),
  /** 0 = calm/warm, 50 = crisp, 100 = bold launch. */
  vibe: z.number().min(0).max(100).default(50),
});
export type StructuredBrief = z.infer<typeof StructuredBriefSchema>;

function words(text: string, max: number): string {
  return text.trim().split(/\s+/).slice(0, max).join(" ");
}

export function structuredBriefToPlan(project: Project, input: StructuredBrief): Plan {
  const brief = StructuredBriefSchema.parse(input);
  const profile =
    brief.vibe >= 72 ? "bold-launch" : brief.vibe <= 30 ? "warm-startup" : "crisp-saas";
  const media = project.assets.find((asset) => asset.kind === "image" || asset.kind === "video");
  const scenes: Plan["scenes"] = [
    {
      id: "hook",
      archetype: "hook-opener",
      layout: brief.vibe >= 65 ? "left" : "center",
      slots: {
        headline: words(brief.promise, 7),
        subline: words(`${brief.productName} for ${brief.audience}`, 14),
      },
    },
  ];
  if (media) {
    scenes.push({
      id: "feature",
      archetype: "feature-reveal",
      layout: brief.vibe >= 65 ? "full-bleed" : "media-right",
      slots: {
        headline: words(brief.features[0]!, 7),
        media: {
          assetId: media.id,
          presentation: media.kind === "video" ? "plain" : "device",
        },
        bullets: brief.features.slice(0, 3).map((feature) => words(feature, 8)),
      },
      camera: { move: "pushIn", scale: "subtle" },
    });
  } else {
    scenes.push({
      id: "features",
      archetype: "hook-opener",
      layout: "left",
      slots: {
        headline: words(brief.features[0]!, 7),
        subline: words(brief.features.slice(1).join(" · ") || brief.promise, 14),
      },
    });
  }
  scenes.push({
    id: "cta",
    archetype: "logo-sting-cta",
    slots: {
      tagline: words(brief.promise, 8),
      cta: words(brief.cta, 5),
    },
  });
  return { motionProfile: profile, scenes };
}

export function structuredBriefToText(input: StructuredBrief): string {
  const brief = StructuredBriefSchema.parse(input);
  return [
    `${brief.productName} for ${brief.audience}.`,
    brief.promise,
    `Features: ${brief.features.join("; ")}.`,
    `CTA: ${brief.cta}.`,
    `Vibe: ${brief.vibe}/100.`,
  ].join(" ");
}
