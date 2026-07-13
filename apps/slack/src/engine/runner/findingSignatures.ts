const CUT_ENDPOINT_STATIC_FINDING =
  /^cut ([\w-]+)->([\w-]+) (outgoing|incoming) part "([^"]+)" must exist as a data-part inside scene/;
const CUT_ENDPOINT_KIT_FINDING =
  /^kit_markup_incomplete: cut ([\w-]+)->([\w-]+) \([\w-]+\) needs data-part="([^"]+)" in scene "([\w-]+)"/;

/**
 * Normalize one deterministic validation finding into a stable structural
 * signature. Two purposes: (a) the author loop compares signatures across
 * attempts to detect a repair that is not converging, so equivalent findings
 * from different validators (the cut contract's regex gate and the kit markup
 * audit's DOM gate emit differently worded messages for the same defect) must
 * collapse to ONE signature; (b) the persisted run summary reports signatures
 * instead of raw messages, so failed runs can be grouped offline without
 * scraping log lines. Unknown findings keep a truncated `other:` prefix —
 * never raise here.
 */
export function findingSignature(finding: string): string {
  const text = finding.trim();
  const cutStatic = text.match(CUT_ENDPOINT_STATIC_FINDING);
  if (cutStatic) {
    return `cut_missing_${cutStatic[3]}_part:${cutStatic[1]}->${cutStatic[2]}:${cutStatic[4]}`;
  }
  const cutKit = text.match(CUT_ENDPOINT_KIT_FINDING);
  if (cutKit) {
    const side = cutKit[4] === cutKit[2] ? "incoming" : "outgoing";
    return `cut_missing_${side}_part:${cutKit[1]}->${cutKit[2]}:${cutKit[3]}`;
  }
  const cameraRegion = text.match(
    /^scene "([\w-]+)" camera targets region "([^"]+)"/,
  ) ?? text.match(
    /^kit_markup_incomplete: camera path in scene "([\w-]+)" frames data-region="([^"]+)"/,
  );
  if (cameraRegion) {
    return `camera_region_missing:${cameraRegion[1]}:${cameraRegion[2]}`;
  }
  const cameraPart = text.match(
    /^scene "([\w-]+)" camera targets part "([^"]+)"/,
  ) ?? text.match(
    /^kit_markup_incomplete: camera path in scene "([\w-]+)" frames data-part="([^"]+)"/,
  );
  if (cameraPart) {
    return `camera_part_missing:${cameraPart[1]}:${cameraPart[2]}`;
  }
  const componentRoot = text.match(
    /^scene "([\w-]+)" declares component "([^"]+)"/,
  );
  if (componentRoot) {
    return `component_root_missing:${componentRoot[1]}:${componentRoot[2]}`;
  }
  const componentBeat = text.match(
    /beat "([^"]+)" targets component "([^"]+)" but scene "([\w-]+)"/,
  );
  if (componentBeat) {
    return `component_beat_unbound:${componentBeat[3]}:${componentBeat[2]}`;
  }
  const moment = /storyboard\/moments/.test(text)
    ? text.match(/moment "([^"]+)"/)
    : undefined;
  if (moment) return `moment_unbound:${moment[1]}`;
  // Both encodings of one degraded boundary — the raw runtime warning
  // ("cut_degraded: shape-match a->b compiled …") and the measured polish
  // finding ("cut_degraded [data-part=…] (t=…): The storyboard declares a
  // shape-match cut a->b …") — collapse to one signature per boundary.
  if (text.startsWith("cut_degraded")) {
    const boundary = text.match(/\b([\w-]+->[\w-]+)\b/);
    return `cut_degraded:${boundary?.[1] ?? "unknown"}`;
  }
  if (text.startsWith("dom_markup_broken:")) return "dom_markup_broken";
  if (text.startsWith("runtime_bind_exception")) return "runtime_bind_exception";
  if (text.startsWith("kit_markup_incomplete:")) {
    return `kit_markup_incomplete:${text.match(/"([^"]+)"/)?.[1] ?? "unknown"}`;
  }
  if (text.startsWith("browser_warning:")) {
    return `browser_warning:${text.slice(16, 136).trim()}`;
  }
  return `other:${text.slice(0, 120)}`;
}

/**
 * Dedupe merged repair feedback by finding signature BEFORE the 20-item
 * slice: one defect often carries two encodings (a degraded boundary's raw
 * runtime warning + its measured polish finding; an interaction miss repeated
 * across samples), and duplicates crowd geometry findings out of the compact
 * repair prompt. Keeps the longest (most detailed) encoding per signature in
 * first-seen order.
 */
export function dedupeFeedbackBySignature(findings: string[]): string[] {
  const bySignature = new Map<string, string>();
  for (const finding of findings) {
    const signature = findingSignature(finding);
    const existing = bySignature.get(signature);
    if (existing === undefined || finding.length > existing.length) {
      bySignature.set(signature, finding);
    }
  }
  return [...bySignature.values()];
}

/** Boundary key ("from->to") when a signature names a bridged-cut endpoint. */
export function cutSignatureBoundary(signature: string): string | undefined {
  return signature.match(
    /^cut_missing_(?:incoming|outgoing)_part:([\w-]+->[\w-]+):/,
  )?.[1];
}

