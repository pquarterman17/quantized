// Where a stat-plot legend goes (the split violin's, item 20): the top-right
// corner the other stat legends use, unless drawn shapes lie under it, then the
// corner with the fewest shape vertices under its box (ties keep the order top
// right, top left, bottom right, bottom left). The export's matplotlib legend is
// placed "best" the same way. Pure: pixel vertices in, the first swatch's spot out.

import type { Rect } from "./statRender";

export const LEGEND_ROW = 16;
const LEGEND_W = 124;
const EDGE = 8;

type Spot = { x: number; y: number };

/** The swatch x and first row's centre y for a legend of `rows` rows in `rect`, clear of `points` where a corner allows. */
export function legendSpot(rect: Rect, rows: number, points: readonly (readonly [number, number])[]): Spot {
  const right = rect.x + rect.w - 120;
  const left = rect.x + EDGE;
  const top = rect.y + 10;
  const bottom = rect.y + rect.h - 10 - (rows - 1) * LEGEND_ROW;
  const corners: Spot[] = [{ x: right, y: top }, { x: left, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  const under = (c: Spot): number =>
    points.filter(([px, py]) => px >= c.x - 4 && px <= c.x - 4 + LEGEND_W && py >= c.y - 9 && py <= c.y + (rows - 1) * LEGEND_ROW + 9).length;
  let best = corners[0];
  let fewest = under(best);
  for (const c of corners.slice(1)) {
    const n = under(c);
    if (n < fewest) { best = c; fewest = n; }
  }
  return best;
}
