// Pure geometry for the window-layout host (WORKSPACE_LAYOUT_PLAN P1): edge
// region sizes, the centre grid shape, splitter share math, and the layout's
// reading order (the F6 focus order). No React, no store; the host and its
// splitters call these, and layoutGeometry.test.ts pins them.

import { placementEntries, stackOf } from "../../../lib/windowLayout/ops";
import type { Slot, WindowLayoutV1, WindowRef } from "../../../lib/windowLayout/types";

export type Edge = "left" | "right" | "bottom";

/** An edge's size before the user drags its splitter (the mockup's sizes). */
export const DEFAULT_EDGE: Readonly<Record<Edge, number>> = { left: 320, right: 380, bottom: 240 };
/** The smallest edge region and the smallest docked window along a stack. */
export const MIN_EDGE = 160;
export const MIN_SHARE_PX = 80;
/** Keyboard step of a splitter (Shift = 1 px), the plan's move-mode step. */
export const SPLIT_STEP = 16;

/** An edge's rendered size: its saved px (0 = default), clamped so the centre
 *  keeps at least 40% of the desk along that axis. `reserved` is the px the
 *  opposite edge already takes (left and right share one 60% budget). */
export function edgeSize(layout: WindowLayoutV1, edge: Edge, desk: { width: number; height: number } | null, reserved = 0): number {
  const saved = layout.edges[edge] > 0 ? layout.edges[edge] : DEFAULT_EDGE[edge];
  const span = desk ? (edge === "bottom" ? desk.height : desk.width) : 0;
  const max = span > 0 ? Math.max(MIN_EDGE, Math.floor(span * 0.6) - reserved) : Number.POSITIVE_INFINITY;
  return Math.round(Math.min(max, Math.max(MIN_EDGE, saved)));
}

/** A new layout with `edge` sized to `px` (clamped to the minimum). */
export function withEdge(layout: WindowLayoutV1, edge: Edge, px: number): WindowLayoutV1 {
  const next = Math.round(Math.max(MIN_EDGE, px));
  if (layout.edges[edge] === next) return layout;
  return { ...layout, edges: { ...layout.edges, [edge]: next } };
}

/** Columns of the centre grid ("Tile all"): side by side up to three, then
 *  two columns (the mockup's rule). */
export function gridColumns(n: number): number {
  return n <= 3 ? Math.max(1, n) : 2;
}

/** Move the boundary between two neighbouring windows `a` and `b` of one
 *  slot by `deltaPx` along a stack `lengthPx` long. Each keeps at least
 *  MIN_SHARE_PX; the pair's total share is unchanged, so the slot still sums
 *  to 1. Named by ref, not index: the region may hide a minimized window. */
export function resizeShares(layout: WindowLayoutV1, slot: Slot, a: WindowRef, b: WindowRef, deltaPx: number, lengthPx: number): WindowLayoutV1 {
  const stack = stackOf(layout, slot);
  if (!stack.includes(a) || !stack.includes(b) || !(lengthPx > 0) || !Number.isFinite(deltaPx) || deltaPx === 0) return layout;
  const pa = layout.placements[a]!;
  const pb = layout.placements[b]!;
  const pair = pa.share + pb.share;
  const min = Math.min(pair / 2, MIN_SHARE_PX / lengthPx);
  const shareA = Math.min(pair - min, Math.max(min, pa.share + deltaPx / lengthPx));
  if (shareA === pa.share) return layout;
  return {
    ...layout,
    placements: { ...layout.placements, [a]: { ...pa, share: shareA }, [b]: { ...pb, share: pair - shareA } },
  };
}

/** The windows in the plan's focus order: left stack (top to bottom), centre
 *  (left to right), right stack, bottom (left to right), then the floating
 *  ones back to front. `shown` drops windows that are open but not on screen
 *  (a minimized plot window). */
export function readingOrder(layout: WindowLayoutV1, shown: (ref: WindowRef) => boolean = () => true): WindowRef[] {
  const docked = (["left", "centre", "right", "bottom"] as const).flatMap((s) => stackOf(layout, s));
  const open = new Set(placementEntries(layout).filter(([, p]) => p.open).map(([r]) => r));
  return [...docked, ...layout.z.filter((r) => open.has(r))].filter(shown);
}

/** The next window F6 (`step` 1) or Shift+F6 (-1) moves to, wrapping; from
 *  outside every window it starts at the first (or, backwards, the last). */
export function cycleTarget<T extends string>(order: readonly T[], current: T | null, step: 1 | -1): T | null {
  if (!order.length) return null;
  const at = current ? order.indexOf(current) : -1;
  if (at < 0) return step === 1 ? order[0] : order[order.length - 1];
  return order[(at + step + order.length) % order.length];
}
