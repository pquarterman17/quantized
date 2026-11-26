// Cell-value labels on the 2-D map's heatmap (the option in the Inspector's
// "2-D map" card, `MapViewState.cellLabels`). Each cell prints its raw value in
// the ink that reads against the cell's colour, and a cell too small to hold the
// text is skipped. The rules (format, contrast, cutoff) live in
// `lib/cellLabels.ts`; the export draws the same labels
// (`calc/figure_cell_labels.py`).
import { type CellLabelOptions, cellLabelFits, contrastTextColor, formatCellValue } from "../../lib/cellLabels";
import { COLORMAPS, type ColormapName, normalize, sampleColormap } from "../../lib/colormap";
import type { MapPayload } from "../../lib/mapdataFetch";

export const CELL_LABEL_FONT_PX = 10;

export function drawCellLabels(
  ctx: CanvasRenderingContext2D,
  p: MapPayload,
  rect: { x: number; y: number; w: number; h: number },
  opts: CellLabelOptions,
  lo: number,
  hi: number,
  logZ: boolean,
  cmap: ColormapName,
): void {
  const nx = p.xAxis.length;
  const ny = p.yAxis.length;
  if (nx < 2 || ny < 2) return;
  // Each cell is centred on its axis value, as the heatmap blit places it.
  const cw = rect.w / (nx - 1);
  const ch = rect.h / (ny - 1);
  if (cw < CELL_LABEL_FONT_PX || ch < CELL_LABEL_FONT_PX * 1.2) return; // no label could fit: skip the sweep
  const stops = COLORMAPS[cmap];
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.font = `${CELL_LABEL_FONT_PX}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = p.zGrid[j]?.[i];
      if (v == null || !Number.isFinite(v)) continue;
      const t = normalize(v, lo, hi, logZ);
      if (t == null) continue; // a gap, as in the heatmap
      const text = formatCellValue(v, opts.format, opts.precision);
      if (!cellLabelFits(cw, ch, text, CELL_LABEL_FONT_PX)) continue;
      const [r, g, b] = sampleColormap(stops, t);
      ctx.fillStyle = contrastTextColor(r, g, b);
      ctx.fillText(text, rect.x + i * cw, rect.y + rect.h - j * ch);
    }
  }
  ctx.restore();
}
