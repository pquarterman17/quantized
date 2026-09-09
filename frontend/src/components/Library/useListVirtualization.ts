// LIBRARY_WORKBOOK_UX_PLAN "Required large-Library engineering safeguards":
// windowed rendering for the Tree and Details FLAT row lists. Tiles' sibling
// hook (useTileVirtualization.ts) is the grid analogue; this is the ONE-
// COLUMN case — no column-width math, only a row height — shared by
// LibraryTree.tsx and LibraryDetails.tsx so the two don't invent separate
// windowing mechanisms. Small lists render every row unchanged (DOM/roles/
// focus order byte-identical to the unvirtualized renderer); above
// VIRTUALIZE_ABOVE the list renders only the scrolled-to row window plus
// overscan, with leading/trailing spacer padding standing in for the
// off-screen rows.
//
// Row-window arithmetic delegates to lib/gridwindow's unit-tested
// `computeAxisWindow`, exactly like the tile hook. Measurement is best-effort
// with DETERMINISTIC fallbacks — jsdom reports zero geometry, so the
// fallbacks are the test contract, and a real browser self-corrects from live
// measurements on first paint + every scroll/resize (see
// useTileVirtualization's header for the fuller version of this reasoning).
//
// UNIFORM-ROW APPROXIMATION: a Tree worksheet row can grow a second line
// (DatasetRowPreview's opt-in Sparkline expansion), so real row heights are
// not perfectly uniform. The window uses the tallest CURRENTLY RENDERED row
// as its one scalar row height — the same tradeoff, and the same
// self-correction (keyboard focus()/ensureVisible), as the tile hook.
//
// `scrollRef` is the REAL scrolling ancestor (the Library sidebar `<aside>`
// or the wide workspace panel host both header/search/sections AND the row
// list, per shell.css) — pass it down from the mount site. When absent (a
// standalone test harness, or a caller with no real scroll ancestor of its
// own), `rowsRef`'s own element stands in; jsdom never reports real scroll
// geometry either way, so this only changes which element a real browser
// listens to, never the deterministic test fallback path.

import { useCallback, useEffect, useState, type RefObject } from "react";

import { computeAxisWindow } from "../../lib/gridwindow";

export const VIRTUALIZE_ABOVE = 150;
const OVERSCAN_ROWS = 6;
const FALLBACK_VIEWPORT_H = 600;
const FALLBACK_ROW_H = 28;

export interface ListWindow {
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
  viewportH: number;
  rowsTop: number;
}

function measure(scrollEl: HTMLElement | null, rowsEl: HTMLElement | null, rowSelector: string): Metrics {
  const rows = rowsEl ? [...rowsEl.querySelectorAll<HTMLElement>(rowSelector)] : [];
  const tallest = rows.reduce((max, row) => Math.max(max, row.offsetHeight), 0);
  return {
    rowH: tallest > 0 ? tallest : FALLBACK_ROW_H,
    viewportH: scrollEl && scrollEl.clientHeight > 0 ? scrollEl.clientHeight : FALLBACK_VIEWPORT_H,
    rowsTop: rowsEl?.offsetTop ?? 0,
  };
}

export function useListVirtualization(
  count: number,
  scrollRef: RefObject<HTMLElement | null> | undefined,
  rowsRef: RefObject<HTMLElement | null>,
  rowSelector: string,
): ListWindow {
  const virtualized = count > VIRTUALIZE_ABOVE;
  const [scrollTop, setScrollTop] = useState(0);
  const [metrics, setMetrics] = useState<Metrics>({ rowH: FALLBACK_ROW_H, viewportH: FALLBACK_VIEWPORT_H, rowsTop: 0 });

  useEffect(() => {
    if (!virtualized) return;
    const scrollEl = scrollRef?.current ?? rowsRef.current;
    if (!scrollEl) return;
    const remeasure = (): void => {
      setMetrics((prev) => {
        const next = measure(scrollEl, rowsRef.current, rowSelector);
        return prev.rowH === next.rowH && prev.viewportH === next.viewportH && prev.rowsTop === next.rowsTop
          ? prev
          : next;
      });
    };
    // Scroll is the hot path — it reads ONLY scrollTop. Geometry changes
    // (a row growing/shrinking, a resize) arrive via ResizeObserver. jsdom has
    // neither real geometry nor ResizeObserver: the initial remeasure() runs
    // the deterministic-fallback path once, which is the test contract.
    const onScroll = (): void => setScrollTop(scrollEl.scrollTop);
    remeasure();
    setScrollTop(scrollEl.scrollTop);
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(remeasure) : null;
    observer?.observe(scrollEl);
    if (rowsRef.current) observer?.observe(rowsRef.current);
    return () => {
      scrollEl.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [virtualized, scrollRef, rowsRef, rowSelector]);

  const ensureVisible = useCallback(
    (index: number): void => {
      if (!virtualized) return;
      const scrollEl = scrollRef?.current ?? rowsRef.current;
      if (!scrollEl) return;
      const fresh = measure(scrollEl, rowsRef.current, rowSelector);
      // Write the fresh measurement back into state (no split brain — see
      // useTileVirtualization's identical comment): after a container change
      // the spacer math must use the NEW row height immediately.
      setMetrics((prev) =>
        prev.rowH === fresh.rowH && prev.viewportH === fresh.viewportH && prev.rowsTop === fresh.rowsTop
          ? prev
          : fresh,
      );
      const { rowH, viewportH, rowsTop } = fresh;
      const rowTop = rowsTop + Math.max(0, index) * rowH;
      const rowBottom = rowTop + rowH;
      let next = scrollEl.scrollTop;
      if (rowTop < next) next = rowTop;
      else if (rowBottom > next + viewportH) next = rowBottom - viewportH;
      if (next !== scrollEl.scrollTop) scrollEl.scrollTop = next;
      // jsdom never fires scroll events on programmatic scrollTop writes —
      // sync the window state directly so the target renders next commit.
      setScrollTop(next);
    },
    [virtualized, scrollRef, rowsRef, rowSelector],
  );

  if (!virtualized) {
    return { start: 0, end: count, padTop: 0, padBottom: 0, virtualized, ensureVisible };
  }

  const { rowH, viewportH, rowsTop } = metrics;
  const w = computeAxisWindow(Math.max(0, scrollTop - rowsTop), viewportH, count, {
    itemSize: rowH,
    overscan: OVERSCAN_ROWS,
  });
  return { start: w.start, end: w.end, padTop: w.offset, padBottom: Math.max(0, (count - w.end) * rowH), virtualized, ensureVisible };
}

/** Focus a row that may not be rendered yet (a caller's `ensureVisible` just
 *  moved the window): retry across a few animation frames, the same contract
 *  as useTileVirtualization's `focusTileWhenRendered`. The retry stands down
 *  the moment focus belongs to anything it doesn't own — `owned` names extra
 *  selectors (the row focus is transitioning FROM, a scroll-out fallback
 *  holder) besides `selector` itself that are legitimate places for focus to
 *  sit mid-retry without aborting it. */
export function focusRowWhenRendered(selector: string, owned: readonly string[] = []): void {
  let attempts = 0;
  const ownedSelector = [selector, ...owned].join(",");
  const tryFocus = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.matches(ownedSelector)) return;
    const row = document.querySelector<HTMLElement>(selector);
    if (row) row.focus();
    else if (++attempts < 8) requestAnimationFrame(tryFocus);
  };
  tryFocus();
}
