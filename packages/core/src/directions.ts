import type { Plan } from "./plan.ts";
import type { Project } from "./schema.ts";
import { ARCHETYPES, PROFILES, enabledExtensionIds } from "./registry/index.ts";

export interface Direction {
  id: string;
  name: string;
  rationale: string;
  plan: Plan;
}

export function deriveDirections(base: Plan, project: Project): Direction[] {
  const enabled = enabledExtensionIds(project);
  const preferred = [base.motionProfile, "crisp-saas", "warm-startup", "bold-launch"].filter(
    (id, index, all) =>
      Boolean(PROFILES[id]) && enabled.has(id) && all.indexOf(id) === index,
  );
  const opener = base.scenes[0];
  return preferred.slice(0, 3).map((profile, index) => {
    const plan = structuredClone(base);
    plan.motionProfile = profile;
    if (opener && ARCHETYPES[opener.archetype]) {
      const layouts = ARCHETYPES[opener.archetype]!.layouts;
      plan.scenes[0]!.layout = layouts[index % layouts.length];
    }
    const name =
      profile === "bold-launch"
        ? "Launch energy"
        : profile === "warm-startup"
          ? "Human warmth"
          : "Crisp product";
    return {
      id: `direction-${index + 1}`,
      name,
      rationale: `${name} using ${profile} with a distinct opener composition.`,
      plan,
    };
  });
}
