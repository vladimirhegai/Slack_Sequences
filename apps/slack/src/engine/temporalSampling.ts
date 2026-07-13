import type { CameraBlockingPlanV1 } from "./cameraBlocking.ts";

/**
 * Canonical interior-frame cadence shared by the persisted temporal strip and
 * the pre-critique visual pack. Keeping this pure prevents the critic from
 * reviewing only settled hero poses while the operator's strip exposes
 * clipped or incoherent transit frames.
 */
export function temporalInteriorFractions(framesPerShot = 5): number[] {
  const count = Math.max(3, Math.min(7, Math.round(framesPerShot)));
  return Array.from(
    { length: count },
    (_, index) => 0.08 + (0.84 * index) / (count - 1),
  );
}

export function temporalSceneSampleTimes(
  startSec: number,
  durationSec: number,
  extraTimes: readonly number[] = [],
  framesPerShot = 5,
): number[] {
  const endSec = startSec + durationSec;
  const base = temporalInteriorFractions(framesPerShot)
    .map((fraction) => startSec + durationSec * fraction);
  return [...new Set([...base, ...extraTimes]
    .filter((time) => Number.isFinite(time) && time > startSec && time < endSec)
    .map((time) => Math.round(time * 10_000) / 10_000))]
    .sort((a, b) => a - b);
}

export function primaryBlockingTransitTimes(
  plan: CameraBlockingPlanV1 | undefined,
  sceneId: string,
): number[] {
  return (plan?.scenes.find((scene) => scene.sceneId === sceneId)?.phrases ?? [])
    .filter((phrase) => phrase.importance === "primary" && phrase.arrivalSec > phrase.startSec)
    .map((phrase) => Math.round(
      (phrase.startSec + (phrase.arrivalSec - phrase.startSec) * 0.5) * 10_000,
    ) / 10_000);
}
