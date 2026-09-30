// The Stat Stage's categorical-plot marks (P2.6 box 1), applied to its draws:
// which marks each draw carries (`withMarks`) and which raw points the stage
// has to resolve for them (`needsPoints`). Pure, so the hook stays a hook and
// the rules unit-test standalone.
//
// ONE resolution (`lib/statMarks.resolveStatMarks`) feeds both the canvas (the
// `marks` stamped on every draw here) and the export (`statStageExport` reads
// the same object back off the draw), which is what makes "same options ->
// same figure" structural rather than a promise.

import { resolveStatMarks, type ResolvedStatMarks, type StatMarks } from "../../lib/statMarks";
import type { StatMode } from "../../lib/statstage";
import type { StatDrawData } from "./statRender";
import type { FacetDraw } from "./useStatStageCompute";

/** The marks the stage draws `mode` with. Connect-means needs a picked
 *  "group by" column (the per-channel fallback is no interaction plot). */
export function stageMarks(mode: StatMode, marks: StatMarks | null | undefined, grouped: boolean): ResolvedStatMarks {
  const r = resolveStatMarks(mode, marks);
  return grouped ? r : { ...r, connectMeans: false };
}

/** Whether the stage must resolve raw (row-indexed) points for `mode`: strip
 *  always (its slots ARE its points), box when every point is shown (its
 *  outliers are the box stats' own fliers), violin when any are. */
export function needsPoints(mode: StatMode, r: ResolvedStatMarks): boolean {
  if (mode === "strip") return true;
  if (mode === "box") return r.points === "all";
  return mode === "violin" && r.points !== "none";
}

function stamp(d: StatDrawData, r: ResolvedStatMarks): StatDrawData {
  if (d.mode === "qq" || d.mode === "histogram") return d;
  return { ...d, marks: r };
}

/** Review finding 4: stamps the STRUCTURAL nesting signal (`CategoryAxisMarks
 *  .nestLabel`) onto a draw, the same narrowing `stamp` above uses (qq/
 *  histogram carry no `CategoryAxisMarks` at all, so the union spread would
 *  otherwise not type-check). `useStatStage`/`useStatStageCompute` call this
 *  right after computing a box/violin/strip draw — never inferred from the
 *  draw's own label text (`lib/statMarks.nestedTiers`'s doc). */
export function withNestLabel(d: StatDrawData, nestLabel: string | null): StatDrawData {
  if (d.mode === "qq" || d.mode === "histogram") return d;
  return { ...d, nestLabel };
}

/** A facet panel's marks. Since the JMP_GAP J5 residual closed
 *  (2026-09-29) a panel carries its own ORIGINAL rows (`lib/facet.
 *  facetSliceRowIds`), so it draws what the flat plot draws — raw points,
 *  jitter, summary marker, error bars; a grouped bar panel its cells' points
 *  and summary — and the export posts each panel's rows so it draws the same
 *  (`calc.figure_stat_marks.facet_marks` keeps the old fliers-only rule for
 *  a panel WITHOUT rows, a request from before). Since 2026-09-30 that
 *  includes the connect-means line: each panel joins its own means, and the
 *  faceted export draws it per panel (`show_connect_means`, `connect_breaks`). */
export function facetMarks(r: ResolvedStatMarks): ResolvedStatMarks {
  return r;
}

/** `draw` / `drawFacets` with their marks stamped on. */
export function withMarks(
  draw: StatDrawData | null,
  facets: FacetDraw[] | null,
  r: ResolvedStatMarks,
): { draw: StatDrawData | null; drawFacets: FacetDraw[] | null } {
  return {
    draw: draw && stamp(draw, r),
    drawFacets: facets && facets.map((f) => ({ ...f, draw: stamp(f.draw, facetMarks(r)) })),
  };
}
