import type { FigureDocument } from "./figureDocument";
import type { Dataset } from "./types";

/** In-memory render identity for a frozen FigureDocument. It is never added
 * to Library datasets, so data-edit actions cannot mistake it for a worksheet. */
export function frozenFigureDataset(document: FigureDocument | null | undefined): Dataset | null {
  const data = document?.data.mode === "frozen" ? document.data.snapshot : undefined;
  return document && data ? {
    id: `__quantized_frozen_figure__:${document.id}`,
    name: document.name,
    data,
  } : null;
}
