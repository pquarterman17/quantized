// E-c1's REFERENCE thumbnail generator: a figure page's rows×cols panel
// grid as a pure SVG data: URL. It exists to prove the generation →
// cache → tile pipe end-to-end with a deterministic, jsdom-testable
// renderer; E-c2 owns the real preview visuals (plot/table/analysis
// content, loading/error appearance, sizing) and replaces or extends the
// generator set. Neutral grayscale on purpose: an <img src="data:…"> can't
// read the design-token CSS custom properties, and committing to real
// colors here would preempt E-c2's visual pass.

import type { ThumbnailRequest, ThumbnailResult } from "./thumbnailCache";
import { panelReferencesFigure } from "./thumbnailRequest";
import { plotSvgBody, svgResult } from "./thumbnailSvg";
import type { FigureDocument } from "./figureDocument";

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
 *  is honored. Renders from the resolved request — `deps` carries the
 *  referenced figures in panel order (null = missing reference), the same
 *  objects the cache fingerprint was formed from — so a panel whose figure
 *  is GONE draws as empty, and the thumbnail regenerates when any
 *  referenced figure changes. */
export async function generatePageThumbnail(
  request: ThumbnailRequest,
  signal: AbortSignal,
): Promise<ThumbnailResult> {
  const { node, deps } = request;
  if (node.kind !== "page") throw new Error(`page generator got "${node.kind}"`);
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const page = node.entity;
  // TYPED slices from the resolver — no shape-sniffing of the flat `deps`
  // fingerprint array (the `"pending" in dep` bug class, PR #150 review:
  // an optional-field probe filtered out every normally-loaded dataset and
  // drew live-figure panels as gray boxes).
  const figures = request.figureDeps;
  const datasets = request.datasetDeps;
  let figureCursor = 0;
  const safeRows = Math.max(1, page.rows);
  const safeCols = Math.max(1, page.cols);
  const gap = 8;
  const pad = 10;
  const cellW = (320 - pad * 2 - gap * (safeCols - 1)) / safeCols;
  const cellH = (180 - pad * 2 - gap * (safeRows - 1)) / safeRows;
  const panels = page.panels.map((panel, index) => {
    // panelReferencesFigure is the SAME predicate the resolver used to
    // produce figureDeps, so the cursor cannot desynchronize; a null slot
    // is a missing figure.
    const figure: FigureDocument | null = panelReferencesFigure(panel) ? figures[figureCursor++] ?? null : null;
    const dataset = figure?.bindings.datasetId
      ? datasets.find((candidate) => candidate?.id === figure.bindings.datasetId)
      : undefined;
    const data = figure?.data?.mode === "frozen" ? figure.data.snapshot : dataset?.data;
    const col = index % safeCols;
    const row = Math.floor(index / safeCols);
    const box = { x: pad + col * (cellW + gap), y: pad + row * (cellH + gap), width: cellW, height: cellH };
    // A figure that EXISTS but has no renderable data → the solid
    // "referenced" block; a MISSING figure falls through to plotSvgBody's
    // dashed "No plottable data" box (Sol's original state semantics).
    if (figure && !data) {
      return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="4" fill="#9a9a9a" fill-opacity="0.55"/>`;
    }
    return plotSvgBody(data, figure?.bindings.xKey, figure?.bindings.yKeys, box);
  }).join("");
  if (panels) return svgResult(panels, page.name);
  let referenced = 0;
  return pageThumbnailSvg(
    page.rows,
    page.cols,
    page.panels.map((panel) => (panelReferencesFigure(panel) ? deps[referenced++] != null : false)),
  );
}
