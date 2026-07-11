// Pure virtualization math for the worksheet grid (WORKSHEET_PLAN item 1 / key
// decision 1): given a scroll offset, viewport size, item count, and a FIXED
// item size, compute which index range should render (plus overscan) and the
// leading/trailing spacer sizes that keep the rest of the axis's scrollable
// space accounted for. No DOM here — GridViewport measures the real container
// and scroll position and feeds the numbers in, so this is unit-tested
// standalone. The same function drives BOTH axes: rows use it against the
// display row count + a CSS-token row height; columns use it against the
// channel count + a uniform column width (key decision 1: fixed row height +
// uniform column width in v1, so windowing is pure arithmetic, no per-item
// measurement).
//
// The "double spacer" layout this feeds (a leading spacer, the visible items
// in normal document flow, a trailing spacer) needs no absolute positioning:
// leading + visible + trailing always sums to itemCount * itemSize, so the
// scroll container's native content height/width is correct regardless of
// where the window currently sits.

export interface AxisWindowConfig {
  /** Fixed pixel size of one item on this axis (a row's height or a column's
   *  uniform width). Values <= 0 are treated as 1px (defensive; avoids a
   *  divide-by-zero turning the whole window degenerate). */
  itemSize: number;
  /** Extra items rendered beyond each visible edge, so a fast scroll doesn't
   *  flash empty space before the next render catches up. Default 0. */
  overscan?: number;
  /** Rendered item count when the viewport measures degenerate (<=0) — jsdom
   *  (and a container not yet laid out/measured) reports a 0-size viewport,
   *  so without this every test would render zero rows (key decision 2).
   *  Real browsers never take this path once mounted and measured. Defaults
   *  to the full item count (render everything). */
  fallbackCount?: number;
}

export interface AxisWindow {
  /** First rendered index (inclusive). */
  start: number;
  /** Last rendered index (exclusive). */
  end: number;
  /** Pixel size of the leading spacer — `start * itemSize` — so the first
   *  rendered item lands at its true position in normal document flow. */
  offset: number;
  /** Full scrollable extent of the axis (itemCount * itemSize); leading
   *  spacer + rendered items + trailing spacer always sum to this. */
  totalSize: number;
}

/** The visible-plus-overscan index range for one axis. `scrollOffset` and
 *  `viewportSize` are CSS pixels (scrollTop/clientHeight or
 *  scrollLeft/clientWidth); `itemCount` is the row or column count. Boundary
 *  behaviour: `start`/`end` are always clamped to `[0, itemCount]`, so a
 *  scroll offset past the end (or a resize mid-scroll) never asks a caller to
 *  render an out-of-range index. */
export function computeAxisWindow(
  scrollOffset: number,
  viewportSize: number,
  itemCount: number,
  cfg: AxisWindowConfig,
): AxisWindow {
  const itemSize = cfg.itemSize > 0 ? cfg.itemSize : 1;
  const totalSize = itemCount * itemSize;
  if (itemCount <= 0) return { start: 0, end: 0, offset: 0, totalSize: 0 };

  // Degenerate viewport (unmeasured / jsdom): render a fixed-size window from
  // the top instead of nothing — scroll position is meaningless without a
  // real size to scroll within, and jsdom always measures 0.
  if (viewportSize <= 0) {
    const end = Math.min(itemCount, Math.max(0, cfg.fallbackCount ?? itemCount));
    return { start: 0, end, offset: 0, totalSize };
  }

  const overscan = Math.max(0, Math.floor(cfg.overscan ?? 0));
  const visibleCount = Math.ceil(viewportSize / itemSize);
  const rawStart = Math.floor(Math.max(0, scrollOffset) / itemSize) - overscan;
  const start = Math.min(Math.max(0, rawStart), Math.max(0, itemCount - 1));
  // +1 covers a partially-visible trailing item so a sub-pixel scroll never
  // exposes a gap before the next render.
  const end = Math.min(itemCount, start + visibleCount + overscan * 2 + 1);
  return { start, end, offset: start * itemSize, totalSize };
}

/** `[start, end)` as a plain index array — the row/column indices a caller
 *  should actually render for one axis window. */
export function windowIndices(w: Pick<AxisWindow, "start" | "end">): number[] {
  const out: number[] = [];
  for (let i = w.start; i < w.end; i++) out.push(i);
  return out;
}

// ── Variable per-item sizes (MAIN_PLAN #3: per-column widths) ────────────────
//
// The uniform-size path above stays the fast path (windowing is one divide);
// resized columns switch the COLUMN axis to a prefix-sum offsets array with
// binary-search hit-testing. Rows never take this path (fixed height always).

/** Prefix-sum offsets for `itemCount` items of per-item size `sizeOf(i)`:
 *  `offsets[i]` is the pixel position where item i starts, `offsets[itemCount]`
 *  is the total axis size. Sizes <= 0 are treated as 1px (same defensive rule
 *  as the uniform path's itemSize). */
export function buildOffsets(itemCount: number, sizeOf: (index: number) => number): number[] {
  const offsets = new Array<number>(Math.max(0, itemCount) + 1);
  offsets[0] = 0;
  for (let i = 0; i < itemCount; i++) {
    const size = sizeOf(i);
    offsets[i + 1] = offsets[i] + (size > 0 ? size : 1);
  }
  return offsets;
}

/** Largest index i (0..itemCount-1) with `offsets[i] <= pos` — the item under
 *  pixel position `pos`. Binary search over the prefix sums; positions past
 *  the end clamp to the last item. */
export function offsetIndexAt(offsets: number[], pos: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  if (pos <= 0) return 0;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** `computeAxisWindow`'s variable-size sibling: the visible-plus-overscan
 *  index range for one axis whose items have per-item sizes described by a
 *  prefix-sum `offsets` array (from `buildOffsets`). Same contract — clamped
 *  `[start, end)`, a leading `offset`, the full `totalSize`, and the same
 *  degenerate-viewport fallback (key decision 2). */
export function computeAxisWindowOffsets(
  scrollOffset: number,
  viewportSize: number,
  offsets: number[],
  cfg: Pick<AxisWindowConfig, "overscan" | "fallbackCount">,
): AxisWindow {
  const itemCount = offsets.length - 1;
  const totalSize = itemCount > 0 ? offsets[itemCount] : 0;
  if (itemCount <= 0) return { start: 0, end: 0, offset: 0, totalSize: 0 };

  if (viewportSize <= 0) {
    const end = Math.min(itemCount, Math.max(0, cfg.fallbackCount ?? itemCount));
    return { start: 0, end, offset: 0, totalSize };
  }

  const overscan = Math.max(0, Math.floor(cfg.overscan ?? 0));
  const scroll = Math.max(0, scrollOffset);
  const firstVisible = offsetIndexAt(offsets, scroll);
  // Last index whose START is before the viewport's far edge (covers a
  // partially-visible trailing item, mirroring the uniform path's +1).
  const lastVisible = offsetIndexAt(offsets, scroll + viewportSize);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(itemCount, lastVisible + overscan + 1);
  return { start, end, offset: offsets[start], totalSize };
}

// ── Column width bounds + autofit (MAIN_PLAN #3 drag resize) ─────────────────

export const MIN_COL_WIDTH = 56;
export const MAX_COL_WIDTH = 640;

/** Clamp a dragged/derived column width into the sane range. */
export function clampColWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COL_WIDTH;
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(width)));
}

// The grid renders in the mono font (`--font-mono` on .qzk-grid) at the small
// size, so width estimation is a character count times a fixed advance plus
// the cell's horizontal padding/border (3px 10px padding + 1px borders).
const AUTOFIT_CHAR_PX = 7.5;
const AUTOFIT_PAD_PX = 26;

/** Estimated pixel width that fits the widest of `samples` (double-click
 *  autofit): monospace character-count estimate, clamped to the same bounds a
 *  drag resize gets. Empty samples fall back to the default width. */
export function autofitColWidth(samples: readonly string[]): number {
  let chars = 0;
  for (const s of samples) if (s.length > chars) chars = s.length;
  if (chars === 0) return DEFAULT_COL_WIDTH;
  return clampColWidth(chars * AUTOFIT_CHAR_PX + AUTOFIT_PAD_PX);
}

// Fallback metrics for degenerate (jsdom / pre-measurement) viewports and the
// pure-math defaults GridViewport falls back to before it has measured the
// real `--row-h` CSS token. Generous enough that every existing test dataset
// (a handful of rows/columns) renders in full, matching key decision 2.
export const DEFAULT_ROW_HEIGHT = 24;
export const DEFAULT_COL_WIDTH = 120;
export const DEFAULT_GUTTER_WIDTH = 44;
export const DEFAULT_ROW_OVERSCAN = 6;
export const DEFAULT_COL_OVERSCAN = 2;
export const DEFAULT_FALLBACK_ROWS = 300;
export const DEFAULT_FALLBACK_COLS = 60;
