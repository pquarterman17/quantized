// Batch-only export seam. Keeping this wrapper separate prevents a lazy
// workshop feature from growing the already broad single-figure API module.

import { HttpError, postDownload } from "./http";
import type { FigureSpec } from "./figures";

/** Render several ordinary FigureSpecs and download one ZIP -- or, with
 * `multipage`, one PDF with a page per figure (gap-audit-2 #10). The backend
 * calls the same renderer as `exportFigure` for every member, while one
 * archive avoids browser multi-download blocking and preserves cancellation. */
export async function exportFigureBatch(
  figures: readonly FigureSpec[],
  filename: string,
  signal?: AbortSignal,
  multipage = false,
): Promise<void> {
  try {
    const name = `${filename || "figures"}.${multipage ? "pdf" : "zip"}`;
    await postDownload("/api/export/figure-batch", multipage ? { figures, filename, multipage } : { figures, filename }, name, signal);
  } catch (error) {
    if (error instanceof HttpError && error.status === 413) {
      throw new Error("This batch is too large to send at once. Export fewer figures or split it into smaller archives.");
    }
    throw error;
  }
}
