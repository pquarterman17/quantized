// The detect/fit input selector for the Peaks workshop, split out of
// usePeaks.ts (2026-09-15, audit P2.1 review round 3) so that hook stays under
// its 500-line module ceiling — same reason and same shape as the sibling
// peakRanges.ts: a pure, self-contained function with its own reasoning to
// carry, which is exactly what the ceiling asks to be extracted first.

import { resolveFitInputs } from "../../../lib/fitselection";
import { dropGapRows } from "../../../lib/api/finitePairs";
import { fullPlottedX } from "../../../lib/fitselectionActions";
import { curveX } from "../../../lib/perSeriesX";
import { activeRowIndices, analysisData, droppedRows } from "../../../lib/rowstate";
import type { Dataset, OverlayBinding } from "../../../lib/types";
import type { AnalysisSelectionItem } from "../../../lib/analysisSelection";
import type { PeakTable } from "../../../lib/peakTable";

export interface PeakInputs {
  x: number[];
  y: number[];
  /** The full column of the X the fitted Y is plotted against --
   *  `fullPlottedX(ds.data, xKeyUsed)`, i.e. the Y's OWN X (`ownXKey`, so R2 in
   *  T1,R1,T2,R2 reads T2), for aligning marker overlays to the full-length
   *  plot x (which keeps excluded/filtered rows as gaps). In the fallback
   *  branch (the resolver found no plotted Y) it is the fallback channel's own
   *  X (time on a one-X sheet) -- always the column `xKeyUsed` names. */
  fullX: number[];
  /** The x channel `x` was actually taken from — `null` means the time axis.
   *  NOT necessarily the `xKey` that was asked for: `selectedFitData` returns
   *  null when no y channel is effective (lib/fitselection), and the fallback
   *  below then fits on its channel's own X (`time` on a one-X sheet). Review round 3 NIT 2: provenance
   *  (`store/peakTables.publishFitResult` → `xChannelIdentity`) must be
   *  stamped from THIS, or a fit that ran on the time axis gets recorded under
   *  the label and unit of the plotted column — the exact misattribution the
   *  provenance field exists to prevent. */
  xKeyUsed: number | null;
  /** The value channel the fit actually consumed (in the fallback branch, the
   * first value-role channel -- never an X/error/label column). Null when the
   * dataset has no value column (then x/y are empty). This is the PROVENANCE
   * persisted into the result's exact plot binding, so it names the channel
   * really fitted, fallback or not. */
  yKeyUsed: number | null;
  /** True when `selectedFitData` returned null and x/y came from the first
   * value channel against its own X (time on a one-X sheet). The provenance
   * still names that channel, but no Y is plotted, so the MARKERS belong to no
   * curve (`peakBinding` -> -1). */
  fallback?: boolean;
  gapCount: number;
  sourceCount: number;
  /** Set when the shared resolver REFUSED the rows (a lazy preview, an empty
   *  row selection, no rows left, a deleted column): x/y are empty and this is
   *  the resolver's reason. Never set for "no channel is plotted", which takes
   *  the fallback below. */
  refusal?: string;
  /** Exact original rows after row/range selection and finite-pair pruning.
   * Absent means the ordinary full analysis view. */
  sourceRows?: number[];
  /** The dataset row of every (x, y) pair, ascending: with `xKeyUsed` and
   * `yKeyUsed`, what a fit sends instead of x/y when the server holds the
   * dataset (lib/fitSource, P4 phase 3). Lazy: only "Fit each" needs it. */
  rows?: () => number[];
}

/** `keep` (pair -> analysis position) mapped to dataset rows through the
 *  given analysis rows, else through the analysis view's rows. */
const rowsOf = (ds: Dataset, keep: readonly number[], base?: readonly number[]) => (): number[] => {
  const rows = base ?? activeRowIndices(ds.data.time.length, droppedRows(ds));
  return keep.map((i) => rows[i]!);
};

/** The (x, y) the peak tools DETECT/FIT on — the PLOTTED X + primary Y over the
 *  analysis view (audit P1 #1), so peaks track what the user sees and excluded/
 *  filtered rows (#50/#53) don't produce or bias peaks. Falls back to the first
 *  VALUE channel (against its own X) when nothing is plotted. */
export function peakInputs(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
  selection?: Pick<AnalysisSelectionItem, "rowIds" | "range">,
): PeakInputs {
  const resolved = resolveFitInputs(ds, xKey, yKeys, seriesOrder, selection);
  const sel = resolved.ok ? resolved.fit : null;
  // Fail closed: a refusal other than "no channel to plot" (or an X column as
  // Y, which has always taken the fallback) must NOT fall back to fitting some
  // other rows -- an explicit empty row selection would otherwise analyse the
  // whole sheet.
  if (!resolved.ok && resolved.code !== "no-response" && resolved.code !== "y-is-x") {
    return {
      x: [], y: [], fullX: fullPlottedX(ds.data, null), xKeyUsed: null, yKeyUsed: null, gapCount: 0, sourceCount: 0,
      refusal: resolved.reason,
    };
  }
  // `sel.x` is the Y's OWN X (R2 -> T2); the marker overlay and the recorded
  // provenance must follow it, not the plot's shared X.
  const fullX = fullPlottedX(ds.data, sel ? sel.xKey : null);
  if (sel) {
    const pairs = dropGapRows(sel.x, sel.y);
    return {
      x: pairs.x,
      y: pairs.y,
      fullX,
      xKeyUsed: sel.xKey,
      yKeyUsed: sel.yKey,
      gapCount: pairs.n - pairs.keep.length,
      sourceCount: pairs.n,
      ...(sel.sourceRows ? { sourceRows: pairs.keep.map((index) => sel.sourceRows![index]) } : {}),
      rows: rowsOf(ds, pairs.keep, sel.sourceRows),
    };
  }
  // Fallback: the first VALUE channel (a curve by its column ROLE -- curveX's
  // rule: not an X-designated / error / label column -- with no channel role)
  // against its own X, read from the column list, not from a row (every row
  // may be filtered out). None -> no Y is recorded. Deliberately NOT relative
  // to the plot's X: a one-column sheet plotted against that column still
  // finds its peaks against time, as it always has (usePeaks.test "stamps the
  // x axis the fit RAN on"), and records exactly that.
  const own = curveX(ds, null);
  const ch = own.findIndex((x, c) => x !== undefined && !ds.channelRoles?.[c]);
  if (ch < 0) {
    return { x: [], y: [], fullX, xKeyUsed: null, yKeyUsed: null, fallback: true, gapCount: 0, sourceCount: 0 };
  }
  const xUsed = own[ch] ?? null; // its own X (nearest preceding X column), else time
  const d = analysisData(ds) ?? ds.data;
  const pairs = dropGapRows(xUsed === null ? d.time : d.values.map((row) => row[xUsed]), d.values.map((row) => row[ch]));
  return {
    x: pairs.x,
    y: pairs.y,
    fullX: xUsed === null ? fullX : fullPlottedX(ds.data, xUsed),
    xKeyUsed: xUsed,
    yKeyUsed: ch,
    fallback: true,
    gapCount: pairs.n - pairs.keep.length,
    sourceCount: pairs.n,
    rows: rowsOf(ds, pairs.keep),
  };
}

/** The curve a peak overlay drawn from these inputs belongs to: the Y and X
 *  the peaks were actually found/fitted on (lib/overlayPlacement.ts). `xKeyUsed`
 *  is the X the markers are positioned on (`fullX`); no value channel = no
 *  curve (-1). The fallback branch fits the first value channel (kept as
 *  `yKeyUsed` provenance) yet shows no Y, so its markers bind to no curve as well. */
export function peakBinding(i: Pick<PeakInputs, "xKeyUsed" | "yKeyUsed" | "fallback">): OverlayBinding {
  return { yKey: i.fallback ? -1 : (i.yKeyUsed ?? -1), xKey: i.xKeyUsed };
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
