// Peak Analyzer — place a model-fit curve on the plot (audit P2.4 slice 2).
// Pure. The fit runs on the wizard's WORKING trace (analysis rows, range-cut,
// gap-dropped, baseline-subtracted), so a curve drawn on the raw plot must add
// the step-① baseline back — the same correction `plotApexY` applies to the
// peak markers (lib/peakWizardApex.ts).
//
// Rows are mapped 1:1 BY POSITION, never by x value (repeated x — an up/down
// sweep, or an excluded row sharing its x — would make an x lookup
// ambiguous): segment point i is analysis row `segment.kept[i]`, which is full
// row `activeRows[kept[i]]` (lib/rowstate's `activeRowIndices`, the rows
// `analysisData` keeps). The backend returns the fitted points in the order it
// was sent them, dropping only non-finite rows, so curve point j is matched to
// the NEXT segment point with the same x — exact when nothing was dropped
// (the wizard sends only finite pairs), and order-preserving otherwise.
//
// `segmentRows` is that position map on its own, shared by every wizard
// overlay that places segment values on the plot: this model curve, the fitted
// background, and step ①'s baseline preview (usePeakBaseline, and its restore
// in useModelFit) — which, before slice 3, expanded by `kept` directly and so
// drifted one row per excluded row ahead of it.

import { expandToFullRows } from "../../../lib/peakwizard";
import { activeRowIndices, droppedRows } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";

/** Full-row index of each segment point: `kept` indexes the ANALYSIS view
 *  (excluded + filtered-out rows removed), so map it through the rows that
 *  view keeps. */
export function segmentRows(ds: Dataset, kept: readonly number[]): number[] {
  const rows = activeRowIndices(ds.data.time.length, droppedRows(ds));
  return kept.map((k) => rows[k] ?? -1); // -1: no such row (expandToFullRows skips it)
}

/** Segment values (1:1 with `kept`) onto the full rows of `ds`, null elsewhere. */
export function segmentToFullRows(values: readonly (number | null)[], ds: Dataset, kept: readonly number[]): (number | null)[] {
  return expandToFullRows(values, segmentRows(ds, kept), ds.data.time.length);
}

export function curveToRows(
  curveX: readonly (number | null)[],
  values: readonly (number | null)[],
  segX: readonly number[],
  segToRow: readonly number[],
  nRows: number,
  offsets: readonly (number | null)[] | null,
): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(nRows).fill(null);
  let i = 0;
  for (let j = 0; j < curveX.length; j++) {
    const x = curveX[j];
    if (x === null) continue;
    while (i < segX.length && segX[i] !== x) i++;
    if (i >= segX.length) break;
    const v = values[j];
    const row = segToRow[i];
    if (v !== null && v !== undefined && row !== undefined && row >= 0 && row < nRows) {
      const b = offsets?.[i];
      out[row] = v + (typeof b === "number" && Number.isFinite(b) ? b : 0);
    }
    i++;
  }
  return out;
}
