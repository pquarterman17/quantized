// Series colour-cycle presets. Everything that draws a series resolves its colour
// from the `--series-1..8` CSS custom properties (plot, legend, multi-panel, inset,
// sparkline, export). So a "palette" is just an override of those eight tokens on
// <html> — pick one and it flows everywhere for free, exactly like theme/accent.
// "default" removes the overrides, falling back to the theme's own tokens.
//
// CB-safe = colour-blind-safe (Okabe–Ito; and Paul Tol's "bright" qualitative
// set, extended with one hue borrowed from Tol's companion "muted" scheme —
// "bright" itself has no official 8th colour, see the `tol-bright` entry
// below).

export interface Palette {
  value: string;
  label: string;
  /** Eight cycle colours, or null for the theme default (no override). */
  colors: string[] | null;
}

export const PALETTES: Palette[] = [
  { value: "default", label: "Theme default", colors: null },
  {
    value: "okabe-ito",
    label: "Okabe–Ito (CB-safe)",
    // Okabe–Ito's 8th is black; swapped to light grey so it reads on dark canvas.
    colors: ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#BBBBBB"],
  },
  {
    value: "tol-bright",
    label: "Tol bright (CB-safe)",
    // Paul Tol's 7-colour "bright" set has no official 8th colour. The 8th
    // slot used to cycle back to the 1st (#4477AA) — an exact duplicate,
    // indistinguishable even under normal vision (0 series-vs-series ΔE),
    // not just a CVD failure. Tol's companion "muted" scheme was borrowed for
    // a distinct 8th hue, but its indigo (#332288) fails this app's own
    // dark-canvas legibility floor (`lib/contrastColor.ts`'s MIN_CONTRAST —
    // 1.54 vs 2.2, so `resolveDrawColor` would silently substitute the ink
    // token on our default dark plot canvas, and the legend would disagree
    // with the canvas). Slot 8 is `#999933` (Tol-muted olive) instead:
    // contrast 6.21 on dark and 2.85 on light (both clear 2.2), and the
    // series-vs-series distinguishability verdict is unaffected — the
    // tritan worst pair (series-1 vs series-3, ΔE ~13.2) doesn't involve
    // slot 8 either way. #BBBBBB isn't reused since it's already the 7th
    // colour. See seriesPalette.cvd.test.ts's "shipped palette presets"
    // audit (dark-canvas legibility ratchet + distinguishability verdict)
    // for the measured numbers, and PRIMARY_SOFTWARE_AUDIT_PLAN.md's P3.3
    // owner box — this hex was picked to close a legibility bug, not by
    // design-owner ratification; it can be replaced.
    colors: ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB", "#999933"],
  },
  {
    value: "tableau10",
    label: "Tableau 10",
    colors: ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7"],
  },
  {
    value: "viridis",
    label: "Viridis",
    // Sampled across viridis (skips the very dark end so it shows on dark canvas).
    colors: ["#482878", "#3E4A89", "#31688E", "#26828E", "#1F9E89", "#35B779", "#6DCD59", "#FDE725"],
  },
];

const SERIES_COUNT = 8;

/** Apply a palette by overriding `--series-1..8` on <html> (or clearing them for
 *  the theme default). Idempotent; safe to call on every change + on load. */
export function applyPalette(value: string): void {
  const el = document.documentElement;
  const colors = PALETTES.find((p) => p.value === value)?.colors ?? null;
  for (let i = 0; i < SERIES_COUNT; i++) {
    const prop = `--series-${i + 1}`;
    if (colors) el.style.setProperty(prop, colors[i % colors.length]);
    else el.style.removeProperty(prop);
  }
}

/** A valid palette value (falls back to "default"). */
export function normalizePalette(value: unknown): string {
  return PALETTES.some((p) => p.value === value) ? (value as string) : "default";
}
