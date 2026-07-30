// Perceptually-uniform sequential colormaps (2-D map viewer) plus one
// diverging colormap (correlation-matrix heatmap, JMP_GAP J10). Pure
// functions: a normalized value t in [0,1] (or [-1,1] for `diverging`) ->
// [r, g, b] (0..255). Out-of-range t clamps. Default sequential is viridis
// (the de-facto scientific heatmap; colour-blind safe).

export type RGB = [number, number, number];

// Viridis anchor stops (sampled from matplotlib's table). Linear interpolation
// between adjacent stops is visually indistinguishable from the full 256-entry
// LUT for our purposes and keeps this dependency-free.
const VIRIDIS: RGB[] = [
  [68, 1, 84],
  [71, 44, 122],
  [59, 81, 139],
  [44, 113, 142],
  [33, 144, 141],
  [39, 173, 129],
  [92, 200, 99],
  [170, 220, 50],
  [253, 231, 37],
];

const MAGMA: RGB[] = [
  [0, 0, 4],
  [40, 11, 84],
  [101, 21, 110],
  [159, 42, 99],
  [212, 72, 66],
  [245, 125, 21],
  [250, 193, 39],
  [252, 255, 164],
];

const GRAY: RGB[] = [
  [0, 0, 0],
  [255, 255, 255],
];

// ColorBrewer RdBu-11 (colorbrewer2.org, public-domain) reversed so POSITIVE
// reads warm/red and NEGATIVE reads cool/blue — the JMP/matplotlib "coolwarm"
// convention for a correlation matrix (r in [-1,1]). White at the r=0
// midpoint. Used by `diverging()` (multivariate workbench, JMP_GAP J10) —
// same fixed-stops-regardless-of-theme convention as VIRIDIS/MAGMA above.
const RDBU: RGB[] = [
  [5, 48, 97],
  [33, 102, 172],
  [67, 147, 195],
  [146, 197, 222],
  [209, 229, 240],
  [247, 247, 247],
  [253, 219, 199],
  [244, 165, 130],
  [214, 96, 77],
  [178, 24, 43],
  [103, 0, 13],
];

export const COLORMAPS = { viridis: VIRIDIS, magma: MAGMA, gray: GRAY, rdbu: RDBU } as const;
export type ColormapName = keyof typeof COLORMAPS;

/** Sample a colormap at t in [0,1] (clamped) -> [r,g,b]. */
export function sampleColormap(stops: RGB[], t: number): RGB {
  if (!Number.isFinite(t)) return stops[0];
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const span = stops.length - 1;
  const pos = x * span;
  const i = Math.min(span - 1, Math.floor(pos));
  const f = pos - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Convenience: sample a named colormap. */
export function colormap(name: ColormapName, t: number): RGB {
  return sampleColormap(COLORMAPS[name], t);
}

/** `rgb(...)` CSS string for a named-colormap sample (for the colorbar legend). */
export function colormapCss(name: ColormapName, t: number): string {
  const [r, g, b] = colormap(name, t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Diverging sample for a value already in [-1,1] (a correlation
 *  coefficient, a signed loading, …) -> [r,g,b] via the fixed RDBU stops.
 *  Non-finite input reads as the neutral (r=0) midpoint rather than clamping
 *  to an end colour, so a NaN cell (e.g. a constant column) doesn't paint as
 *  a spurious extreme. */
export function diverging(t: number): RGB {
  if (!Number.isFinite(t)) return sampleColormap(RDBU, 0.5);
  return sampleColormap(RDBU, (Math.max(-1, Math.min(1, t)) + 1) / 2);
}

/** `rgb(...)` CSS string for `diverging()` (correlation-matrix cell fills). */
export function divergingCss(t: number): string {
  const [r, g, b] = diverging(t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** WCAG relative luminance (0=black, 1=white) of an sRGB byte triple —
 *  same formula as `lib/contrastColor.ts`'s (unexported) helper, duplicated
 *  rather than imported so this stays a dependency-free pure-math module
 *  like its VIRIDIS/MAGMA/GRAY neighbours. */
function relativeLuminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Legible text ink over a filled colormap cell (a correlation-matrix cell,
 *  a heatmap tile): near-white for a dark/saturated fill, near-black for a
 *  light one. Achromatic on purpose — same "swap for legibility, never hue-
 *  shift" convention as `lib/contrastColor.ts`. */
export function cellInk(rgb: RGB): string {
  return relativeLuminance(rgb) < 0.42 ? "#f2f2f2" : "#1a1a1a";
}

/** Normalize a value to [0,1] for colour mapping. Linear: (v-lo)/(hi-lo).
 *  Log: (ln v - ln lo)/(ln hi - ln lo), assuming lo>0 — essential for RSM /
 *  diffraction data spanning many decades. Returns null (= transparent cell)
 *  for non-finite v, or a non-positive v in log mode. A degenerate range
 *  (hi<=lo) collapses to 0. */
export function normalize(v: number, lo: number, hi: number, log: boolean): number | null {
  if (!Number.isFinite(v)) return null;
  if (log) {
    if (v <= 0) return null;
    if (lo <= 0 || hi <= lo) return 0;
    return (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
  }
  if (hi <= lo) return 0;
  return (v - lo) / (hi - lo);
}
