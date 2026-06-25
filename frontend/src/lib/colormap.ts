// Perceptually-uniform colormaps for the 2-D map viewer. Pure functions: a
// normalized value t in [0,1] -> [r, g, b] (0..255). Out-of-range t clamps.
// Default is viridis (the de-facto scientific heatmap; colour-blind safe).

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

export const COLORMAPS = { viridis: VIRIDIS, magma: MAGMA, gray: GRAY } as const;
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
