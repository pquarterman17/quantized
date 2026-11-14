// Whole-row and whole-column selection clicks for the worksheet grid (moved
// out of GridViewport under the component ceiling). Row numbers: a plain
// click toggles the row into the selection; a shift-click extends from the
// last-clicked anchor across the DISPLAYED (post-filter/sort) rows. Headers
// (item 6): a plain click selects ONLY that column, ctrl/cmd-click toggles it
// into a multi-selection, shift-click extends a range from the anchor. Column
// indices are stable (channel order, not DOM position), so the selection
// survives scrolling; -1 (the pinned X column) is a valid anchor.

import { useState } from "react";

export interface LineSelectHandlers {
  onRowNumClick: (r: number, e: React.MouseEvent) => void;
  onHeaderClick: (col: number, e: React.MouseEvent) => void;
}

export function useLineSelect(
  order: readonly number[],
  rows: { toggle: (r: number) => void; range: (rows: number[]) => void },
  cols: { toggle: (col: number) => void; range: (cols: number[]) => void },
): LineSelectHandlers {
  // Anchor row for shift-click range selection (an original row index).
  const [anchor, setAnchor] = useState<number | null>(null);
  const [colAnchor, setColAnchor] = useState<number | null>(null);

  const onRowNumClick = (r: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor != null) {
      const aPos = order.indexOf(anchor);
      const pos = order.indexOf(r);
      if (aPos >= 0 && pos >= 0) {
        const [lo, hi] = aPos <= pos ? [aPos, pos] : [pos, aPos];
        rows.range(order.slice(lo, hi + 1));
        return;
      }
    }
    rows.toggle(r);
    setAnchor(r);
  };

  const onHeaderClick = (col: number, e: React.MouseEvent) => {
    if (e.shiftKey && colAnchor != null) {
      const [lo, hi] = colAnchor <= col ? [colAnchor, col] : [col, colAnchor];
      const range: number[] = [];
      for (let c = lo; c <= hi; c++) range.push(c);
      cols.range(range);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      cols.toggle(col);
      setColAnchor(col);
      return;
    }
    cols.range([col]);
    setColAnchor(col);
  };

  return { onRowNumClick, onHeaderClick };
}
