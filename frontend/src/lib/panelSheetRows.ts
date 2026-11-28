// A panel's points as SHEET rows (facet grids and x-break rows). Panels are cut from the sheet's analysis view, so
// a panel's point j is
//
//   panel point j  ->  `panel.rows[j]` (a row of the data the panels were cut from: the sheet's analysis view)
//                  ->  that view's dataset row (`analysisRowIds`; the identity when nothing is dropped)
//                  ->  the sheet row (`+ offset` when the plot's row window cut the sheet, `range.from`).
//
// Shared by the per-point text symbols (lib/facetMarkerTexts.ts) and the Select rows box on a panel
// (lib/panelBoxRows.ts), so a letter, a row number and a selected row are the worksheet's row in each.

import type { FacetPanel } from "./facet";
import { activeRowIndices, droppedRows } from "./rowstate";
import type { Dataset } from "./types";

/** `panel`'s rows as sheet rows, or null when they do not line up with `view` (the dataset the panels were cut
 *  from) at the panel's x column `xKey` (null = the time column). */
export function panelSheetRows(
  panel: Pick<FacetPanel, "rows" | "payload" | "full">,
  view: Dataset,
  xKey: number | null,
  offset: number,
): number[] | null {
  const rows = panel.rows;
  const xs = panel.payload.data[0] as ArrayLike<number | null | undefined>;
  if (!rows || rows.length !== xs.length) return null;
  const ids = panel.full ? null : activeRowIndices(view.data.time.length, droppedRows(view));
  const out: number[] = [];
  for (let j = 0; j < rows.length; j++) {
    const r = ids ? ids[rows[j]] : rows[j];
    if (r === undefined) return null;
    const want = xKey === null ? view.data.time[r] : view.data.values[r]?.[xKey];
    const got = xs[j];
    if (Number.isFinite(want) !== Number.isFinite(got ?? NaN) || (Number.isFinite(want) && want !== got)) return null;
    out.push(offset + r);
  }
  return out;
}
