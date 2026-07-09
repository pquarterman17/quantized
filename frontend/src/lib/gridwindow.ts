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
