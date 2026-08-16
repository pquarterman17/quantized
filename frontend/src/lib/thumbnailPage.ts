// E-c1's REFERENCE thumbnail generator: a figure page's rows×cols panel
// grid as a pure SVG data: URL. It exists to prove the generation →
// cache → tile pipe end-to-end with a deterministic, jsdom-testable
// renderer; E-c2 owns the real preview visuals (plot/table/analysis
// content, loading/error appearance, sizing) and replaces or extends the
// generator set. Neutral grayscale on purpose: an <img src="data:…"> can't
// read the design-token CSS custom properties, and committing to real
// colors here would preempt E-c2's visual pass.

import type { LibraryNode } from "./libraryHierarchy";
import type { ThumbnailResult } from "./thumbnailCache";

const W = 160;
const H = 120;
const PAD = 8;
const GAP = 6;

export function pageThumbnailSvg(rows: number, cols: number, filled: readonly boolean[]): ThumbnailResult {
  const safeRows = Math.max(1, rows);
  const safeCols = Math.max(1, cols);
  const cellW = (W - PAD * 2 - GAP * (safeCols - 1)) / safeCols;
  const cellH = (H - PAD * 2 - GAP * (safeRows - 1)) / safeRows;
  const cells: string[] = [];
  for (let r = 0; r < safeRows; r++) {
    for (let c = 0; c < safeCols; c++) {
      const x = (PAD + c * (cellW + GAP)).toFixed(1);
      const y = (PAD + r * (cellH + GAP)).toFixed(1);
      const hasFigure = filled[r * safeCols + c] === true;
      cells.push(
        `<rect x="${x}" y="${y}" width="${cellW.toFixed(1)}" height="${cellH.toFixed(1)}" rx="2" ` +
          (hasFigure ? 'fill="#9a9a9a" fill-opacity="0.55"' : 'fill="none" stroke="#9a9a9a" stroke-opacity="0.45"') +
          "/>",
      );
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#9a9a9a" fill-opacity="0.08"/>${cells.join("")}</svg>`;
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, width: W, height: H };
}

/** The registered "page" generator. Synchronous work wrapped in the async
 *  contract; still checks the signal so an abort during the microtask gap
 *  is honored. */
export async function generatePageThumbnail(
  node: LibraryNode,
  signal: AbortSignal,
): Promise<ThumbnailResult> {
  if (node.kind !== "page") throw new Error(`page generator got "${node.kind}"`);
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const page = node.entity;
  return pageThumbnailSvg(
    page.rows,
    page.cols,
    page.panels.map((panel) => panel.figureId != null),
  );
}
