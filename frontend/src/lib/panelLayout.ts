// Pure layout math for Origin-style shared-axis "wall" stacking in the
// spatial multi-panel grid (item B, decode-plan #36 residual — PNR.opj
// Book14 Graph11, an 8-panel spin-asymmetry figure): panels vertically
// adjacent in the same grid COLUMN that share an x-range sit FLUSH (no
// vertical gap between them — the shared edge reads as one "wall"), every
// panel stays fully boxed (`showAxisBox`, already on by default), and only
// the bottom-most panel of such a run shows x tick values + the x axis
// title. Side-by-side COLUMNS are never fused (they may plot unrelated
// quantities even when their x-ranges coincidentally match — the rule is
// scoped to vertical adjacency only, matching how Origin itself only shares
// an axis down a column).
//
// Kept out of `useMultiPanelStage.ts` so the column/flush/suppression math
// is independently unit-testable (no store, no uPlot, no DOM) and that hook
// doesn't re-bloat past its own convention ceiling every time a multi-panel
// feature lands.
//
// CSS Grid's `gap` shorthand is ONE uniform value for every row boundary, so
// it cannot express "flush here, normal gap there" — the render layer
// switches the spatial grid from CSS Grid auto-sizing to explicit pixel
// rects. Trusted decoded frames use `spatialPixelRects` so unequal sizes,
// source gaps, and spanning panels survive; ordinal/untrusted layouts use
// `rowBoundaryGaps`/`columnWidths`/`rowHeights`/`cumulativeOffsets`.

import type { SpatialPanel } from "./multipanel";

/** Default tolerance for "the same x axis", as a fraction of the larger
 *  span — generous enough for float rounding in decoded page-unit/axis-
 *  range values, tight enough not to fuse two genuinely different ranges
 *  that happen to sit close together. */
export const SHARED_X_TOL_FRACTION = 1e-3;

/** Two ranges within a relative tolerance (scaled off the larger span) —
 *  Origin's own shared-axis stacks decode identical x_from/x_to per layer,
 *  but this allows a little slop rather than requiring bit-exact equality. */
function rangesMatch(a: readonly [number, number], b: readonly [number, number], tolFraction: number): boolean {
  const span = Math.max(Math.abs(a[1] - a[0]), Math.abs(b[1] - b[0]), 1e-12);
  const tol = tolFraction * span;
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
}

/** The subset of a `SpatialPanel` this module's geometry needs — kept
 *  narrow (`Pick`) so tests can build plain fixtures without the rest of the
 *  panel's plot-selection fields. */
export type PanelPos = Pick<SpatialPanel, "row" | "col" | "xLim">;

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Scale trusted normalized frame rectangles into the current stage. Returns
 *  null as an all-or-nothing fail-closed signal if any panel lacks a valid
 *  rectangle, keeping ordinal/non-Origin layouts on the equal-grid path. */
export function spatialPixelRects(
  panels: readonly Pick<SpatialPanel, "frameRect">[],
  totalWidth: number,
  totalHeight: number,
): PixelRect[] | null {
  if (panels.length === 0 || panels.some((panel) => {
    const rect = panel.frameRect;
    return !rect || ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
      || rect.left < 0 || rect.top < 0 || rect.width <= 0 || rect.height <= 0
      || rect.left + rect.width > 1 + 1e-6 || rect.top + rect.height > 1 + 1e-6;
  })) return null;
  return panels.map(({ frameRect: rect }) => ({
    left: Math.round(rect!.left * totalWidth),
    top: Math.round(rect!.top * totalHeight),
    width: Math.max(1, Math.round(rect!.width * totalWidth)),
    height: Math.max(1, Math.round(rect!.height * totalHeight)),
  }));
}

/** True when `panel` shares its x-range (within tolerance) with whatever
 *  panel sits directly below it in the SAME grid column — false when
 *  nothing is there, or the ranges disagree. This one predicate drives both
 *  `rowBoundaryGaps` (should this row boundary be flush?) and
 *  `suppressedXIndices` (should THIS panel hide its x axis?), so the two
 *  can never disagree with each other. */
export function sharesXWithPanelBelow(
  panel: PanelPos,
  panels: readonly PanelPos[],
  tolFraction = SHARED_X_TOL_FRACTION,
): boolean {
  const below = panels.find((q) => q.row === panel.row + 1 && q.col === panel.col);
  return !!below && rangesMatch(panel.xLim, below.xLim, tolFraction);
}

/** Per-row-boundary vertical gap in px (length `rows - 1`, index i = the
 *  boundary between row i and row i+1): 0 when EVERY column present in BOTH
 *  rows shares its x-axis across that boundary (a flush "wall" seam), the
 *  normal `gap` px otherwise. A column missing a panel in either row simply
 *  doesn't constrain that boundary; a boundary with no column pairs at all
 *  defaults to the normal gap (nothing to share, so nothing to fuse).
 *  Conservative by design: any single disagreeing column keeps the WHOLE
 *  boundary at the normal gap, so a mixed grid never fuses rows that aren't
 *  uniformly shared across every column. */
export function rowBoundaryGaps(
  panels: readonly PanelPos[],
  rows: number,
  gap = 8,
  tolFraction = SHARED_X_TOL_FRACTION,
): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    const pairs = panels.filter(
      (p) => p.row === r && panels.some((q) => q.row === r + 1 && q.col === p.col),
    );
    const flush = pairs.length > 0 && pairs.every((p) => sharesXWithPanelBelow(p, panels, tolFraction));
    out.push(flush ? 0 : gap);
  }
  return out;
}

/** Array-indices (into the SAME `panels` array passed in) whose x tick
 *  values + axis title should be suppressed: every panel with a flush-shared
 *  neighbor directly below it. Mirrors Origin's own idiom — the shared x
 *  axis is drawn once, at the bottom of the run, while every panel above it
 *  keeps its own full box ("wall"). A panel with no shared neighbor below
 *  (an ordinary standalone/side-by-side panel) is never suppressed. */
export function suppressedXIndices(
  panels: readonly PanelPos[],
  tolFraction = SHARED_X_TOL_FRACTION,
): Set<number> {
  const out = new Set<number>();
  panels.forEach((p, i) => {
    if (sharesXWithPanelBelow(p, panels, tolFraction)) out.add(i);
  });
  return out;
}

/** Column pixel widths for `cols` EQUAL-width columns filling `totalWidth`
 *  px, with the uniform `gap` px between adjacent columns (item B only
 *  varies ROW gaps — side-by-side columns keep the plain, uniform spacing
 *  `multipanel.cellSize` already used). Never below 1px. */
export function columnWidths(cols: number, totalWidth: number, gap = 8): number[] {
  if (cols <= 0) return [];
  const w = Math.max(1, Math.floor((totalWidth - (cols - 1) * gap) / cols));
  return new Array(cols).fill(w);
}

/** Row pixel heights for `rows` EQUAL-height rows filling `totalHeight` px,
 *  given a PER-BOUNDARY gap array (`rowBoundaryGaps`) instead of one uniform
 *  gap — item B's generalization of the old uniform-gap row math: a flush
 *  boundary consumes 0 px instead of `gap`, so those two rows still render
 *  the SAME height as every other row, just closer together. `rowGaps` must
 *  have length `rows - 1` (as `rowBoundaryGaps` returns); a shorter/absent
 *  entry is treated as 0. Never below 1px. */
export function rowHeights(rows: number, totalHeight: number, rowGaps: readonly number[]): number[] {
  if (rows <= 0) return [];
  const usedGap = rowGaps.slice(0, rows - 1).reduce((a, b) => a + b, 0);
  const h = Math.max(1, Math.floor((totalHeight - usedGap) / rows));
  return new Array(rows).fill(h);
}

/** Cumulative pixel offset BEFORE each entry of `sizes` — entry i is the sum
 *  of every earlier size plus every earlier gap. `gaps` is either one
 *  uniform number (columns: item B doesn't vary these) or a per-boundary
 *  array of length `sizes.length - 1` (rows: `rowBoundaryGaps`'s output).
 *  This is the one shared placement primitive both the initial spatial
 *  layout and every ResizeObserver tick use — pulled out once instead of
 *  reimplementing the running-sum inline. */
export function cumulativeOffsets(sizes: readonly number[], gaps: readonly number[] | number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < sizes.length; i++) {
    out.push(acc);
    const g = typeof gaps === "number" ? gaps : (gaps[i] ?? 0);
    acc += sizes[i] + g;
  }
  return out;
}
