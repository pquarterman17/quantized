// Deterministic label placement that avoids overlaps (plan item 18). ONE rule
// shared with the export (`calc/label_placement.py`, the line-for-line twin),
// pinned by `tests/fixtures/wire/point_label_placement.json`; each side calls it
// with its OWN text metrics (canvas `measureText` here, matplotlib's renderer
// there). Pure. Units are the caller's (device pixels); y grows DOWNWARD.
//
// Rules:
//  * Labels are placed by importance (largest first), then `ax` (left to right),
//    then input order, so a peak keeps its best slot.
//  * Candidate slots per label, in order: the default (up and right, exactly where
//    an unplaced label sits today), above, below, left, right, then the other three
//    diagonals; then the same eight again `step` farther out, for `rings` more rings.
//  * The first slot whose box is inside `rect`, touches no placed box (kept `pad`
//    apart) and covers no marker (a disc of `markerR` at every anchor) wins.
//  * A label with no free slot keeps the default slot and is flagged `overlap`; it
//    still counts as placed. Nothing is ever dropped.
//  * A box farther than `leaderMin` label heights from its point gets a leader line
//    from the box's nearest point to the marker edge.

export interface PlaceItem { ax: number; ay: number; w: number; h: number; importance: number }
export interface PlaceRect { left: number; top: number; right: number; bottom: number }
export interface PlaceOpts { gap: number; markerR: number; step: number; rings: number; pad: number; leaderMin: number }
export interface Placed {
  left: number;
  top: number;
  overlap: boolean;
  /** x0, y0 (label end), x1, y1 (marker end); null when the label sits close. */
  leader: [number, number, number, number] | null;
}

/** (dx, dy) of each slot's direction; dy < 0 is up. The default (up-right) first. */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, -1], [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1],
];

type Box = readonly [number, number, number, number];

function boxAt(it: PlaceItem, d: number, [dx, dy]: readonly [number, number]): [number, number] {
  const left = dx > 0 ? it.ax + d : dx < 0 ? it.ax - d - it.w : it.ax - it.w / 2;
  const top = dy < 0 ? it.ay - d - it.h : dy > 0 ? it.ay + d : it.ay - it.h / 2;
  return [left, top];
}

function isFree(b: Box, rect: PlaceRect, placed: readonly Box[], anchors: readonly PlaceItem[], o: PlaceOpts): boolean {
  const [l, t, r, bt] = b;
  if (l < rect.left || t < rect.top || r > rect.right || bt > rect.bottom) return false;
  for (const [pl, pt, pr, pb] of placed) {
    if (l < pr + o.pad && pl - o.pad < r && t < pb + o.pad && pt - o.pad < bt) return false;
  }
  const r2 = o.markerR * o.markerR;
  for (const a of anchors) {
    const nx = Math.min(Math.max(a.ax, l), r), ny = Math.min(Math.max(a.ay, t), bt);
    if ((nx - a.ax) ** 2 + (ny - a.ay) ** 2 < r2) return false;
  }
  return true;
}

function leaderOf(it: PlaceItem, left: number, top: number, o: PlaceOpts): [number, number, number, number] | null {
  const nx = Math.min(Math.max(it.ax, left), left + it.w), ny = Math.min(Math.max(it.ay, top), top + it.h);
  const dx = nx - it.ax, dy = ny - it.ay;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= o.leaderMin * it.h || dist === 0) return null;
  const k = o.markerR / dist;
  return [nx, ny, it.ax + dx * k, it.ay + dy * k];
}

/** The slot of every item, aligned with `items` (see the header). */
export function placeLabels(items: readonly PlaceItem[], rect: PlaceRect, o: PlaceOpts): Placed[] {
  const order = items.map((_, i) => i).sort((a, b) => items[b].importance - items[a].importance || items[a].ax - items[b].ax || a - b);
  const out: Placed[] = new Array<Placed>(items.length);
  const placed: Box[] = [];
  for (const i of order) {
    const it = items[i];
    let chosen: [number, number] | null = null;
    for (let k = 0; k <= o.rings && !chosen; k++) {
      const d = o.gap + k * o.step;
      for (const dir of DIRECTIONS) {
        const [left, top] = boxAt(it, d, dir);
        if (isFree([left, top, left + it.w, top + it.h], rect, placed, items, o)) { chosen = [left, top]; break; }
      }
    }
    const overlap = chosen === null;
    const [left, top] = chosen ?? boxAt(it, o.gap, DIRECTIONS[0]);
    placed.push([left, top, left + it.w, top + it.h]);
    out[i] = { left, top, overlap, leader: leaderOf(it, left, top, o) };
  }
  return out;
}
