// Batch Figure Builder: each dataset's SAVED fit rides onto its figure
// (gap audit 5, lane C), as Origin's batch plotting keeps each graph's fit
// curve. The curve is regenerated from the dataset's own FitSpec (model +
// parameters, lib/savedFitCurve -- the evaluation Open plot uses) on the X and
// Y it was fitted on, and stored in the figure document's overlays
// (lib/figureOverlays.ts), row-checked against the data it was evaluated on.
//
// Fail closed, per dataset (the figure is still built, without the fit):
//   * no saved fit, no parameters, or a legacy fit that never recorded its X/Y;
//   * a fit marked stale (its source changed since it ran, `staleFits`);
//   * data still loading (a lazy book's preview rows are not the fitted rows);
//   * the recipe's figure is on another X, or does not plot the fitted Y, or
//     the fitted Y is no longer a curve on that X (lib/fitDrawBinding);
//   * the model evaluation fails.
// Placement on the rendered figure stays lib/overlayPlacement's (I1). The
// evaluations run a few at a time (review #13), not one request per dataset
// in sequence.

import { captureFit, type FigureOverlays } from "../lib/figureOverlays";
import { fitDrawBinding } from "../lib/fitDrawBinding";
import { evaluateSavedFit } from "../lib/savedFitCurve";
import type { Dataset, OverlayBinding } from "../lib/types";
import type { BatchFigureRow } from "./batchFigureBuild";

/** Model evaluations in flight at once. */
const CONCURRENCY = 6;

/** The saved-fit overlays for the included rows, keyed by dataset id. */
export async function batchSavedFitOverlays(
  rows: readonly BatchFigureRow[],
  includedDatasetIds: ReadonlySet<string>,
  state: { datasets: readonly Dataset[]; staleFits: readonly string[] },
  signal?: AbortSignal,
): Promise<Map<string, FigureOverlays>> {
  const jobs: { dataset: Dataset; binding: OverlayBinding }[] = [];
  for (const row of rows) {
    if (!includedDatasetIds.has(row.datasetId) || !row.resolved) continue;
    const dataset = state.datasets.find((candidate) => candidate.id === row.datasetId);
    const spec = dataset?.fitSpec;
    if (!dataset || !spec?.params?.length || spec.yKey === undefined || dataset.pending) continue;
    if (state.staleFits.includes(dataset.id)) continue;
    const { mapping } = row.resolved;
    if (!mapping.yAuto && !mapping.yKeys.includes(spec.yKey)) continue;
    const binding = fitDrawBinding(dataset, { channels: [spec.yKey], xChannel: mapping.xKey }, spec);
    if (binding) jobs.push({ dataset, binding });
  }
  const out = new Map<string, FigureOverlays>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length && !signal?.aborted) {
      const { dataset, binding } = jobs[next++];
      const spec = dataset.fitSpec!;
      const y = await evaluateSavedFit(dataset, spec, spec.params!);
      if (typeof y === "string") continue;
      const overlays = captureFit({ datasetId: dataset.id, binding, y }, dataset);
      if (overlays) out.set(dataset.id, overlays);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  // Keyed in row order regardless of which evaluation finished first.
  return new Map(jobs.flatMap(({ dataset }) => (out.has(dataset.id) ? [[dataset.id, out.get(dataset.id)!]] : [])));
}
