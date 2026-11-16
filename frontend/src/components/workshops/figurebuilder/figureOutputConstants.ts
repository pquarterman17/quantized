// Publication-figure output format/style/DPI constants — pure data, no
// React/store dependency. Extracted out of useFigureBuilder.ts (F2.4e) to
// fund the shape-drag addition without raising that file's size-ratchet pin
// (the same "an extraction funds the feature" discipline as F2.3d/F2.3e/
// F2.4d — see architecture.test.ts's TS_MODULE_PINS comment trail for this
// file's pin history). Re-exported from useFigureBuilder.ts so every
// existing importer (FigurePageView.tsx, useFigurePage.ts,
// FigureBuilderView.tsx) stays untouched.

export const FIGURE_FORMATS = ["pdf", "svg", "eps", "png", "tiff"];
export const FIGURE_STYLES = [
  "default",
  "aps",
  "nature",
  "thesis",
  "report",
  "web",
  "presentation",
  "poster",
];
// Calibrated raster DPI per preset, mirrored from
// src/quantized/calc/figure_styles.py's FIGURE_STYLES table (no styles-list
// endpoint exists to fetch this live — keep in sync by hand if the backend
// table changes; tests/test_calc_figure_styles.py guards the source values).
export const FIGURE_STYLE_DPI: Record<string, number> = {
  default: 200,
  aps: 600,
  aps_double: 600,
  nature: 600,
  nature_double: 600,
  thesis: 300,
  report: 300,
  web: 150,
  presentation: 150,
  poster: 150,
};
// Each preset's own figure size in cm (width, height), mirrored by hand from
// the same table (fig_width_cm / fig_height_cm). Display only: the export
// box / preset picker label and the preview's render resolution read it; the
// backend applies the real values. A page size set in Page setup overrides it.
export const FIGURE_STYLE_SIZE_CM: Record<string, readonly [number, number]> = {
  default: [15.24, 10.16],
  aps: [8.6, 6.5],
  aps_double: [17.8, 6.5],
  nature: [8.9, 6.0],
  nature_double: [18.3, 6.0],
  thesis: [15.0, 10.0],
  report: [12.0, 8.5],
  web: [16.0, 10.0],
  presentation: [25.0, 18.0],
  poster: [30.0, 22.0],
};
/** Formats rendered at the chosen DPI; the rest are vector (DPI ignored). */
export const RASTER_FORMATS: readonly string[] = ["png", "tiff"];
