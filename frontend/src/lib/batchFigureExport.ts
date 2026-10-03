import { exportFigureBatch } from "./api/figureBatch";
import type { FigureSpec } from "./api/figures";
import type { FigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import type { Dataset } from "./types";

export const MAX_BATCH_FIGURE_EXPORT = 64;

export interface BatchFigureExportOptions {
  format: "pdf" | "svg" | "png" | "tiff";
  style: string;
  dpi: number;
  archiveName: string;
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
    });
  });
}

export async function downloadBatchFigures(
  figures: readonly FigureDocument[],
  datasets: readonly Dataset[],
  options: BatchFigureExportOptions,
  signal?: AbortSignal,
): Promise<void> {
  if (figures.length > MAX_BATCH_FIGURE_EXPORT) {
    throw new Error(`A single archive can contain at most ${MAX_BATCH_FIGURE_EXPORT} figures.`);
  }
  const specs = batchFigureSpecs(figures, datasets, options);
  await exportFigureBatch(specs, options.archiveName.trim() || "figures", signal);
}
