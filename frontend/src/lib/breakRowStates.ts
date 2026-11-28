// Row states (G24, "Use row states") on the panels of an axis-break row. LAZY: loaded by `Stage/useBreakRowStates`
// the first time a break is drawn over a sheet that has row styles and a series that asks for them.
//
// A break panel is cut from the sheet's analysis view, so the point `j` of a panel is the sheet's row
// `panelSheetRows(panel)[j]` (the mapping the Select rows box and the per-point texts already use). Its colour and
// glyph are that row's cells, resolved through `rowStateSpecs` exactly as the flat plot's. The export draws the same
// rows the same way: its series carries the per-row arrays of the request's rows (`lib/rowStyleExport`) and the
// renderer cuts them by each panel's x range (`calc/figure_break_rows.py`); `tests/fixtures/wire/
// row_states_break.json` pins the two together. A panel whose points cannot be named exactly gets none (never a
// colour on the wrong measurement).

import type { BreakPanel } from "./facet";
import type { Composition } from "./composition";
import { panelSheetRows } from "./panelSheetRows";
import { usableRowStyle } from "./rowStyle";
import { rowStateSpecs } from "./rowStyleSpecs";
import type { Dataset, SeriesStyle } from "./types";

/** `c` with each panel's row-state specs attached, or `c` itself when no panel gets any.
 *  `view` is the sheet the panels were cut from (the plot's window of `sheet`), `offset` its first row in `sheet`. */
export function withBreakRowStates(
  c: Composition,
  sheet: Dataset,
  view: Dataset,
  xKey: number | null,
  offset: number,
  styles: Record<number, SeriesStyle>,
): Composition {
  const rs = usableRowStyle(sheet);
  if (c.kind !== "break" || !rs) return c;
  let changed = false;
  const panels = c.panels.map((p): BreakPanel => {
    const rows = panelSheetRows({ full: undefined, ...p }, view, xKey, offset);
    if (!rows) return p;
    const colorBy = rowStateSpecs(new Map(), rs, rows, p.channels, styles);
    if (colorBy.size === 0) return p;
    changed = true;
    return { ...p, colorBy };
  });
  return changed ? { ...c, panels } : c;
}
