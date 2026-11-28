// The Select rows box on ONE panel of a multi-panel layout (a facet grid, an x-break row). The box is drawn inside a
// panel and read in that panel's own data coordinates, so it selects only that panel's points: a facet level's rows,
// or a break segment's. The picked rows are SHEET rows (lib/panelSheetRows.ts), written through the row-state model
// as the single plot's box is. Pure; loaded on demand from Stage/usePanelBoxSelect.ts.
//
// A drag that starts in one panel ends in it: uPlot clamps the dragged box to the panel it started in, so a drag that
// leaves it is clipped there and never reaches a neighbour.

import type { BreakPanel, FacetPanel } from "./facet";
import { panelSheetRows } from "./panelSheetRows";
import { rowsInBox, rowsInRange } from "./plotPointMask";
import type { Dataset } from "./types";

/** A drag inside one panel: its x band and, for a box, the y edges (unordered). */
export interface PanelBoxPick {
  x0: number;
  x1: number;
  y?: [number, number];
}

export const PANEL_MISALIGNED =
  "this panel's points do not line up with the sheet's rows (a stale arrangement)";

/** The sheet rows (ascending) behind the drawn points of `panel` inside `pick`: its X in the band and, for a box,
 *  the Y of any shown series inside the edges. `hidden` lists hidden channels (their points are not drawn). A string
 *  when the panel cannot name its rows exactly. */
export function panelBoxRows(
  panel: Pick<FacetPanel, "payload" | "rows" | "channels" | "full"> | Pick<BreakPanel, "payload" | "rows" | "channels">,
  view: Dataset,
  xKey: number | null,
  offset: number,
  pick: PanelBoxPick,
  hidden: readonly number[] = [],
): number[] | string {
  const sheet = panelSheetRows({ full: undefined, ...panel }, view, xKey, offset);
  if (!sheet) return PANEL_MISALIGNED;
  const { series, data } = panel.payload;
  const shown = series.flatMap((_s, i) => (hidden.includes(panel.channels[i]) ? [] : [i]));
  const cols = [data[0] ?? [], ...shown.map((i) => data[i + 1] ?? [])] as (number | null)[][];
  const hit = pick.y
    ? rowsInBox(cols, shown.map((i) => series[i]), shown.length, { x0: pick.x0, x1: pick.x1, y: pick.y })
    : rowsInRange(cols[0], pick.x0, pick.x1);
  return [...new Set(hit.map((j) => sheet[j]))].sort((a, b) => a - b);
}
