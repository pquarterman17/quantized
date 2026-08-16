// E-c3: windowed rendering for the Tile workspace grid. Small libraries
// render every tile (the DOM — roles, focus order, tests — is byte-
// identical to the unvirtualized workspace); above VIRTUALIZE_ABOVE the
// grid renders only the scrolled-to row window plus overscan, with grid
// padding standing in for the off-screen rows.
//
// The row-window arithmetic DELEGATES to lib/gridwindow's unit-tested
// `computeAxisWindow` (the worksheet viewport's helper) — its start/end
// clamping is what keeps a stale large scrollTop harmless when the item
// count shrinks under it. This hook owns only measurement and React
// plumbing.
//
// Measurement is best-effort with DETERMINISTIC fallbacks: jsdom reports
// zero geometry, so the fallbacks (viewport/row/columns) are the contract
// under test, and real browsers self-correct from live measurements on
// the first paint + every scroll/resize. UNIFORM-ROW APPROXIMATION: the
// row height is the tallest currently-rendered tile plus the grid gap.
// CSS grid sizes each real row to its own tallest tile, so rows with
// extra summary/warning lines drift the spacer estimate slightly —
// keyboard navigation self-corrects (native focus() scrolls the real
// tile into view), and the drift is bounded by a caption line, not
// cumulative tile content.

import { useCallback, useEffect, useState, type RefObject } from "react";

import { computeAxisWindow } from "../../lib/gridwindow";

export const VIRTUALIZE_ABOVE = 80;
const OVERSCAN_ROWS = 2;
// jsdom / pre-measurement fallbacks (the deterministic test contract).
const FALLBACK_VIEWPORT_H = 600;
const FALLBACK_ROW_H = 200;
const FALLBACK_COLUMNS = 4;
const GRID_GAP = 12; // matches .qzk-tile-grid gap

export interface TileWindow {
  start: number;
  /** Exclusive. */
  end: number;
  padTop: number;
  padBottom: number;
  virtualized: boolean;
  ensureVisible: (index: number) => void;
}

interface Metrics {
  rowH: number;
  columns: number;
  viewportH: number;
  gridTop: number;
}

function measure(scrollEl: HTMLElement | null, gridEl: HTMLElement | null): Metrics {
  const tiles = gridEl ? [...gridEl.querySelectorAll<HTMLElement>("[data-library-tile]")] : [];
  const tallest = tiles.reduce((max, tile) => Math.max(max, tile.offsetHeight), 0);
  const tileW = tiles[0]?.offsetWidth ?? 0;
  const gridW = gridEl?.clientWidth ?? 0;
  return {
    rowH: tallest > 0 ? tallest + GRID_GAP : FALLBACK_ROW_H,
    columns: tileW > 0 && gridW > 0 ? Math.max(1, Math.floor((gridW + GRID_GAP) / (tileW + GRID_GAP))) : FALLBACK_COLUMNS,
    viewportH: scrollEl && scrollEl.clientHeight > 0 ? scrollEl.clientHeight : FALLBACK_VIEWPORT_H,
    gridTop: gridEl?.offsetTop ?? 0,
  };
}

export function useTileVirtualization(
  count: number,
  scrollRef: RefObject<HTMLElement | null>,
  gridRef: RefObject<HTMLElement | null>,
): TileWindow {
  const virtualized = count > VIRTUALIZE_ABOVE;
  const [scrollTop, setScrollTop] = useState(0);
  const [metrics, setMetrics] = useState<Metrics>({
    rowH: FALLBACK_ROW_H,
    columns: FALLBACK_COLUMNS,
    viewportH: FALLBACK_VIEWPORT_H,
    gridTop: 0,
  });

  useEffect(() => {
    if (!virtualized) return;
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const sync = (): void => {
      setScrollTop(scrollEl.scrollTop);
      setMetrics((prev) => {
        const next = measure(scrollEl, gridRef.current);
        return prev.rowH === next.rowH && prev.columns === next.columns
          && prev.viewportH === next.viewportH && prev.gridTop === next.gridTop
          ? prev
          : next;
      });
    };
    sync();
    scrollEl.addEventListener("scroll", sync, { passive: true });
    // ResizeObserver is absent in jsdom — the scroll listener plus the
    // deterministic fallbacks carry the contract there.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    observer?.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener("scroll", sync);
      observer?.disconnect();
    };
  }, [virtualized, scrollRef, gridRef]);

  const ensureVisible = useCallback(
    (index: number): void => {
      if (!virtualized) return;
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const { rowH, columns, viewportH, gridTop } = measure(scrollEl, gridRef.current);
      const row = Math.floor(Math.max(0, index) / columns);
      const rowTop = gridTop + row * rowH;
      const rowBottom = rowTop + rowH;
      let next = scrollEl.scrollTop;
      if (rowTop < next) next = rowTop;
      else if (rowBottom > next + viewportH) next = rowBottom - viewportH;
      if (next !== scrollEl.scrollTop) scrollEl.scrollTop = next;
      // jsdom never fires scroll events on programmatic scrollTop writes —
      // sync the window state directly so the target renders next commit.
      setScrollTop(next);
    },
    [virtualized, scrollRef, gridRef],
  );

  if (!virtualized) {
    return { start: 0, end: count, padTop: 0, padBottom: 0, virtualized, ensureVisible };
  }

  const { rowH, columns, viewportH, gridTop } = metrics;
  const totalRows = Math.ceil(count / columns);
  // lib/gridwindow's clamped axis math over ROWS; viewportH is always > 0
  // here (measured or the deterministic fallback), so scroll position stays
  // meaningful in jsdom too.
  const rows = computeAxisWindow(Math.max(0, scrollTop - gridTop), viewportH, totalRows, {
    itemSize: rowH,
    overscan: OVERSCAN_ROWS,
  });
  return {
    start: rows.start * columns,
    end: Math.min(count, rows.end * columns),
    padTop: rows.offset,
    padBottom: Math.max(0, (totalRows - rows.end) * rowH),
    virtualized,
    ensureVisible,
  };
}

/** Focus a tile that may not be rendered yet (ensureVisible just moved the
 *  window): retry across a few animation frames, exactly like close()'s
 *  restoreFocus. Stands down the moment focus belongs to anything OTHER
 *  than a tile or <body> — a user who clicked into an input mid-retry
 *  must never have focus yanked back to the grid. */
export function focusTileWhenRendered(key: string): void {
  let attempts = 0;
  const tryFocus = (): void => {
    const active = document.activeElement;
    const focusIsElsewhere =
      active instanceof HTMLElement && active !== document.body && !active.hasAttribute("data-library-tile");
    if (focusIsElsewhere) return;
    const tile = document.querySelector(`[data-library-tile="${CSS.escape(key)}"]`) as HTMLElement | null;
    if (tile) tile.focus();
    else if (++attempts < 8) requestAnimationFrame(tryFocus);
  };
  tryFocus();
}
