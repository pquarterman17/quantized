// Geometry of the Publication preview's picture (UX audit 7, lane UX-H): the
// resolution to render the preview PNG at, and the figure's physical size
// read back from the rendered pixels. Pure, no React.
//
// The backend draws the figure at exactly its page size (no tight-bbox crop,
// calc/figure_layout.py), so a preview rendered at `dpi` is
// `width_in * dpi` pixels wide, and the physical size the ruler shows is the
// pixel size divided by that same dpi — whatever overrode the preset's size.

import type { FigureSpec } from "../../../lib/api/figures";
import { fromInches, toInches } from "../../../lib/pageGeometry";
import { FIGURE_STYLE_SIZE_CM } from "../../../lib/figurePresets";

/** CSS reference pixels per inch: "100 %" shows the figure at this scale. */
export const CSS_PX_PER_IN = 96;
/** Pixel width the preview aims for at 1 device pixel per CSS pixel, so
 *  "fit" in a ~800 px pane is not an up-scaled blur of a small journal-column
 *  figure; scaled by the display's devicePixelRatio, but never past
 *  MAX_TARGET_PX (render cost grows with pixel count, on every debounced
 *  keystroke). */
const TARGET_PX = 960;
const MAX_TARGET_PX = 1600;
const MIN_DPI = 110; // the old fixed preview resolution: never coarser
const MAX_DPI = 300; // bounds render cost for a tiny figure

/** The figure's width in inches as the export will size it: the request's
 *  own page width, else its style preset's, else the default preset's. */
export function specWidthIn(spec: Pick<FigureSpec, "width_in" | "style">): number {
  if (spec.width_in && spec.width_in > 0) return spec.width_in;
  const preset = FIGURE_STYLE_SIZE_CM[spec.style ?? "default"] ?? FIGURE_STYLE_SIZE_CM.default;
  return toInches(preset[0], "cm");
}

/** The preview's render resolution for `spec`: ~TARGET_PX wide, clamped. A
 *  facet grid is drawn several panels wide (figure_facets_grid.py), wider
 *  than the preset says, so it keeps the old floor resolution instead of
 *  multiplying the render's pixel count. */
export function previewDpiFor(spec: Pick<FigureSpec, "width_in" | "style" | "facets">, devicePixelRatio = 1): number {
  if (spec.facets?.length) return MIN_DPI;
  const target = Math.min(MAX_TARGET_PX, TARGET_PX * Math.max(1, devicePixelRatio || 1));
  return Math.round(Math.min(MAX_DPI, Math.max(MIN_DPI, target / specWidthIn(spec))));
}

/** Physical size in cm of a `widthPx` × `heightPx` render made at `dpi`. */
export function renderedSizeCm(widthPx: number, heightPx: number, dpi: number): { widthCm: number; heightCm: number } {
  return { widthCm: fromInches(widthPx / dpi, "cm"), heightCm: fromInches(heightPx / dpi, "cm") };
}

/** On-screen CSS width of a figure `widthCm` wide shown at true size. */
export function trueSizeCssPx(widthCm: number): number {
  return toInches(widthCm, "cm") * CSS_PX_PER_IN;
}

/** Ruler tick spacing (cm) for a `lengthCm` edge: a labelled major step and
 *  an unlabelled minor one, coarser as the figure grows so labels never
 *  crowd at the smallest ("100 %") scale. */
export function rulerSteps(lengthCm: number): { major: number; minor: number } {
  if (lengthCm <= 20) return { major: 1, minor: 0.5 };
  if (lengthCm <= 40) return { major: 5, minor: 1 };
  return { major: 10, minor: 5 };
}
