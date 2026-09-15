// The detect/fit input selector for the Peaks workshop, split out of
// usePeaks.ts (2026-09-15, audit P2.1 review round 3) so that hook stays under
// its 500-line module ceiling — same reason and same shape as the sibling
// peakRanges.ts: a pure, self-contained function with its own reasoning to
// carry, which is exactly what the ceiling asks to be extracted first.

import { selectedFitData } from "../../../lib/fitselection";
import { fullPlottedX } from "../../../lib/fitselectionActions";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";

export interface PeakInputs {
  x: number[];
  y: number[];
  /** The same x channel's FULL column, for aligning marker overlays to the
   *  full-length plot x (which keeps excluded/filtered rows as gaps). */
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
): PeakInputs {
  const fullX = fullPlottedX(ds.data, xKey);
  const sel = selectedFitData(ds, xKey, yKeys, seriesOrder);
  if (sel) return { x: sel.x, y: sel.y, fullX, xKeyUsed: xKey };
  const d = analysisData(ds) ?? ds.data;
  return { x: d.time, y: d.values.map((row) => row[0]), fullX, xKeyUsed: null };
}
