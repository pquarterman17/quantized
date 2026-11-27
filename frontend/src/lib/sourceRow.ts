// A displayed row's SOURCE worksheet row (moved from the worksheet's `worksheetRows`, which re-exports it).

import { asPreviewSourceRows, PREVIEW_SOURCE_ROWS } from "./rowSidecars";
import type { Dataset } from "./types";

/** Translate one displayed preview row to its full-book row. Aligned previews
 * use the same index; sampled/unknown previews require a validated row map. */
export function resolvedSourceRow(source: Dataset, previewRow: number): number | null {
  if (source.pending == null) return previewRow;
  if (source.pending?.previewSampled === false) return previewRow;
  const map = asPreviewSourceRows(
    source.data.metadata?.[PREVIEW_SOURCE_ROWS],
    source.data.time.length,
    source.pending?.rows,
  );
  return map?.[previewRow] ?? null;
}
