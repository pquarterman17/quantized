// When "Copy Figure" also renders the raw-SVG clipboard representation
// (PR #492 review finding 3).
//
// That representation costs a SECOND server render (the text-as-paths SVG)
// on top of the PNG, serialized behind the backend's single render lock, and
// an outlined SVG of a dense figure is large and slow for the paste target to
// parse. So it is rendered only when BOTH hold:
//
// - the browser advertises `image/svg+xml` (`clipboardSvgSupported`) — where
//   it doesn't, the SVG could never be put on the clipboard at all, so the
//   copy costs exactly one PNG render, as it did before #492;
// - the figure's plotted point count is at most `COPY_SVG_MAX_POINTS`.
//
// The count is an estimate read from the request payload (no render needed):
// dataset rows x plotted channels, or the facet payload on the facet branch,
// summed over panels for a figure page. Overlays and error bars are not
// counted; the threshold is a cost guard, not a correctness bound.

import type { FigureSpec } from "./api/figures";
import type { FigurePageSpec } from "./api/figurePage";
import { clipboardSvgSupported } from "./clipboard";

/** Above this many plotted points the raw-SVG render is skipped and the copy
 *  carries PNG + HTML only. */
export const COPY_SVG_MAX_POINTS = 20_000;

export function figurePointCount(spec: FigureSpec): number {
  if (spec.facets?.length) {
    return spec.facets.reduce((n, f) => n + f.series.reduce((m, s) => m + s.y.length, 0), 0);
  }
  const channels = spec.y_keys?.length ?? spec.dataset.labels.length;
  return spec.dataset.time.length * channels;
}

export function pagePointCount(spec: FigurePageSpec): number {
  return spec.panels.reduce((n, p) => n + figurePointCount(p.figure), 0);
}

/** Render the raw-SVG representation for a copy of `points` points? */
export function copySvgWanted(points: number): boolean {
  return clipboardSvgSupported() && points <= COPY_SVG_MAX_POINTS;
}
