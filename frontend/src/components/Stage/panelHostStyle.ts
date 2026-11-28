// The host div's layout for each arrangement `useMultiPanelStage` renders into (split out of it: size ratchet).

import type { CSSProperties } from "react";

/** `host` style for the arrangement on show: a spatial page (children are pixel-positioned: `panelLayout`'s
 *  column/row math, not CSS Grid `1fr`, since a grid's `gap` is one uniform value and cannot express a flush (0px)
 *  row boundary next to a normal one; `position: absolute` still makes the containing block the children resolve
 *  against), a break row, a facet grid, or the plain stack column. */
export function panelHostStyle(
  mode: { spatial: boolean; breakMode: boolean; facet: boolean },
  facetGrid: { rows: number; cols: number },
  gap: number,
): CSSProperties {
  if (mode.spatial) return { position: "absolute", inset: 8 };
  if (mode.breakMode) return { position: "absolute", inset: 8, display: "flex", flexDirection: "row" };
  if (mode.facet) {
    return {
      position: "absolute",
      inset: 8,
      display: "grid",
      gap,
      gridTemplateRows: `repeat(${facetGrid.rows}, 1fr)`,
      gridTemplateColumns: `repeat(${facetGrid.cols}, 1fr)`,
    };
  }
  return { position: "absolute", inset: 8, display: "flex", flexDirection: "column", gap: 8 };
}
