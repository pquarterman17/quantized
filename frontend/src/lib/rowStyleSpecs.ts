// "Use row states" on the canvas (G24). LAZY (loaded by
// `Stage/useRowStateColumns` the first time a plotted series asks for them).
//
// A row-states series is a FLAT `ColorScatterSpec` with explicit per-row `fills`
// and `shapes` (lib/colorscatter.ts), painted by the one colour-scatter plugin:
// the series' own line stays, the plugin draws every point (rows without a
// state in the series stroke and glyph). A series that also has a colour-by or
// size-by keeps its spec (the colour scale, the per-row diameters) and gains
// the row states on top: a row with a state takes its colour and glyph, every
// other row keeps the scale's colour. The export draws the same
// (`calc.figure_colorscatter_rows`, `calc.figure_row_states`).

import type { ColorScatterSpec } from "./colorscatter";
import { rowHex } from "./rowStyleExport";
import { usableRowStyle, type RowStyle } from "./rowStyle";
import type { Dataset, MarkerShape, SeriesStyle } from "./types";

export function withRowStates(
  base: Map<number, ColorScatterSpec>,
  ds: Dataset,
  plotted: readonly number[],
  styles: Record<number, SeriesStyle>,
): Map<number, ColorScatterSpec> {
  const rs = usableRowStyle(ds);
  if (!rs) return base;
  return rowStateSpecs(base, rs, Array.from({ length: ds.data.time.length }, (_v, r) => r), plotted, styles);
}

/** `withRowStates` over drawn points that are not the sheet's rows one for one: point `i` is the sheet's row
 *  `rows[i]` (an axis-break panel's points, `lib/breakRowStates`). The fills and shapes are the same cells through
 *  the same `rowHex`, so a row has one colour and one glyph wherever it is drawn. */
export function rowStateSpecs(
  base: Map<number, ColorScatterSpec>,
  rs: RowStyle,
  rows: readonly number[],
  plotted: readonly number[],
  styles: Record<number, SeriesStyle>,
): Map<number, ColorScatterSpec> {
  let fills: (string | null)[] | undefined;
  let shapes: (MarkerShape | null)[] | undefined;
  let out = base;
  plotted.forEach((ch, p) => {
    const style = styles[ch];
    if (!style?.rowStates) return;
    fills ??= rows.map((r) => rowHex(rs.color?.[r]));
    shapes ??= rows.map((r) => (rs.marker?.[r] || null) as MarkerShape | null);
    const have = style.colorBy != null || style.sizeBy != null ? base.get(p + 1) : undefined;
    if (!have && (style.colorBy != null || style.sizeBy != null)) return; // its colour / size column is empty (or this view draws none): plain
    if (out === base) out = new Map(base);
    if (have) {
      out.set(p + 1, { ...have, fills, shapes });
      return;
    }
    out.set(p + 1, {
      channel: ch, z: [], colormap: "viridis", lo: 0, hi: 1, flat: true, fills, shapes,
      ...(style.markerShape ? { shape: style.markerShape } : {}),
      ...(style.markerFill === "hollow" ? { hollow: true } : {}),
    });
  });
  return out;
}
