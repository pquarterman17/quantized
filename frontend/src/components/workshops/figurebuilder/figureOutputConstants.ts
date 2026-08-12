// Publication-figure output format/style/DPI constants — pure data, no
// React/store dependency. Extracted out of useFigureBuilder.ts (F2.4e) to
// fund the shape-drag addition without raising that file's size-ratchet pin
// (the same "an extraction funds the feature" discipline as F2.3d/F2.3e/
// F2.4d — see architecture.test.ts's TS_MODULE_PINS comment trail for this
// file's pin history). Re-exported from useFigureBuilder.ts so every
// existing importer (FigurePageView.tsx, useFigurePage.ts,
// FigureBuilderView.tsx) stays untouched.

export const FIGURE_FORMATS = ["pdf", "svg", "png", "tiff"];
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
  nature: 600,
  thesis: 300,
  report: 300,
  web: 150,
  presentation: 150,
  poster: 150,
};
