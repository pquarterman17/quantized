// The diverging colormap helpers, moved out of lib/colormap.ts in bundle
// diet slice 24: only the lazy correlation matrix calls them, so they ship
// with it instead of in the eager bundle. The only change is that the RDBU
// stops are read as `COLORMAPS.rdbu` (the same array). Import them by this
// path; colormap.ts does not re-export them (architecture.test.ts,
// DRAGGED_OUT).
import { COLORMAPS, sampleColormap, type RGB } from "./colormap";

/** Diverging sample for a value already in [-1,1] (a correlation
 *  coefficient, a signed loading, …) -> [r,g,b] via the fixed RDBU stops.
 *  Non-finite input reads as the neutral (r=0) midpoint rather than clamping
 *  to an end colour, so a NaN cell (e.g. a constant column) doesn't paint as
 *  a spurious extreme. */
export function diverging(t: number): RGB {
  if (!Number.isFinite(t)) return sampleColormap(COLORMAPS.rdbu, 0.5);
  return sampleColormap(COLORMAPS.rdbu, (Math.max(-1, Math.min(1, t)) + 1) / 2);
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
