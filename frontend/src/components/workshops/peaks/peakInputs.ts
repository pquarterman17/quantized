// The detect/fit input selector for the Peaks workshop, split out of
// usePeaks.ts (2026-09-15, audit P2.1 review round 3) so that hook stays under
// its 500-line module ceiling — same reason and same shape as the sibling
// peakRanges.ts: a pure, self-contained function with its own reasoning to
// carry, which is exactly what the ceiling asks to be extracted first.

import { selectedFitData } from "../../../lib/fitselection";
import { dropGapRows } from "../../../lib/api/finitePairs";
import { fullPlottedX } from "../../../lib/fitselectionActions";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { PeakTable } from "../../../lib/peakTable";

export interface PeakInputs {
  x: number[];
  y: number[];
  /** The PLOTTED x channel's full column (`fullPlottedX(ds.data, xKey)` —
   *  keyed by the requested `xKey`, NOT by `xKeyUsed` below), for aligning
   *  marker overlays to the full-length plot x (which keeps excluded/
   *  filtered rows as gaps). These two differ in exactly the fallback branch
   *  `xKeyUsed` documents: when `selectedFitData` returns null and `x`/`y`
   *  fall back to the time axis, `fullX` is still `xKey`'s column (or `time`
   *  only if `xKey` itself was null/out of range) — it does not also fall
   *  back. The overlay follows the plot, not the fit's axis. */
  fullX: number[];
  /** The x channel `x` was actually taken from — `null` means the time axis.
   *  NOT necessarily the `xKey` that was asked for: `selectedFitData` returns
   *  null when no y channel is effective (lib/fitselection), and the fallback
   *  below then fits on `time`. Review round 3 NIT 2: provenance
   *  (`store/peakTables.publishFitResult` → `xChannelIdentity`) must be
   *  stamped from THIS, or a fit that ran on the time axis gets recorded under
   *  the label and unit of the plotted column — the exact misattribution the
   *  provenance field exists to prevent. */
  xKeyUsed: number | null;
  /** The value channel the fit actually consumed. Null only when the dataset
   * has no value column; persisted into the result's exact plot binding. */
  yKeyUsed: number | null;
  gapCount: number;
  sourceCount: number;
  /** Exact original rows after row/range selection and finite-pair pruning.
   * Absent means the ordinary full analysis view. */
  sourceRows?: number[];
}

/** The (x, y) the peak tools DETECT/FIT on — the PLOTTED X + primary Y over the
 *  analysis view (audit P1 #1), so peaks track what the user sees and excluded/
 *  filtered rows (#50/#53) don't produce or bias peaks. Falls back to the first
 *  channel when nothing is plotted. */
export function peakInputs(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
  selection?: Pick<AnalysisSelectionItem, "rowIds" | "range">,
): PeakInputs {
  const fullX = fullPlottedX(ds.data, xKey);
  const sel = selectedFitData(ds, xKey, yKeys, seriesOrder, selection);
  if (sel) {
    const pairs = dropGapRows(sel.x, sel.y);
    return {
      x: pairs.x,
      y: pairs.y,
      fullX,
      xKeyUsed: xKey,
      yKeyUsed: sel.yKey,
      gapCount: pairs.n - pairs.keep.length,
      sourceCount: pairs.n,
      ...(sel.sourceRows ? { sourceRows: pairs.keep.map((index) => sel.sourceRows![index]) } : {}),
    };
  }
  const d = analysisData(ds) ?? ds.data;
  const pairs = dropGapRows(d.time, d.values.map((row) => row[0]));
  return {
    x: pairs.x,
    y: pairs.y,
    fullX,
    xKeyUsed: null,
    yKeyUsed: d.values[0]?.length ? 0 : null,
    gapCount: pairs.n - pairs.keep.length,
    sourceCount: pairs.n,
  };
}

/** A saved peak table may be shown only beside the exact input contract it
 * was fit from. Legacy/full-view tables intentionally carry no rowIds. */
export function peakTableMatchesInputs(
  table: PeakTable,
  inputs: PeakInputs,
  selection?: Pick<AnalysisSelectionItem, "rowIds" | "range">,
): boolean {
  const explicit = !!selection && (selection.rowIds !== null || selection.range !== null);
  const saved = table.provenance.rowIds;
  if (!explicit) return saved === undefined;
  if (!saved || !inputs.sourceRows || saved.length !== inputs.sourceRows.length) return false;
  return saved.every((row, index) => row === inputs.sourceRows![index]);
}
