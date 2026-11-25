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
// Calibrated raster DPI per preset: lib/figureStyleDpi.ts (shared with
// Preferences ▸ Export); re-exported for existing importers.
export { FIGURE_STYLE_DPI } from "../../../lib/figureStyleDpi";
// Each preset's size moved to lib/figurePresets.ts with the preset names
// (shared by every preset picker); re-exported for existing importers.
export { FIGURE_STYLE_SIZE_CM } from "../../../lib/figurePresets";
/** Formats rendered at the chosen DPI; the rest are vector (DPI ignored). */
export const RASTER_FORMATS: readonly string[] = ["png", "tiff"];
