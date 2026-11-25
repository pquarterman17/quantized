// The style presets' calibrated raster DPI. A leaf module on purpose: only lazy
// code (the figure builders, Preferences ▸ Export) imports it, so it stays out of
// the eager bundle. Re-exported by figurebuilder/figureOutputConstants.

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
