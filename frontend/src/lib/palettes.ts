// Series colour-cycle presets. Everything that draws a series resolves its colour
// from the `--series-1..8` CSS custom properties (plot, legend, multi-panel, inset,
// sparkline, export). So a "palette" is just an override of those eight tokens on
// <html> — pick one and it flows everywhere for free, exactly like theme/accent.
// "default" removes the overrides, falling back to the theme's own tokens.
//
// CB-safe = colour-blind-safe (Okabe–Ito and Paul Tol's "bright" qualitative set).

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
    // Paul Tol's 7-colour "bright" set; the 8th cycles back to the first.
    colors: ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB", "#4477AA"],
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
