import { exportFigureBatch } from "./api/figureBatch";
import type { FigureSpec } from "./api/figures";
import type { FigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument, type ExcludedRowsGhoster } from "./figureSpec";
import type { DefaultTrace } from "./seriesStyleTypes";
import type { Dataset } from "./types";

export const MAX_BATCH_FIGURE_EXPORT = 64;

export interface BatchFigureExportOptions {
  format: "pdf" | "svg" | "png" | "tiff";
  style: string;
  dpi: number;
  archiveName: string;
  autoSeriesStyles?: boolean;
  defaultTrace?: DefaultTrace;
  defaultLineWidth?: number;
  greyExcluded?: ExcludedRowsGhoster;
}

/** Build each batch member through the canonical FigureDocument adapter.
 * Missing/mismatched live data throws before the request, so a batch can
 * never render a figure against a similarly named sibling dataset. */
export function batchFigureSpecs(
  figures: readonly FigureDocument[],
  datasets: readonly Dataset[],
  options: BatchFigureExportOptions,
): FigureSpec[] {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  return figures.map((figure) => {
    const dataset = figure.bindings.datasetId === null ? null : byId.get(figure.bindings.datasetId);
    return buildFigureSpecFromDocument(figure, dataset, figure.name, {
      fmt: options.format,
      style: options.style,
      dpi: options.dpi,
      filename: figure.name,
      autoSeriesStyles: options.autoSeriesStyles,
      defaultTrace: options.defaultTrace,
      defaultLineWidth: options.defaultLineWidth,
      greyExcluded: options.greyExcluded,
    });
  });
}

export type BatchDatasetResolver = (datasetId: string) => Promise<Dataset | undefined>;

async function fullBatchDatasets(
  figures: readonly FigureDocument[],
  datasets: readonly Dataset[],
  resolveDataset: BatchDatasetResolver | undefined,
  signal: AbortSignal | undefined,
): Promise<Dataset[]> {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const ids = [...new Set(figures.flatMap((figure) =>
    figure.bindings.datasetId === null ? [] : [figure.bindings.datasetId],
  ))];
  for (const id of ids) {
    signal?.throwIfAborted();
    const preview = byId.get(id);
    if (!preview?.pending) continue;
    if (!resolveDataset) throw new Error(`Full data for "${preview.name}" must be loaded before batch export.`);
    const resolved = await resolveDataset(id);
    signal?.throwIfAborted();
    if (!resolved || resolved.pending) throw new Error(`Could not load full data for "${preview.name}"; no archive was created.`);
    byId.set(id, resolved);
  }
  return [...byId.values()];
}

export async function downloadBatchFigures(
  figures: readonly FigureDocument[],
  datasets: readonly Dataset[],
  options: BatchFigureExportOptions,
  signal?: AbortSignal,
  resolveDataset?: BatchDatasetResolver,
): Promise<void> {
  if (figures.length > MAX_BATCH_FIGURE_EXPORT) {
    throw new Error(`A single archive can contain at most ${MAX_BATCH_FIGURE_EXPORT} figures.`);
  }
  const fullDatasets = await fullBatchDatasets(figures, datasets, resolveDataset, signal);
  const specs = batchFigureSpecs(figures, fullDatasets, options);
  await exportFigureBatch(specs, options.archiveName.trim() || "figures", signal);
}
