// Baseline workshop: which plotted channels an estimate reads (split out of
// useBaseline.ts). A secondary-X Y is estimated against its OWN X; a batch
// target matches the active binding's channels BY LABEL.

import { analysisSeries, resolveAnalysisInputs, ROW_POLICY } from "../../../lib/analysisInputs";
import { plottedYKey } from "../../../lib/fitselectionActions";
import { magXAxis } from "../../../lib/magDataKind";
import { ownXKey } from "../../../lib/perSeriesX";
import { tokenOf } from "../../../lib/previewKey";
import type { Dataset } from "../../../lib/types";

export interface BaselineBinding {
  datasetId: string;
  xKey: number | null;
  yKey: number;
  xLabel: string;
  yLabel: string;
}

export interface BaselineInput {
  binding: BaselineBinding;
  x: number[];
  y: number[];
}

const NO_Y = "the plotted X/Y selection has no usable primary Y channel";

/** Which channels an estimate reads (column choice only, no rows): the primary
 *  plotted Y against its OWN X (a secondary-X Y, R2 in T1,R1,T2,R2). Safe on a
 *  lazy preview, so the panel can show it before the full rows have loaded. */
export function baselineBinding(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): BaselineBinding | null {
  const yKey = plottedYKey(ds, xKey, yKeys, seriesOrder);
  if (yKey == null) return null;
  const ownX = ownXKey(ds, xKey, yKey);
  return {
    datasetId: ds.id,
    xKey: ownX,
    yKey,
    xLabel: ownX == null ? magXAxis(ds.data, null).label || "Time" : (ds.data.labels[ownX] ?? `Channel ${ownX + 1}`),
    yLabel: ds.data.labels[yKey] ?? `Channel ${yKey + 1}`,
  };
}

/** The rows an estimate runs on, through the shared resolver
 *  (lib/analysisInputs): EVERY worksheet row of those channels (an estimate
 *  has never dropped excluded or filtered-out rows, so the policy is
 *  `fullWorksheet`). A string is the refusal (no Y, lazy preview, missing
 *  column, no rows) to show the user. */
export function baselineInput(
  ds: Dataset,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): BaselineInput | string {
  const binding = baselineBinding(ds, xKey, yKeys, seriesOrder);
  if (!binding) return NO_Y;
  const inputs = resolveAnalysisInputs({
    datasets: [ds], activeId: ds.id, xKey: binding.xKey, yKeys: [binding.yKey], policy: ROW_POLICY.fullWorksheet,
  });
  if (!inputs.ok) return inputs.reason;
  const { x, y } = analysisSeries(inputs);
  return { binding, x, y };
}

/** Batch target: the SAME channels (by column label) as the active binding; the
 *  plot's index-based selection means something else in another column layout. */
export function batchInput(ds: Dataset, ref: BaselineBinding | null): BaselineInput | string {
  if (!ref) return "select a plotted Y channel first";
  const yKey = ds.data.labels.indexOf(ref.yLabel);
  const xKey = ref.xKey == null ? null : ds.data.labels.indexOf(ref.xLabel);
  if (yKey < 0 || xKey === -1) return `${ds.name}: no "${yKey < 0 ? ref.yLabel : ref.xLabel}" column`;
  const input = baselineInput(ds, xKey, [yKey], null);
  return typeof input === "string" ? `${ds.name}: ${input}` : input;
}

// Estimate on a still-loading book: compute() resolves it first, which swaps
// the store's Dataset object. The loaded object keeps the pending one's input
// token, so that swap (caused by the estimate itself) neither makes the
// estimate stale nor resets the anchors; any later edit still does.
const loadedFrom = new WeakMap<Dataset, number>();
/** Books being loaded by an Estimate: dataset id -> the pending input token. */
export const loadingBooks = new Map<string, number>();
export function inputToken(ds: Dataset): number {
  const inherited = loadingBooks.get(ds.id);
  if (inherited !== undefined && !ds.pending && !loadedFrom.has(ds)) {
    loadedFrom.set(ds, inherited); // the first loaded object after the swap
    loadingBooks.delete(ds.id);
  }
  return loadedFrom.get(ds) ?? tokenOf(ds);
}
