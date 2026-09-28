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

/** Facet panels carry no raw points (JMP_GAP J5 residual), so a panel shows
 *  what it CAN: a box its fliers (for "all" or "outliers"), a violin none.
 *  The export applies the same rule (`calc.figure_facets._facet_marks`). No
 *  connect-means line in a panel either: the faceted export draws none. A
 *  bar panel draws no summary marker (P2.6 box 1: its cells carry no raw
 *  values, and the faceted bar export takes no marks). */
export function facetMarks(r: ResolvedStatMarks, mode: StatMode): ResolvedStatMarks {
  const points = mode === "box" && r.points !== "none" ? "outliers" : "none";
  return { ...r, points, connectMeans: false, ...(mode === "bar" ? { summary: "none" as const } : {}) };
}

/** `draw` / `drawFacets` with their marks stamped on. */
export function withMarks(
  draw: StatDrawData | null,
  facets: FacetDraw[] | null,
  r: ResolvedStatMarks,
): { draw: StatDrawData | null; drawFacets: FacetDraw[] | null } {
  return {
    draw: draw && stamp(draw, r),
    drawFacets: facets && facets.map((f) => ({ ...f, draw: stamp(f.draw, facetMarks(r, f.draw.mode)) })),
  };
}
