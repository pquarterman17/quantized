// Shared plotted-channel -> fit-input bridge. Curve fitting must consume the
// same primary X/Y pair the Stage shows, after row exclusions and filters.
// Also the provenance bridge (audit P1 #3): `fitSpecFrom` records the fit's
// recipe and `fitDataForSpec` reproduces it on recompute.
//
// SCOPE (narrowed 2026-10-11): this file owns subset selection and saved-fit
// replay. The eager quick-fit encoder lives in tiny `fitStepParams.ts`, while
// recomputation loads this module only after the user starts recalculation.
// The plotted-channel column helpers (`fullPlottedX`/`plottedYKey`) and the
// fit-recipe builder (`fitSpecFrom` + its `finiteRange`/`activeCorrectionNames`
// helpers) now live in `lib/fitselectionActions.ts`, reached only from the
// interactive fit workshops (curve fit, baseline, peaks, peak wizard, mag
// tools) — all already lazy `workshops/` panels. See that file's own header
// for the verified-no-eager-consumer rationale.

import { dropGapRows } from "./api/finitePairs";
import { dyForFit } from "./fitweights";
import { effectiveChannels } from "./plotdata";
import { analysisData, analysisView } from "./rowstate";
import type { AnalysisSelectionItem } from "./analysisSelection";
import type { Dataset, FitSpec } from "./types";
export { fitStepParams } from "./fitStepParams";

export interface FitSelection {
  x: number[];
  y: number[];
  yKey: number;
  /** Positions in analysisData(dataset) retained by an explicit row/range
   * selection. Absent for the historical full-analysis-view path. */
  analysisRows?: number[];
  /** Original worksheet row ids corresponding to x/y. */
  sourceRows?: number[];
  /** Raw worksheet length that gives positional sourceRows their meaning. */
  sourceRowCount?: number;
  /** 1-sigma errors for the recorded weighting (recompute path only); null/
   *  absent = unweighted. Only `fitDataForSpec` populates it — the interactive
   *  hook resolves weighting from the live UI state instead. */
  dy?: number[] | null;
}

export function selectedFitData(
  dataset: Dataset | null | undefined,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
  subset?: Pick<AnalysisSelectionItem, "rowIds" | "range">,
): FitSelection | null {
  const view = analysisView(dataset);
  const data = view.data;
  if (!dataset || !data) return null;
  const channels = effectiveChannels(
    data,
    yKeys,
    xKey,
    dataset.channelRoles,
    seriesOrder,
  );
  const yKey = channels[0];
  if (yKey === undefined) return null;
  const allX = xKey == null ? data.time : data.values.map((row) => row[xKey]);
  const allY = data.values.map((row) => row[yKey]);
  if (!subset || (subset.rowIds === null && subset.range === null)) return { x: allX, y: allY, yKey };
  const sourceRows = view.rowIds ?? data.time.map((_value, index) => index);
  const selectedRows = subset.rowIds === null ? null : new Set(subset.rowIds);
  const analysisRows: number[] = [];
  for (let index = 0; index < sourceRows.length; index++) {
    if (selectedRows && !selectedRows.has(sourceRows[index])) continue;
    const x = allX[index];
    if (subset.range && (!Number.isFinite(x) || x < subset.range.lo || x > subset.range.hi)) continue;
    analysisRows.push(index);
  }
  return {
    x: analysisRows.map((index) => allX[index]),
    y: analysisRows.map((index) => allY[index]),
    yKey,
    analysisRows,
    sourceRows: analysisRows.map((index) => sourceRows[index]),
    sourceRowCount: dataset.data.time.length,
  };
}

// ── Pipeline fit-step params bridge (#6) ───────────────────────────────────
/** Fit inputs for a SAVED spec on recompute: reproduce the spec's recorded
 *  channels (provenance) over the current analysis rows (#50/#53). Legacy specs
 *  without channels — or a stored channel that no longer exists after a column
 *  change — fall back to the live plotted selection. */
export function fitDataForSpec(
  dataset: Dataset | null | undefined,
  spec: FitSpec,
  liveXKey: number | null,
  liveYKeys: number[] | null,
  liveSeriesOrder: number[] | null,
): FitSelection | null {
  if (spec.xKey === undefined && spec.yKey === undefined) {
    return selectedFitData(dataset, liveXKey, liveYKeys, liveSeriesOrder);
  }
  const data = analysisData(dataset);
  if (!dataset || !data) return null;
  const width = data.labels.length;
  const yKey = spec.yKey ?? 0;
  if (yKey < 0 || yKey >= width) {
    return selectedFitData(dataset, liveXKey, liveYKeys, liveSeriesOrder);
  }
  const xKey = spec.xKey ?? null;
  const selected = selectedFitData(dataset, xKey, [yKey], null, {
    rowIds: spec.rowIds ?? null,
    range: spec.range ? { lo: spec.range[0], hi: spec.range[1], source: "manual" } : null,
  });
  if (!selected) return null;
  // Explicit row subsets use worksheet positions. A structural row edit
  // invalidates those positions, so refuse replay instead of silently fitting
  // different observations. The finite-point check also catches range or gap
  // changes that leave the raw row count unchanged.
  if (spec.rowIds !== undefined) {
    if (spec.sourceRowCount === undefined || spec.sourceRowCount !== dataset.data.time.length) return null;
    if (spec.nPoints !== undefined && dropGapRows(selected.x, selected.y).x.length !== spec.nPoints) return null;
  }
  if (!spec.weight) return selected;
  // Reproduce the recorded weighting over the same analysis rows (Sol audit);
  // a missing/invalid error column refits unweighted (dyForFit returns null).
  // σ is checked only over the rows the fit keeps, as in useCurveFit.
  const keep = dropGapRows(selected.x, selected.y).keep.map((index) => selected.analysisRows?.[index] ?? index);
  const resolved = dyForFit(dataset, yKey, spec.weight, keep).dy;
  return {
    ...selected,
    dy: resolved && selected.analysisRows ? selected.analysisRows.map((index) => resolved[index]) : resolved,
  };
}
