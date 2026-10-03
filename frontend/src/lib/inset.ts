// Pure helpers for the magnifier inset: the default x sub-range it opens on,
// its default placement, its export wire, and which connector lines join the
// source outline to it. The screen (`Stage/InsetPlot.tsx`) and the vector
// export (`calc/figure_inset.py`) draw the same inset from the same view state
// (`PlotView.inset`), so a rule both sides apply lives in one shared table
// (`tests/fixtures/wire/inset_connectors.json`). Imported only by lazy code.

import type { FigureOverrides } from "./figureOverrides";
import type { InsetView } from "./plotview";

/** The centred sub-range covering `fraction` of [min, max] (0<fraction<=1).
 *  Used to seed the inset with a magnified view; returns [min, max] for a
 *  degenerate span or a fraction >= 1. The export seeds the same range when a
 *  view has never drawn its inset (`calc/figure_inset.py`). */
export function centralRange(min: number, max: number, fraction = 0.3): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min, max];
  const f = Math.min(Math.max(fraction, 0), 1);
  if (f >= 1) return [min, max];
  const mid = (min + max) / 2;
  const half = ((max - min) * f) / 2;
  return [mid - half, mid + half];
}

/** Where a new inset's plot area sits: the lower right of the main frame, as
 *  [left, top, width, height] frame fractions (top-origin). */
export const DEFAULT_INSET_AT: InsetView["at"] = [0.58, 0.48, 0.36, 0.34];

/** A saved placement clamped into the frame (the eager `.dwk` sanitizer only
 *  checks it is finite with a positive size): each side in [0, 1], at least
 *  5% wide and tall. The screen and the export both place by this. */
export function clampAt(at: InsetView["at"] | null | undefined): InsetView["at"] {
  if (!at) return [...DEFAULT_INSET_AT];
  const [l, t, w, h] = at.map((n) => Math.min(1, Math.max(0, n)));
  return [l, t, Math.max(0.05, w), Math.max(0.05, h)]; // the export rejects a zero size
}

/** The export request's `inset` for a shown inset. A view that never drew
 *  its inset sends only the placement, and the export seeds the x range the
 *  screen would (`centralRange` of the data) with an auto y. */
export function insetWire(inset: InsetView | null): NonNullable<FigureOverrides["inset"]> {
  const at = clampAt(inset?.at);
  if (!inset || !ascending(inset.x)) return { at, lines: inset?.lines ?? true };
  return { x: [...inset.x], ...(ascending(inset.y) ? { y: [...inset.y] } : {}), at, lines: inset.lines };
}

/** A finite [lo, hi] pair with lo < hi. */
export function ascending(r: readonly number[] | null | undefined): r is [number, number] {
  return !!r && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] < r[1];
}

/** A rectangle in y-UP fractions of the main frame: [x0, y0, x1, y1], x0 < x1, y0 < y1. */
export type UpRect = [number, number, number, number];

/** The corners a connector joins (the same corner on the source outline and
 *  on the inset): "ll" lower-left, "ul" upper-left, "lr", "ur". */
export type InsetCorner = "ll" | "ul" | "lr" | "ur";

/** Which of the four corner-to-corner connectors to draw between the source
 *  region `s` and the inset `i` — matplotlib's own `indicate_inset_zoom`
 *  choice (two lines that do not cross either box), so the rule is the same
 *  on screen and in the export. */
export function insetConnectors(s: UpRect, i: UpRect): InsetCorner[] {
  const x0 = s[0] < i[0];
  const x1 = s[2] < i[2];
  const y0 = s[1] < i[1];
  const y1 = s[3] < i[3];
  const out: InsetCorner[] = [];
  if (x0 !== y0) out.push("ll");
  if (x0 === y1) out.push("ul");
  if (x1 === y0) out.push("lr");
  if (x1 !== y1) out.push("ur");
  return out;
}

/** A corner's point on an up-rect. */
export function cornerOf(r: UpRect, c: InsetCorner): [number, number] {
  return [c[1] === "l" ? r[0] : r[2], c[0] === "l" ? r[1] : r[3]];
}

/** A CSS-pixel rect relative to the stage the inset is positioned in. */
export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The inset's own chrome around its plot area (header + padding + axis
 *  gutters), in CSS px — measured off its uPlot once drawn. */
export interface Gutters {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Where the inset's box goes so that its PLOT AREA lands on `at` (main-frame
 *  fractions, top-origin) — the rect the export's inset axes occupies. */
export function insetBoxRect(frame: PxRect, at: InsetView["at"], g: Gutters): PxRect {
  const [l, t, w, h] = at;
  return {
    left: frame.left + l * frame.width - g.l,
    top: frame.top + t * frame.height - g.t,
    width: w * frame.width + g.l + g.r,
    height: h * frame.height + g.t + g.b,
  };
}

/** The source outline (`rect`, stage px, unclipped) and the connector
 *  segments to the inset's plot area, for a source region whose corners sit
 *  at px `[x0, y0, x1, y1]` (any order) over `frame`. A connector's source end
 *  clamps to the frame, as the export's does (`calc/figure_inset.py`). */
export function insetIndicator(
  frame: PxRect,
  src: [number, number, number, number],
  at: InsetView["at"],
  lines: boolean,
): { rect: PxRect; segments: [number, number, number, number][] } {
  const [x0, x1] = [Math.min(src[0], src[2]), Math.max(src[0], src[2])];
  const [y0, y1] = [Math.min(src[1], src[3]), Math.max(src[1], src[3])];
  const rect = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
  if (!lines || !(frame.width > 0 && frame.height > 0)) return { rect, segments: [] };
  const c01 = (v: number) => Math.min(1, Math.max(0, v));
  const fx = (px: number) => c01((px - frame.left) / frame.width);
  const fy = (py: number) => c01(1 - (py - frame.top) / frame.height); // y-UP
  const s: UpRect = [fx(x0), fy(y1), fx(x1), fy(y0)];
  const [l, t, w, h] = at;
  const box: UpRect = [l, 1 - t - h, l + w, 1 - t];
  const toPx = ([x, y]: [number, number]): [number, number] => [
    frame.left + x * frame.width,
    frame.top + (1 - y) * frame.height,
  ];
  const segments = insetConnectors(s, box).map((c) => {
    const [a, b] = [toPx(cornerOf(s, c)), toPx(cornerOf(box, c))];
    return [a[0], a[1], b[0], b[1]] as [number, number, number, number];
  });
  return { rect, segments };
}

/** `at` moved by (dx, dy) px of `frame`, kept inside the frame. */
export function movedAt(at: InsetView["at"], frame: PxRect, dx: number, dy: number): InsetView["at"] {
  const [l, t, w, h] = at;
  const c = (v: number, hi: number) => Math.min(Math.max(v, 0), Math.max(0, hi));
  return [c(l + dx / frame.width, 1 - w), c(t + dy / frame.height, 1 - h), w, h];
}

/** `at` resized by (dx, dy) px from its lower-right corner: at least a tenth
 *  of the frame each way, never past the frame's edge. */
export function resizedAt(at: InsetView["at"], frame: PxRect, dx: number, dy: number): InsetView["at"] {
  const [l, t, w, h] = at;
  const c = (v: number, hi: number) => Math.min(Math.max(v, 0.1), Math.max(0.1, hi));
  return [l, t, c(w + dx / frame.width, 1 - l), c(h + dy / frame.height, 1 - t)];
}
