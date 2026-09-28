// Which error bar a categorical stat figure shows, said on the figure (P2.6
// box 1): "Error bars: SD" / "SE of the mean" / "95% CI of the mean"
// (`lib/statMarks.errorBarNote`, one text). The stage shows it as a footnote
// under the plot and the export carries the SAME string as its `error_note`
// footnote line, so a figure never leaves with whiskers nobody can read.
//
// The note appears exactly when at least one error bar is DRAWN, by the same
// predicates the painters use (`statDrawMarks.summaryErrorBounds` for the box
// family's mean marker, `barErrorHalf` for bars) — no note for bars that are
// all below n = 2, for a median / no summary marker, or for "none". There is
// no separate toggle: the note's opt-out is the error bars' own "none".
// Violin draws no error bar (yet), so it never carries one.

import { errorBarNote } from "../../lib/statMarks";
import { barErrorHalf, drawMarks, summaryErrorBounds } from "./statDrawMarks";
import type { StatDrawData } from "./statRender";
import type { FacetDraw } from "./useStatStageCompute";

/** Whether `d` paints at least one error bar. */
export function drawsErrorBars(d: StatDrawData | null): boolean {
  if (!d) return false;
  if (d.mode === "box" || d.mode === "strip") {
    const m = drawMarks(d);
    return d.boxes.some((b) => summaryErrorBounds(b, m) !== null);
  }
  if (d.mode !== "bar") return false;
  const m = drawMarks(d);
  return d.data.groups.some((g) => {
    // Stacked: one whisker per category, on the top segment (statRenderBar).
    const whiskered = d.stacked ? g.series.slice(-1) : g.series;
    return whiskered.some((s) => (d.stacked || Number.isFinite(s.mean)) && Number.isFinite(barErrorHalf(d, s, m)));
  });
}

/** The figure's error-bar footnote — flat draw, or a facet grid (whose
 *  panels share one error-bar kind) — or null when no bar is drawn. */
export function figureErrorNote(draw: StatDrawData | null, facets: readonly FacetDraw[] | null): string | null {
  const shown = facets ? facets.map((f) => f.draw).find(drawsErrorBars) : drawsErrorBars(draw) ? draw : null;
  if (!shown || shown.mode === "qq" || shown.mode === "histogram") return null;
  return errorBarNote(drawMarks(shown).errorBars);
}
