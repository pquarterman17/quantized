// The x-range the user has currently SELECTED on the plot, for the context
// menu's "Peak Fitting ▸ Fit this range" (audit P2.4 slice 3). Pure.
//
// The plot has no single "selection" object; three tools leave a visible,
// persistent x-range behind, and this reads them in the order a user is most
// likely to have meant:
//   1. the Gadget's region band (`qfitRoi`, the ≈ tool) — an explicit ROI;
//   2. the Integrate tool's committed region (`integral`, the ∫ chip);
//   3. rows picked with Select Rows (or in the worksheet) — their x extent on
//      the plotted X column.
// Each counts only while it belongs to what is plotted NOW: the band and the
// ∫ region are stamped with the dataset + X column they were drawn on
// (`RegionContext`, written by the store's setters) and ignored when either
// differs — or when there is no stamp at all; the row selection carries its
// dataset id and is read through the CURRENT X column. The Background Region
// tool is NOT a source: it hands its pick straight to the Baseline workshop
// and leaves nothing drawn, so "this range" would be a range the user cannot
// see. A degenerate range (lo === hi, or no finite x) is no range.

/** Which dataset and X column (`xKey`, null = the time column) a region was
 *  drawn against. */
export interface RegionContext {
  datasetId: string | null;
  xKey: number | null;
}

/** Committed integral region from the ∫ tool (area under the curve). The
 *  store stamps `context` when it is set. */
export interface IntegralResult {
  xlo: number;
  xhi: number;
  area: number;
  context?: RegionContext;
}

export interface PlotRangeInputs {
  qfitRoi: readonly [number, number] | null;
  qfitRoiFor: RegionContext | null;
  integral: IntegralResult | null;
  /** The row selection, live only when it belongs to `activeId`. */
  selection: { datasetId: string; rows: readonly number[] } | null;
  activeId: string | null;
  xKey: number | null;
  /** The active dataset's plotted X, full rows — a getter, only called when
   *  the row selection is what decides (it is a whole-column copy). */
  plottedX: () => readonly (number | null)[] | null;
}

export interface PlotRange {
  lo: number;
  hi: number;
  /** Which selection it came from, for the menu's tooltip. */
  source: "gadget region" | "integration region" | "selected rows";
}

export const NO_RANGE_REASON =
  "select an x-range first — drag with the Gadget (≈), Integrate (∫) or Select Rows tool";

function ordered(a: number, b: number, source: PlotRange["source"]): PlotRange | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return { lo: Math.min(a, b), hi: Math.max(a, b), source };
}

const current = (c: RegionContext | null | undefined, s: PlotRangeInputs): boolean =>
  !!c && c.datasetId !== null && c.datasetId === s.activeId && c.xKey === s.xKey;

export function plotRangeSelection(s: PlotRangeInputs): PlotRange | null {
  if (s.qfitRoi && current(s.qfitRoiFor, s)) {
    const r = ordered(s.qfitRoi[0], s.qfitRoi[1], "gadget region");
    if (r) return r;
  }
  if (s.integral && current(s.integral.context, s)) {
    const r = ordered(s.integral.xlo, s.integral.xhi, "integration region");
    if (r) return r;
  }
  if (s.selection && s.selection.datasetId === s.activeId) {
    const plottedX = s.plottedX();
    if (!plottedX) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of s.selection.rows) {
      const x = plottedX[row];
      if (typeof x === "number" && Number.isFinite(x)) {
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    return ordered(lo, hi, "selected rows");
  }
  return null;
}
