// "Use row states" on the canvas (G24). LAZY (loaded by
// `Stage/useRowStateColumns` the first time a plotted series asks for them).
//
// A row-states series is a FLAT `ColorScatterSpec` with explicit per-row `fills`
// and `shapes` (lib/colorscatter.ts), painted by the one colour-scatter plugin:
// the series' own line stays, the plugin draws every point (rows without a
// state in the series stroke and glyph). A series that also has a colour-by or
// size-by keeps those and takes no row states, as the export does
// (`calc.figure_marks`): provisional, owner to confirm.

import type { ColorScatterSpec } from "./colorscatter";
import { rowHex } from "./rowStyleExport";
import { usableRowStyle } from "./rowStyle";
import type { Dataset, MarkerShape, SeriesStyle } from "./types";

export function withRowStates(
  base: Map<number, ColorScatterSpec>,
  ds: Dataset,
  plotted: readonly number[],
  styles: Record<number, SeriesStyle>,
): Map<number, ColorScatterSpec> {
  const rs = usableRowStyle(ds);
  if (!rs) return base;
  const n = ds.data.time.length;
  let fills: (string | null)[] | undefined;
  let shapes: (MarkerShape | null)[] | undefined;
  let out = base;
  plotted.forEach((ch, p) => {
    const style = styles[ch];
    if (!style?.rowStates || style.colorBy != null || style.sizeBy != null) return;
    fills ??= Array.from({ length: n }, (_, r) => rowHex(rs.color?.[r]));
    shapes ??= Array.from({ length: n }, (_, r) => (rs.marker?.[r] || null) as MarkerShape | null);
    if (out === base) out = new Map(base);
    out.set(p + 1, {
      channel: ch, z: [], colormap: "viridis", lo: 0, hi: 1, flat: true, fills, shapes,
      ...(style.markerShape ? { shape: style.markerShape } : {}),
      ...(style.markerFill === "hollow" ? { hollow: true } : {}),
    });
  });
  return out;
}
