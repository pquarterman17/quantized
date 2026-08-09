// Pure, DOM-free ROI geometry for the RSM box/ruler/sector tools
// (RSM_CUTS_PLAN item 4): box-rect + cut-ruler hit-testing, drag math, and
// backend request shaping. Same purity split as `lib/mapcuts.ts` (that
// module's header is the template) — kept free of `components/` so the
// gesture/drag/request-shaping logic is unit-testable without a canvas, and
// so item 6's `useMapRoi.ts` hook is a thin wiring layer over this, not
// where the geometry lives.
//
// Hit-test math REUSES `lib/shapeHit.ts`'s segment/rect primitives
// (`pointToSegmentDistance`, `pointInRect`) rather than re-deriving them —
// that module's "more precise geometry wins" precedence (handle > edge >
// interior) is followed here too.
//
// px vs data space: `classifyRoiHit`/`classifyRulerHit`/`applyRoiDrag`/
// `applyRulerDrag` all take PX-space geometry for hit-testing but DATA-space
// deltas for dragging — mirroring how `components/Stage/mapRender.ts`'s
// `hitTest`/`dataToPx` split works (px for display, data for storage). A
// rotated ruler is NOT a rotated rect once projected to px: `hitTest`'s x/y
// scales are independently fit to the plot rect, so an affine data->px map
// turns a rotation into a general parallelogram. `rulerCorners` therefore
// returns DATA-space corners; the caller projects each one (mapRender's
// `dataToPx`) to get the px quad `classifyRulerHit` hit-tests generically
// (no "unrotate" shortcut — see `pointInConvexQuad`).

import { pointInRect, pointToSegmentDistance } from "./shapeHit";
import type { CutSpace } from "./mapcuts";
import type { DataStruct, RsmPeak } from "./types";

// ── Types ────────────────────────────────────────────────────────────────

/** A drawn/typed box ROI, DATA coords, always normalized (x0<=x1, y0<=y1) —
 *  `normalizeRect` is the only place that invariant is enforced; every
 *  mutator below routes its result through it. `space` is the axis pair it
 *  was drawn against (Resolved decisions: "ROI keeps the space it was drawn
 *  in — no silent angular<->Q conversion"). */
export interface RoiRect {
  space: CutSpace;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The cut-ruler primitive (Resolved decisions, rev 2 "rotated cuts"):
 *  centre + angle (DEGREES, 0=+x axis, CCW — matches `sector_profile`'s phi
 *  convention) + length (along the cut) + width (across it), DATA coords. A
 *  rotation handle is deliberately absent — angle is set by dragging an
 *  endpoint (`applyRulerDrag`'s "ruler-end" case), never a separate handle. */
export interface RoiRuler {
  space: CutSpace;
  cx: number;
  cy: number;
  angle: number;
  length: number;
  width: number;
}

/** A sector/annulus selection for the true-polar branch (i) tools
 *  (`/api/rsm/sector`, `/api/rsm/chi-profile`) — always reciprocal space (no
 *  `space` field: true-polar requires Qx/Qz, Resolved decisions branch i).
 *  `phiMin`/`phiMax` are the CANONICAL bounds the backend takes; the
 *  panel's center/half-width entry mode goes through `sectorFromCenter`
 *  first. */
export interface RoiSector {
  qMin: number;
  qMax: number;
  phiMin: number;
  phiMax: number;
}

/** One saved, named ROI (item 8's Saved ROIs card) — a box, ruler, or
 *  sector definition, round-tripped through `store/rois.ts`. */
export type RoiDef = { id: string; name: string } & (
  | { kind: "rect"; rect: RoiRect }
  | { kind: "ruler"; ruler: RoiRuler }
  | { kind: "sector"; sector: RoiSector }
);

/** Which compass edge of an axis-aligned px rect a point is nearest —
 *  "n"/"s" are the top/bottom (px y0/y1) faces, "e"/"w" the right/left
 *  (px x1/x0) faces. Named by data-space intuition (north = up = larger
 *  data y), even though px y is flipped relative to data y internally. */
export type RoiEdge = "n" | "s" | "e" | "w";

/** The result of a hit-test against a box (`classifyRoiHit`) or ruler
 *  (`classifyRulerHit`) — ONE shared discriminated union so `roiCursor` and
 *  the drag appliers switch on a single `kind` tag. A box hit is never
 *  "ruler-end"/"ruler-width"; a ruler hit is never "edge"/plain "handle" (a
 *  ruler's body only translates — Resolved decisions rev 2: "interior
 *  translates" — it has no edge-drag resize, only its 4 named handles). */
export type RoiHit =
  | { kind: "inside" }
  | { kind: "edge"; edge: RoiEdge }
  | { kind: "handle"; index: number } // 0..7, see handlePositions' order
  | { kind: "ruler-end"; index: 0 | 1 }
  | { kind: "ruler-width"; index: 0 | 1 }
  | null;

// ── Box rect: normalize, project, hit-test, drag ────────────────────────

/** Sort a rect's bounds so x0<=x1, y0<=y1 — the ONE place a crossed drag
 *  (left edge dragged past the right edge, etc.) becomes a valid,
 *  positive-size rect instead of a negative-width one. */
export function normalizeRect(rect: RoiRect): RoiRect {
  return {
    ...rect,
    x0: Math.min(rect.x0, rect.x1),
    x1: Math.max(rect.x0, rect.x1),
    y0: Math.min(rect.y0, rect.y1),
    y1: Math.max(rect.y0, rect.y1),
  };
}

/** Never let a drag collapse a rect below a minimum on-screen size — expands
 *  symmetrically about the current centre (doesn't favour whichever edge was
 *  dragged). Internal to `applyRoiDrag`'s post-normalize clamp. */
function clampRectSize(rect: RoiRect, minW: number, minH: number): RoiRect {
  let { x0, x1, y0, y1 } = rect;
  if (x1 - x0 < minW) {
    const cx = (x0 + x1) / 2;
    x0 = cx - minW / 2;
    x1 = cx + minW / 2;
  }
  if (y1 - y0 < minH) {
    const cy = (y0 + y1) / 2;
    y0 = cy - minH / 2;
    y1 = cy + minH / 2;
  }
  return { ...rect, x0, x1, y0, y1 };
}

/** Project a DATA-space rect's two corners through `project` (a data->px
 *  projector — `components/Stage/mapRender.ts::dataToPx` bound to the
 *  live payload/canvas size, passed in so this module never imports from
 *  `components/`) and return the PX-space bounding box, already normalized
 *  (min/max, not corner-order-dependent — `project`'s y-flip means the
 *  data-y0 corner lands at the LARGER px y). Null when either corner falls
 *  outside the plot area (nothing sane to draw). */
export function rectToPx(
  rect: RoiRect,
  project: (x: number, y: number) => [number, number] | null,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const a = project(rect.x0, rect.y0);
  const b = project(rect.x1, rect.y1);
  if (!a || !b) return null;
  return {
    x0: Math.min(a[0], b[0]),
    x1: Math.max(a[0], b[0]),
    y0: Math.min(a[1], b[1]),
    y1: Math.max(a[1], b[1]),
  };
}

/** The 8 resize handles of a PX-space rect, clockwise from top-left: corner,
 *  edge-midpoint, corner, edge-midpoint, ... — index order [NW, N, NE, E,
 *  SE, S, SW, W]. `classifyRoiHit`/`applyRoiDrag`/`roiCursor` all key off
 *  this SAME order (a handle's cursor and its drag-edges are looked up by
 *  index), so it must never change without updating all three. */
export function handlePositions(rectPx: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}): { x: number; y: number }[] {
  const { x0, y0, x1, y1 } = rectPx;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return [
    { x: x0, y: y0 }, // 0 NW
    { x: mx, y: y0 }, // 1 N
    { x: x1, y: y0 }, // 2 NE
    { x: x1, y: my }, // 3 E
    { x: x1, y: y1 }, // 4 SE
    { x: mx, y: y1 }, // 5 S
    { x: x0, y: y1 }, // 6 SW
    { x: x0, y: my }, // 7 W
  ];
}

/** Which DATA edge(s) each handle index moves — `applyRoiDrag`'s lookup,
 *  index-paired with `handlePositions`' order above. */
const HANDLE_EDGES: readonly RoiEdge[][] = [
  ["w", "n"], // 0 NW
  ["n"], // 1 N
  ["e", "n"], // 2 NE
  ["e"], // 3 E
  ["e", "s"], // 4 SE
  ["s"], // 5 S
  ["w", "s"], // 6 SW
  ["w"], // 7 W
];

/** Nearest-wins hit-test against a PX-space rect: a resize HANDLE within
 *  `tolHandle` beats an EDGE within `tolEdge`, which beats the translucent
 *  INTERIOR — `shapeHit.ts`'s "more precise geometry wins" order. Reuses
 *  `pointToSegmentDistance` (per-edge, so the returned n/s/e/w is the
 *  SPECIFIC nearest edge, not just "on some edge") and `pointInRect`. */
export function classifyRoiHit(
  rectPx: { x0: number; y0: number; x1: number; y1: number },
  p: { x: number; y: number },
  tolHandle = 7,
  tolEdge = 6,
): RoiHit {
  const handles = handlePositions(rectPx);
  let bestIndex = -1;
  let bestDist = tolHandle;
  handles.forEach((h, i) => {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    if (d <= bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  });
  if (bestIndex >= 0) return { kind: "handle", index: bestIndex };

  const { x0, y0, x1, y1 } = rectPx;
  const edges: { edge: RoiEdge; d: number }[] = [
    { edge: "n", d: pointToSegmentDistance(p, x0, y0, x1, y0) },
    { edge: "e", d: pointToSegmentDistance(p, x1, y0, x1, y1) },
    { edge: "s", d: pointToSegmentDistance(p, x1, y1, x0, y1) },
    { edge: "w", d: pointToSegmentDistance(p, x0, y1, x0, y0) },
  ];
  const nearestEdge = edges.reduce((a, b) => (b.d < a.d ? b : a));
  if (nearestEdge.d <= tolEdge) return { kind: "edge", edge: nearestEdge.edge };

  if (pointInRect(p, x0, y0, x1, y1)) return { kind: "inside" };
  return null;
}

/** CSS cursor for a hit — resize direction for handles/edges (paired to
 *  `HANDLE_EDGES`' geometry: NW/SE diagonal, NE/SW diagonal, N/S vertical,
 *  E/W horizontal), "move" for the interior. A ruler's end/width handles
 *  have no fixed resize direction (the ruler can point any way) — CSS has
 *  no angle-aware resize cursor, so both fall back to "crosshair" (the
 *  conventional "adjusts a vector" cursor). */
export function roiCursor(hit: RoiHit): string {
  if (!hit) return "default";
  switch (hit.kind) {
    case "inside":
      return "move";
    case "edge":
      return hit.edge === "n" || hit.edge === "s" ? "ns-resize" : "ew-resize";
    case "handle": {
      const cursors = [
        "nwse-resize", // 0 NW
        "ns-resize", // 1 N
        "nesw-resize", // 2 NE
        "ew-resize", // 3 E
        "nwse-resize", // 4 SE
        "ns-resize", // 5 S
        "nesw-resize", // 6 SW
        "ew-resize", // 7 W
      ];
      return cursors[hit.index] ?? "default";
    }
    case "ruler-end":
    case "ruler-width":
      return "crosshair";
  }
}

/** Apply a DATA-space drag delta (dx, dy) to a rect per its hit kind:
 *  "inside" translates both bounds; "edge"/"handle" move only the bound(s)
 *  that hit implies (via `HANDLE_EDGES`). Always renormalizes afterward —
 *  dragging the left edge past the right edge crosses over into a valid,
 *  positive-width rect (swapped roles), never a negative-width one — then
 *  clamps to a minimum size, expanded from centre so no single edge is
 *  favoured. A ruler-only hit (ruler-end/ruler-width) is a no-op (wrong
 *  shape for this rect). */
export function applyRoiDrag(
  rect: RoiRect,
  hit: RoiHit,
  dx: number,
  dy: number,
  minW: number,
  minH: number,
): RoiRect {
  if (!hit) return rect;
  let patch: { x0: number; x1: number; y0: number; y1: number };
  if (hit.kind === "inside") {
    patch = { x0: rect.x0 + dx, x1: rect.x1 + dx, y0: rect.y0 + dy, y1: rect.y1 + dy };
  } else if (hit.kind === "edge") {
    patch = moveEdges(rect, [hit.edge], dx, dy);
  } else if (hit.kind === "handle") {
    patch = moveEdges(rect, HANDLE_EDGES[hit.index] ?? [], dx, dy);
  } else {
    return rect; // ruler-end / ruler-width — not this shape
  }
  return clampRectSize(normalizeRect({ ...rect, ...patch }), minW, minH);
}

function moveEdges(
  rect: RoiRect,
  edges: readonly RoiEdge[],
  dx: number,
  dy: number,
): { x0: number; x1: number; y0: number; y1: number } {
  let { x0, x1, y0, y1 } = rect;
  for (const e of edges) {
    if (e === "n") y1 += dy;
    else if (e === "s") y0 += dy;
    else if (e === "e") x1 += dx;
    else x0 += dx; // "w"
  }
  return { x0, x1, y0, y1 };
}

export type NudgeDir = "up" | "down" | "left" | "right";

/** Keyboard-nudge a rect by `step` DATA units — "up"/"right" are positive
 *  (north = larger data y, matching `roiCursor`/`classifyRoiHit`'s n/s
 *  convention). Pure translate, no renormalize needed (order is preserved). */
export function nudgeRoi(rect: RoiRect, dir: NudgeDir, step: number): RoiRect {
  const dx = dir === "left" ? -step : dir === "right" ? step : 0;
  const dy = dir === "down" ? -step : dir === "up" ? step : 0;
  return { ...rect, x0: rect.x0 + dx, x1: rect.x1 + dx, y0: rect.y0 + dy, y1: rect.y1 + dy };
}

// ── Cut ruler: corners, hit-test, drag ──────────────────────────────────

/** The ruler's 4 corners in DATA space, fixed order [A+width, A-width,
 *  B-width, B+width] where A = centre + (length/2) along angle (the "end 0"
 *  side) and B = centre - (length/2) along angle ("end 1"). This order is
 *  load-bearing: `classifyRulerHit` derives its 4 handle positions purely
 *  from consecutive-corner midpoints (no separate angle/trig needed there),
 *  which only lines up correctly with THIS order — midpoint(c0,c1)="end 0",
 *  midpoint(c2,c3)="end 1", midpoint(c1,c2)="width 0", midpoint(c3,c0)=
 *  "width 1". Shared by draw (project each corner to px) and hit-test (same
 *  projection) so they can never disagree, mirroring how `mapRender.ts`'s
 *  `plotRect` is shared by `hitTest`/`dataToPx`. */
export function rulerCorners(ruler: RoiRuler): { x: number; y: number }[] {
  const rad = (ruler.angle * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad); // along length
  const vx = -Math.sin(rad);
  const vy = Math.cos(rad); // across width
  const hl = ruler.length / 2;
  const hw = ruler.width / 2;
  const endA = { x: ruler.cx + hl * ux, y: ruler.cy + hl * uy };
  const endB = { x: ruler.cx - hl * ux, y: ruler.cy - hl * uy };
  return [
    { x: endA.x + hw * vx, y: endA.y + hw * vy }, // c0
    { x: endA.x - hw * vx, y: endA.y - hw * vy }, // c1
    { x: endB.x - hw * vx, y: endB.y - hw * vy }, // c2
    { x: endB.x + hw * vx, y: endB.y + hw * vy }, // c3
  ];
}

/** Point-in-convex-quad via consistent cross-product sign (works for any
 *  convex, consistently-wound polygon — `rulerCorners`' output always is
 *  one, even after an affine px projection turns the rotation into a
 *  parallelogram). Outside the strict polygon, still counts as "in" within
 *  `tol` of the NEAREST of its 4 edges — a thin/rotated ruler needs a
 *  forgiving translate target, same idea as `shapeHit.ts`'s edge tolerance. */
function pointInConvexQuad(
  corners: readonly { x: number; y: number }[],
  p: { x: number; y: number },
  tol: number,
): boolean {
  let sign = 0;
  let consistent = true;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) {
      consistent = false;
      break;
    }
  }
  if (consistent) return true;
  let best = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    best = Math.min(best, pointToSegmentDistance(p, a.x, a.y, b.x, b.y));
  }
  return best <= tol;
}

/** Hit-test against a ruler's PX-space corners (`rulerCorners` projected by
 *  the caller — see that function's doc). Precedence: the 4 named handles
 *  (end 0/1, width 0/1 — derived as consecutive-corner midpoints, see
 *  `rulerCorners`) beat the interior; there is no separate "edge" hit (a
 *  ruler's body only translates, Resolved decisions rev 2). */
export function classifyRulerHit(
  cornersPx: readonly { x: number; y: number }[],
  p: { x: number; y: number },
  tolHandle = 7,
  tolEdge = 6,
): RoiHit {
  const [c0, c1, c2, c3] = cornersPx;
  if (!c0 || !c1 || !c2 || !c3) return null;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const handles: { pt: { x: number; y: number }; hit: RoiHit }[] = [
    { pt: mid(c0, c1), hit: { kind: "ruler-end", index: 0 } },
    { pt: mid(c2, c3), hit: { kind: "ruler-end", index: 1 } },
    { pt: mid(c1, c2), hit: { kind: "ruler-width", index: 0 } },
    { pt: mid(c3, c0), hit: { kind: "ruler-width", index: 1 } },
  ];
  let best: RoiHit = null;
  let bestDist = tolHandle;
  for (const h of handles) {
    const d = Math.hypot(h.pt.x - p.x, h.pt.y - p.y);
    if (d <= bestDist) {
      bestDist = d;
      best = h.hit;
    }
  }
  if (best) return best;
  if (pointInConvexQuad(cornersPx, p, tolEdge)) return { kind: "inside" };
  return null;
}

/** Apply a DATA-space drag delta to a ruler. "inside" translates the centre.
 *  "ruler-end" drags one endpoint with the OTHER end anchored exactly in
 *  place (recomputes centre/angle/length from anchor + the moved point,
 *  clamped to `minLength`) — the direct length+angle control the endpoint
 *  handles are for (Resolved decisions rev 2). "ruler-width" projects the
 *  delta onto the perpendicular axis and grows/shrinks the width
 *  symmetrically about the centreline, clamped to `minWidth`. A
 *  rect-only hit (edge/handle) is a no-op. */
export function applyRulerDrag(
  ruler: RoiRuler,
  hit: RoiHit,
  dx: number,
  dy: number,
  minLength: number,
  minWidth: number,
): RoiRuler {
  if (!hit) return ruler;
  if (hit.kind === "inside") {
    return { ...ruler, cx: ruler.cx + dx, cy: ruler.cy + dy };
  }
  if (hit.kind === "ruler-end") {
    const rad0 = (ruler.angle * Math.PI) / 180;
    const hl = ruler.length / 2;
    const u0 = { x: Math.cos(rad0), y: Math.sin(rad0) };
    const endA = { x: ruler.cx + hl * u0.x, y: ruler.cy + hl * u0.y };
    const endB = { x: ruler.cx - hl * u0.x, y: ruler.cy - hl * u0.y };
    const fixed = hit.index === 0 ? endB : endA;
    const movedRaw =
      hit.index === 0 ? { x: endA.x + dx, y: endA.y + dy } : { x: endB.x + dx, y: endB.y + dy };
    // "toward" always points from the anchor TOWARD wherever end A ends up
    // (index 1's drag is on end B, so it's reversed) — this is the new u.
    const toward =
      hit.index === 0
        ? { x: movedRaw.x - fixed.x, y: movedRaw.y - fixed.y }
        : { x: fixed.x - movedRaw.x, y: fixed.y - movedRaw.y };
    const rawLen = Math.hypot(toward.x, toward.y);
    const newLength = Math.max(minLength, rawLen);
    const angleRad = rawLen > 0 ? Math.atan2(toward.y, toward.x) : rad0;
    const u = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const newEndA =
      hit.index === 0 ? { x: fixed.x + newLength * u.x, y: fixed.y + newLength * u.y } : fixed;
    const newEndB =
      hit.index === 0 ? fixed : { x: fixed.x - newLength * u.x, y: fixed.y - newLength * u.y };
    return {
      ...ruler,
      cx: (newEndA.x + newEndB.x) / 2,
      cy: (newEndA.y + newEndB.y) / 2,
      angle: (angleRad * 180) / Math.PI,
      length: newLength,
    };
  }
  if (hit.kind === "ruler-width") {
    const rad = (ruler.angle * Math.PI) / 180;
    const v = { x: -Math.sin(rad), y: Math.cos(rad) };
    const proj = dx * v.x + dy * v.y; // signed delta along the perpendicular
    // width0 = mid(c1,c2) sits on the "-v" side (rulerCorners builds c1/c2
    // as endA/endB MINUS hw*v), width1 = mid(c3,c0) on the "+v" side — so
    // dragging index 0 further in -v (proj negative) must GROW the width,
    // the mirror of index 1 growing on a positive proj.
    const sign = hit.index === 0 ? -1 : 1;
    return { ...ruler, width: Math.max(minWidth, ruler.width + 2 * sign * proj) };
  }
  return ruler; // rect-only hits (edge/handle) — not this shape
}

// ── Backend request shapers ──────────────────────────────────────────────

export interface BoxCutOptions {
  collapse?: "x" | "y";
  reduce?: "sum" | "mean" | "max";
  nBins?: number;
  wrap?: "x" | "y" | null;
}

/** Shape a `POST /api/rsm/box` body from a drawn/typed box ROI (item 3's
 *  `calc.boxcut.box_cut`). `collapse`/`reduce` default to the backend's own
 *  defaults ("x"/"sum") so a caller only needs to override what it changes. */
export function roiBoxBody(
  dataset: DataStruct,
  rect: RoiRect,
  opts: BoxCutOptions = {},
): Record<string, unknown> {
  return {
    dataset,
    x_min: rect.x0,
    x_max: rect.x1,
    y_min: rect.y0,
    y_max: rect.y1,
    space: rect.space,
    collapse: opts.collapse ?? "x",
    reduce: opts.reduce ?? "sum",
    ...(opts.nBins != null ? { n_bins: opts.nBins } : {}),
    ...(opts.wrap ? { wrap: opts.wrap } : {}),
  };
}

/** Shape a `POST /api/rsm/box` body from a cut RULER — Resolved decisions
 *  rev 2: "Backend: box_cut/box_stats gain optional angle (rotate
 *  coordinates about the ROI centre, then the EXISTING cloud mask+bin path
 *  applies verbatim)". The ruler's own length/width become the box bounds
 *  IN THE ROTATED FRAME (centred on cx/cy), and `angle` tells the backend
 *  which frame that is — never a silent Cartesian box at the ruler's
 *  unrotated bounding box. */
export function rulerBoxBody(
  dataset: DataStruct,
  ruler: RoiRuler,
  opts: Omit<BoxCutOptions, "wrap"> = {},
): Record<string, unknown> {
  const hl = ruler.length / 2;
  const hw = ruler.width / 2;
  return {
    dataset,
    x_min: ruler.cx - hl,
    x_max: ruler.cx + hl,
    y_min: ruler.cy - hw,
    y_max: ruler.cy + hw,
    space: ruler.space,
    angle: ruler.angle,
    collapse: opts.collapse ?? "x",
    reduce: opts.reduce ?? "sum",
    ...(opts.nBins != null ? { n_bins: opts.nBins } : {}),
  };
}

/** Shape a `POST /api/rsm/box-stats` body from an already-resolved box ROI
 *  (item 3's `calc.boxcut.box_stats` — a scalar dict, not a DataStruct, so
 *  no collapse/reduce/n_bins here). A ruler-based Stats commit resolves its
 *  bounds the SAME way `rulerBoxBody` does (cx∓length/2, cy∓width/2) and
 *  passes `angle` here — that conversion isn't repeated as a 4th shaper
 *  since box-stats' bounds shape is identical to box_cut's. */
export function roiStatsBody(
  dataset: DataStruct,
  rect: RoiRect,
  opts: { angle?: number; wrap?: "x" | "y" | null } = {},
): Record<string, unknown> {
  return {
    dataset,
    x_min: rect.x0,
    x_max: rect.x1,
    y_min: rect.y0,
    y_max: rect.y1,
    space: rect.space,
    ...(opts.angle ? { angle: opts.angle } : {}),
    ...(opts.wrap ? { wrap: opts.wrap } : {}),
  };
}

/** Centre/half-width -> canonical phi_min/phi_max, WITHOUT wrapping into
 *  [-180, 180] — the backend's `wrap_mask` rebase (calc/_rsm_grid.py, item
 *  1) is the ONE place that convention lives; a sector centred at 170° with
 *  a 20° half-width becomes [150, 190], not [150, -170]. Wrapping here
 *  would double-apply (or fight) the backend's own rebase. */
export function sectorFromCenter(center: number, halfWidth: number): { phiMin: number; phiMax: number } {
  return { phiMin: center - halfWidth, phiMax: center + halfWidth };
}

/** Sector-card default bin count from the map's own resolution (item 1's
 *  `sector_profile`/`chi_profile` default when nothing finer is known is
 *  100/90; once a real `map_shape` is available this scales with it, same
 *  spirit as `box_cut`'s `n_bins=200` grid default). `mapShape` is
 *  `dataset.metadata.map_shape` verbatim (row/col order doesn't matter —
 *  only the larger dimension is used). */
export function defaultSectorBins(mapShape: readonly number[] | null | undefined): number {
  if (!mapShape || mapShape.length === 0) return 100;
  const max = Math.max(...mapShape);
  return Math.min(200, Math.max(20, Math.round(max / 2)));
}

/** Branch-(ii) pole-figure detection (Resolved decisions, polar-space rule):
 *  an axis is the NATIVE azimuthal axis when its label is Phi/Psi/Chi
 *  (case-insensitive) AND it spans >=350 degrees end to end — the
 *  xrayutilities pole-figure convention (a near-full-circle phi sweep
 *  against a tilt psi/chi range). Takes each displayed axis's label + its
 *  numeric extent (the caller already has `xAxis[0]`/`xAxis[last]` etc. from
 *  the map payload — kept out of this pure module's own inputs so it stays
 *  free of any `lib/mapdata.ts` coupling). Returns which axis qualifies, or
 *  null when neither (or, deliberately, when BOTH do — an ambiguous map is
 *  never auto-routed, "never silent"). */
export function polefigAxes(
  x: { label: string; span: number },
  y: { label: string; span: number },
): "x" | "y" | null {
  const isPolar = (label: string, span: number) => /^(phi|psi|chi)$/i.test(label.trim()) && span >= 350;
  const xHit = isPolar(x.label, x.span);
  const yHit = isPolar(y.label, y.span);
  if (xHit && !yHit) return "x";
  if (yHit && !xHit) return "y";
  return null;
}

/** Build a default radial/transverse ruler anchored on an `rsm_analyze` peak
 *  (Resolved decisions rev 2): angle = atan2(qz, qx) for "radial" (along the
 *  scattering vector), +90 deg for "transverse" (across it); length defaults
 *  to +-15% of |Q| about the peak (30% total span); width defaults to 3 grid
 *  cells (`gridCell` — the caller's map resolution; a bare peak carries no
 *  grid spacing of its own). Null when the peak has no Q-space centre
 *  (angle/radius are undefined without Qx/Qz) — the caller (item 7's
 *  peak-anchored action) is expected to only offer this when `rsmPeaks` are
 *  Q-capable in the first place. */
export function radialRulerForPeak(
  peak: RsmPeak,
  kind: "radial" | "transverse",
  gridCell = 1,
): RoiRuler | null {
  const [qx, qz] = peak.centre_Q;
  if (qx == null || qz == null || !Number.isFinite(qx) || !Number.isFinite(qz)) return null;
  const qMag = Math.hypot(qx, qz);
  const baseDeg = (Math.atan2(qz, qx) * 180) / Math.PI;
  return {
    space: "q",
    cx: qx,
    cy: qz,
    angle: kind === "transverse" ? baseDeg + 90 : baseDeg,
    length: 0.3 * qMag,
    width: 3 * gridCell,
  };
}
