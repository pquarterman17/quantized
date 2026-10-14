/** A reference line the pointer is over (for drag hit-testing). */
export interface RefLineHit {
  id: string;
  axis: "x" | "y";
}

/** Pick the reference line nearest the pointer within `tol` px, or null. Each
 * candidate carries its on-axis pixel: x-lines are vertical (compare pointer.x),
 * y-lines horizontal (compare pointer.y). Ties resolve to the closest. */
export function pickRefLine(
  candidates: { id: string; axis: "x" | "y"; px: number }[],
  pointer: { x: number; y: number },
  tol = 6,
): RefLineHit | null {
  let best: RefLineHit | null = null;
  let bestDist = tol;
  for (const c of candidates) {
    if (!Number.isFinite(c.px)) continue;
    const d = Math.abs((c.axis === "x" ? pointer.x : pointer.y) - c.px);
    if (d <= bestDist) {
      bestDist = d;
      best = { id: c.id, axis: c.axis };
    }
  }
  return best;
}
