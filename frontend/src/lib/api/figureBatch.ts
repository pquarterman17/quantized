// Batch-only export seam. Keeping this wrapper separate prevents a lazy
// workshop feature from growing the already broad single-figure API module.

import { postDownload } from "./http";
import type { FigureSpec } from "./figures";

/** Render several ordinary FigureSpecs and download one ZIP. The backend
 * calls the same renderer as `exportFigure` for every member, while one
 * archive avoids browser multi-download blocking and preserves cancellation. */
export function exportFigureBatch(
  figures: readonly FigureSpec[],
  filename: string,
  signal?: AbortSignal,
): Promise<void> {
  return postDownload("/api/export/figure-batch", { figures, filename }, `${filename || "figures"}.zip`, signal);
}
