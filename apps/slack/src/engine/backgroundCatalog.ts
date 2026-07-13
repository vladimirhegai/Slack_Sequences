/**
 * Production-cleared wallpaper catalog.
 *
 * The 18 vendored JPEGs are MIT-licensed for production use. Their license
 * manifest lives beside the files at `vendor/wallpapers/LICENSE`; staging
 * code must copy that notice with the ONE wallpaper selected for a film.
 */

export type BackgroundEnergy = "quiet" | "moderate" | "bold" | "kinetic";
export type BackgroundTextSafeSide =
  | "left"
  | "right"
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "center";
export type BackgroundOverlayMode = "none" | "full-scrim" | "localized-scrim" | "gradient-scrim";
export type BackgroundMotionMode =
  | "static"
  | "micro-drift"
  | "slow-push"
  | "slow-pan-left"
  | "slow-pan-right"
  | "slow-pan-up";

export interface BackgroundCatalogEntry {
  id: string;
  /** Repository-relative source path. Projects receive a selected local copy. */
  file: `vendor/wallpapers/${string}.jpg`;
  dimensions: { width: number; height: number };
  aspect: { ratio: number; label: string };
  focalPoint: { x: number; y: number; description: string };
  textSafeSide: BackgroundTextSafeSide;
  energy: BackgroundEnergy;
  crop: {
    fit: "cover";
    objectPosition: string;
    recommendation: string;
  };
  overlay: {
    mode: BackgroundOverlayMode;
    opacity: number;
    recommendation: string;
  };
  motion: {
    mode: BackgroundMotionMode;
    maxTravelPercent: number;
    maxScale: number;
    description: string;
  };
  provenance: {
    status: "production-cleared";
    licenseManifestPresent: true;
    customerProjectUse: "allowed";
    license: "MIT";
    note: string;
  };
}

/** Compatibility alias for callers compiled against the catalog's old name. */
export type BackgroundMoodboardEntry = BackgroundCatalogEntry;

const PRODUCTION_CLEARED = {
  status: "production-cleared",
  licenseManifestPresent: true,
  customerProjectUse: "allowed",
  license: "MIT",
  note: "MIT license manifest verified; stage one selected wallpaper plus the license notice per film.",
} as const;

export const BACKGROUND_CATALOG: readonly BackgroundCatalogEntry[] = [
  {
    id: "wallpaper-01",
    file: "vendor/wallpapers/wallpaper1.jpg",
    dimensions: { width: 5724, height: 3816 },
    aspect: { ratio: 1.5, label: "3:2" },
    focalPoint: { x: 0.68, y: 0.58, description: "Dark crimson ridge and reflected wave across the lower-right half." },
    textSafeSide: "top-left",
    energy: "moderate",
    crop: { fit: "cover", objectPosition: "62% 54%", recommendation: "For 16:9, preserve the upper red field and the right ridge; trim mostly from the bottom." },
    overlay: { mode: "gradient-scrim", opacity: 0.22, recommendation: "Use a light left-side burgundy scrim only when white copy needs more separation." },
    motion: { mode: "slow-pan-right", maxTravelPercent: 2.5, maxScale: 1.035, description: "A restrained rightward crop drift follows the ridge; never animate the bands independently." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-02",
    file: "vendor/wallpapers/wallpaper2.jpg",
    dimensions: { width: 2800, height: 2800 },
    aspect: { ratio: 1, label: "1:1" },
    focalPoint: { x: 0.54, y: 0.04, description: "Warm ray origin at the top edge, opening into blue and orange vertical fans." },
    textSafeSide: "bottom-left",
    energy: "bold",
    crop: { fit: "cover", objectPosition: "52% 24%", recommendation: "For 16:9, keep the ray origin just inside the top edge and favor the darker blue lower-left lane." },
    overlay: { mode: "gradient-scrim", opacity: 0.28, recommendation: "Darken the lower-left blue lane for white copy; leave the warm ray core unobscured." },
    motion: { mode: "slow-push", maxTravelPercent: 1.5, maxScale: 1.045, description: "A very slow push toward the ray origin creates lift without making the fan pulse." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-03",
    file: "vendor/wallpapers/wallpaper3.jpg",
    dimensions: { width: 4096, height: 2304 },
    aspect: { ratio: 1.7778, label: "16:9" },
    focalPoint: { x: 0.48, y: 0.5, description: "High-contrast coral, white, gold, and blue wave crossing the center." },
    textSafeSide: "top-right",
    energy: "kinetic",
    crop: { fit: "cover", objectPosition: "50% 50%", recommendation: "Native 16:9 composition; keep the white ribbon and coral crest centered." },
    overlay: { mode: "localized-scrim", opacity: 0.34, recommendation: "Use a compact navy scrim behind top-right copy; avoid flattening the whole color field." },
    motion: { mode: "micro-drift", maxTravelPercent: 1.8, maxScale: 1.025, description: "Only a sub-2% diagonal crop drift; the image already carries substantial directional energy." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-04",
    file: "vendor/wallpapers/wallpaper4.jpg",
    dimensions: { width: 6016, height: 6016 },
    aspect: { ratio: 1, label: "1:1" },
    focalPoint: { x: 0.4, y: 0.54, description: "Cyan-violet wave crest crossing a dark navy upper field." },
    textSafeSide: "top-right",
    energy: "bold",
    crop: { fit: "cover", objectPosition: "48% 42%", recommendation: "For 16:9, retain the calm navy upper band and one complete cyan crest." },
    overlay: { mode: "none", opacity: 0, recommendation: "The navy top field already supports light copy; add no full-frame wash." },
    motion: { mode: "slow-pan-right", maxTravelPercent: 2, maxScale: 1.03, description: "Follow the cyan crest gently toward the right while the text rail stays fixed." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-05",
    file: "vendor/wallpapers/wallpaper5.jpg",
    dimensions: { width: 6016, height: 6016 },
    aspect: { ratio: 1, label: "1:1" },
    focalPoint: { x: 0.42, y: 0.52, description: "Large coral crest against a clean blue upper field." },
    textSafeSide: "top-right",
    energy: "bold",
    crop: { fit: "cover", objectPosition: "50% 43%", recommendation: "For 16:9, crop through the lower blue floor but preserve the coral-to-white-to-blue layering." },
    overlay: { mode: "localized-scrim", opacity: 0.18, recommendation: "Use a small cool-blue scrim behind right-aligned white copy if required." },
    motion: { mode: "slow-pan-right", maxTravelPercent: 2, maxScale: 1.03, description: "A quiet lateral drift lets the coral crest pass beneath fixed copy." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-06",
    file: "vendor/wallpapers/wallpaper6.jpg",
    dimensions: { width: 6016, height: 6016 },
    aspect: { ratio: 1, label: "1:1" },
    focalPoint: { x: 0.5, y: 0.76, description: "Red-orange valley floor framed by pale blue and rose canyon walls." },
    textSafeSide: "top-center",
    energy: "moderate",
    crop: { fit: "cover", objectPosition: "50% 48%", recommendation: "For 16:9, preserve the pale central sky and enough dark lower ridge to ground the frame." },
    overlay: { mode: "localized-scrim", opacity: 0.12, recommendation: "Use a faint translucent white or charcoal text plate, chosen for copy polarity; do not grade the full frame." },
    motion: { mode: "slow-push", maxTravelPercent: 1.5, maxScale: 1.04, description: "Push slowly into the valley opening; stop before the pale reading lane leaves frame." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-07",
    file: "vendor/wallpapers/wallpaper7.jpg",
    dimensions: { width: 6016, height: 6016 },
    aspect: { ratio: 1, label: "1:1" },
    focalPoint: { x: 0.42, y: 0.55, description: "Purple and magenta wave stack beneath a warm orange upper field." },
    textSafeSide: "top-right",
    energy: "bold",
    crop: { fit: "cover", objectPosition: "52% 43%", recommendation: "For 16:9, keep the orange field spacious and the small pale crest near the lower-right third." },
    overlay: { mode: "localized-scrim", opacity: 0.2, recommendation: "A compact warm-dark scrim can stabilize top-right white copy without muting the orange field." },
    motion: { mode: "slow-pan-left", maxTravelPercent: 2, maxScale: 1.025, description: "Let the purple crest drift left under a stationary headline." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-08",
    file: "vendor/wallpapers/wallpaper8.jpg",
    dimensions: { width: 7680, height: 7680 },
    aspect: { ratio: 1, label: "1:1" },
    focalPoint: { x: 0.52, y: 0.72, description: "Pink valley floor framed by layered magenta and blush canyon walls." },
    textSafeSide: "top-center",
    energy: "moderate",
    crop: { fit: "cover", objectPosition: "50% 47%", recommendation: "For 16:9, center the pale canyon opening and keep saturated magenta as a lower frame." },
    overlay: { mode: "localized-scrim", opacity: 0.1, recommendation: "The pale center can hold dark copy with only a subtle translucent plate." },
    motion: { mode: "slow-push", maxTravelPercent: 1.5, maxScale: 1.04, description: "Push into the pale opening with no lateral wobble." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-09",
    file: "vendor/wallpapers/wallpaper9.jpg",
    dimensions: { width: 6016, height: 6016 },
    aspect: { ratio: 1, label: "1:1" },
    focalPoint: { x: 0.48, y: 0.58, description: "Lime fabric-like folds beneath coral, lavender, and blue diagonals." },
    textSafeSide: "top-right",
    energy: "kinetic",
    crop: { fit: "cover", objectPosition: "53% 48%", recommendation: "For 16:9, retain one clean blue upper corner and the lime folds; expect aggressive square-to-wide cropping." },
    overlay: { mode: "gradient-scrim", opacity: 0.36, recommendation: "Use a cool navy gradient under top-right copy; this field is too active for unbacked body text." },
    motion: { mode: "static", maxTravelPercent: 0, maxScale: 1, description: "Keep static. The crossing diagonals and folds already create more than enough motion energy." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-10",
    file: "vendor/wallpapers/wallpaper10.jpg",
    dimensions: { width: 6016, height: 6016 },
    aspect: { ratio: 1, label: "1:1" },
    focalPoint: { x: 0.52, y: 0.73, description: "Violet valley floor beneath pale rose canyon layers." },
    textSafeSide: "top-center",
    energy: "moderate",
    crop: { fit: "cover", objectPosition: "50% 47%", recommendation: "For 16:9, preserve the pale upper opening and use the deep violet lower-left as a grounding edge." },
    overlay: { mode: "localized-scrim", opacity: 0.12, recommendation: "Use dark copy in the pale lane with a faint frosted plate only when needed." },
    motion: { mode: "slow-push", maxTravelPercent: 1.5, maxScale: 1.04, description: "A centered push makes the valley feel dimensional without shifting the safe lane." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-11",
    file: "vendor/wallpapers/wallpaper11.jpg",
    dimensions: { width: 4096, height: 2264 },
    aspect: { ratio: 1.8092, label: "~16:9" },
    focalPoint: { x: 0.53, y: 0.03, description: "Warm sunburst origin above long orange and blue rays." },
    textSafeSide: "bottom-left",
    energy: "bold",
    crop: { fit: "cover", objectPosition: "52% 24%", recommendation: "Near-native wide crop; keep the sunburst centered and reserve the deep-blue lower-left lane for copy." },
    overlay: { mode: "gradient-scrim", opacity: 0.25, recommendation: "Deepen the lower-left blue slightly for white copy; avoid covering the bright origin." },
    motion: { mode: "slow-push", maxTravelPercent: 1.5, maxScale: 1.04, description: "Push toward the sunburst by no more than 4%." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-12",
    file: "vendor/wallpapers/wallpaper12.jpg",
    dimensions: { width: 4096, height: 2262 },
    aspect: { ratio: 1.8108, label: "~16:9" },
    focalPoint: { x: 0.54, y: 0.03, description: "Mint ray origin opening over saturated blue and violet lanes." },
    textSafeSide: "bottom-left",
    energy: "bold",
    crop: { fit: "cover", objectPosition: "52% 24%", recommendation: "Near-native wide crop; preserve the mint center ray and dark violet lower-left." },
    overlay: { mode: "gradient-scrim", opacity: 0.2, recommendation: "Use a subtle violet scrim under lower-left white copy." },
    motion: { mode: "slow-push", maxTravelPercent: 1.5, maxScale: 1.04, description: "A slow push toward the ray origin is sufficient; do not rotate or pulse." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-13",
    file: "vendor/wallpapers/wallpaper13.jpg",
    dimensions: { width: 4717, height: 2984 },
    aspect: { ratio: 1.5808, label: "~8:5" },
    focalPoint: { x: 0.58, y: 0.5, description: "Moonlit mountain peak centered slightly right beneath a broad teal night sky." },
    textSafeSide: "top-left",
    energy: "quiet",
    crop: { fit: "cover", objectPosition: "56% 48%", recommendation: "For 16:9, keep the primary peak on the right third and preserve open sky on the left." },
    overlay: { mode: "gradient-scrim", opacity: 0.18, recommendation: "A very light teal-black gradient can protect upper-left white copy while retaining stars." },
    motion: { mode: "slow-pan-right", maxTravelPercent: 1.8, maxScale: 1.025, description: "A nearly imperceptible pan toward the primary peak; keep the horizon level." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-14",
    file: "vendor/wallpapers/wallpaper14.jpg",
    dimensions: { width: 6016, height: 3889 },
    aspect: { ratio: 1.5469, label: "~3:2" },
    focalPoint: { x: 0.55, y: 0.5, description: "Pale central channel between blue contour pools and a red-orange basin." },
    textSafeSide: "center",
    energy: "kinetic",
    crop: { fit: "cover", objectPosition: "53% 50%", recommendation: "For 16:9, keep the pale S-curve through center; trim evenly from top and bottom." },
    overlay: { mode: "localized-scrim", opacity: 0.26, recommendation: "Use a compact translucent plate in the pale center; surrounding contours are too active for long copy." },
    motion: { mode: "micro-drift", maxTravelPercent: 1.5, maxScale: 1.02, description: "A tiny drift along the central S-curve; avoid zooming into either saturated basin." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-15",
    file: "vendor/wallpapers/wallpaper15.jpg",
    dimensions: { width: 6016, height: 3900 },
    aspect: { ratio: 1.5426, label: "~3:2" },
    focalPoint: { x: 0.5, y: 0.58, description: "Soft peach cloud bank beneath open cyan and rose atmosphere." },
    textSafeSide: "top-left",
    energy: "quiet",
    crop: { fit: "cover", objectPosition: "48% 48%", recommendation: "For 16:9, preserve blue atmosphere above the cloud bank and trim the warm lower haze." },
    overlay: { mode: "localized-scrim", opacity: 0.14, recommendation: "Use a small cool translucent plate for white or navy copy; do not sharpen the intentionally soft field." },
    motion: { mode: "slow-pan-left", maxTravelPercent: 2, maxScale: 1.02, description: "A gentle lateral cloud drift; no scale breathing." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-16",
    file: "vendor/wallpapers/wallpaper16.jpg",
    dimensions: { width: 6016, height: 3900 },
    aspect: { ratio: 1.5426, label: "~3:2" },
    focalPoint: { x: 0.48, y: 0.46, description: "Curved boundary where pale coral paint sweeps into blue-black pigment." },
    textSafeSide: "right",
    energy: "kinetic",
    crop: { fit: "cover", objectPosition: "54% 50%", recommendation: "For 16:9, retain both the pale left field and a generous dark right field; keep the arc near center." },
    overlay: { mode: "gradient-scrim", opacity: 0.14, recommendation: "The dark right field already supports white display copy; use only a minimal edge scrim for body text." },
    motion: { mode: "slow-pan-right", maxTravelPercent: 2, maxScale: 1.025, description: "Track the painted arc slowly into the dark field; never spin the canvas." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-17",
    file: "vendor/wallpapers/wallpaper17.jpg",
    dimensions: { width: 6016, height: 3900 },
    aspect: { ratio: 1.5426, label: "~3:2" },
    focalPoint: { x: 0.58, y: 0.56, description: "Dark blue diagonal brush ridge dividing a warm sky from a pale aqua sweep." },
    textSafeSide: "top-left",
    energy: "kinetic",
    crop: { fit: "cover", objectPosition: "54% 50%", recommendation: "For 16:9, preserve the diagonal ridge and the warm upper-left reading field." },
    overlay: { mode: "localized-scrim", opacity: 0.18, recommendation: "Use a warm translucent plate behind dark upper-left copy; keep the painted texture visible." },
    motion: { mode: "slow-pan-right", maxTravelPercent: 2, maxScale: 1.025, description: "Follow the diagonal ridge rightward at low velocity." },
    provenance: PRODUCTION_CLEARED,
  },
  {
    id: "wallpaper-18",
    file: "vendor/wallpapers/wallpaper18.jpg",
    dimensions: { width: 6016, height: 3900 },
    aspect: { ratio: 1.5426, label: "~3:2" },
    focalPoint: { x: 0.55, y: 0.62, description: "Layered blue-green valley and winding pale river framed by warm foreground hills." },
    textSafeSide: "top-center",
    energy: "moderate",
    crop: { fit: "cover", objectPosition: "52% 47%", recommendation: "For 16:9, retain the open sky band and the winding river; trim mostly from the warm foreground." },
    overlay: { mode: "gradient-scrim", opacity: 0.16, recommendation: "A light sky-toned scrim can support dark top-center copy without obscuring the mountain layers." },
    motion: { mode: "slow-push", maxTravelPercent: 1.5, maxScale: 1.035, description: "Push slowly along the river toward the distant hills; stop before the sky reading band disappears." },
    provenance: PRODUCTION_CLEARED,
  },
] as const;

export function backgroundById(id: string): BackgroundCatalogEntry | undefined {
  return BACKGROUND_CATALOG.find((entry) => entry.id === id);
}
