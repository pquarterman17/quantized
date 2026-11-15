// Interactive uPlot tool-dock gestures: drag-to-pan, the data-cursor readout,
// the two-point measure ruler, region statistics, and wheel-to-zoom. Each binds
// its pointer listeners in a `ready` hook and holds live state in DATA coords
// (canvas redraw only — no React rerender), tearing down per-drag listeners on
// release. Passive overlays live in uplotOverlays; the region-analysis tools
// (integrate / FWHM) live in uplotRegionTools.
//
// Bundle diet slice 27 (plans/BUNDLE_HEADROOM.md): the four plugins that only
// run while their tool is picked -- pan, the cursor readout, the measure
// ruler and region statistics -- moved verbatim to lib/uplotPointerTools.ts,
// a lazy chunk loaded through lib/axisExtrasHook.ts with the region tools.
// What every plot uses stays here: wheel zoom, the view bounds and the view
// history, and the scale setter pan shares with wheel zoom.

import type uPlot from "uplot";

/** One series' value at the cursor index. */
export interface ReadoutRow {
  label: string;
  y: number;
}

/** Readout reported by the cursor plugin (null when off-data): the cursor x plus
 *  every *visible* series' y at that shared aligned-data index (a mini tooltip). */
export interface Readout {
  x: number;
  rows: ReadoutRow[];
}

/** Set every scale to the data between two of its own pixel positions (`null`
 *  leaves it alone). Going through posToVal keeps this right on log,
 *  reciprocal and reversed axes, and a secondary y2 moves with y. */
export function setScalesPx(u: uPlot, px: (k: string, s: uPlot.Scale) => [number, number] | null): void {
  u.batch(() => {
    for (const k of Object.keys(u.scales)) {
      const r = px(k, u.scales[k]);
      if (!r) continue;
      const a = u.posToVal(r[0], k);
      const b = u.posToVal(r[1], k);
      // Past a reciprocal axis's pole posToVal is NaN or Infinity: stop there.
      if (Number.isFinite(a + b)) u.setScale(k, { min: Math.min(a, b), max: Math.max(a, b) });
    }
  });
}

/**
 * Wheel-to-zoom toward the cursor (Preferences ▸ Interaction ▸ Mouse wheel).
 * Wheel up zooms in, down zooms out, by `step` per notch (default 1.18). `⌘`/Ctrl
 * = X-only, `⇧` = Y-only. The new range is read back through `posToVal`, so the
 * zoom is correct for log axes (distr:3) as well as linear. The listener is bound
 * to `u.over`, which uPlot tears down on destroy.
 */
export function wheelZoomPlugin(step = 1.18): uPlot.Plugin {
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        over.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            if (e.deltaY === 0) return;
            e.preventDefault();
            const rect = over.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const wid = over.clientWidth || 1;
            const hgt = over.clientHeight || 1;
            const f = e.deltaY < 0 ? 1 / step : step; // up → zoom in (shrink range)
            const onlyX = e.metaKey || e.ctrlKey;
            const onlyY = e.shiftKey;
            // New edges in OLD pixel space, scaled about the cursor.
            setScalesPx(u, (k) =>
              k === "x"
                ? onlyY ? null : [cx - cx * f, cx + (wid - cx) * f]
                : onlyX ? null : [cy - cy * f, cy + (hgt - cy) * f],
            );
          },
          { passive: false },
        );
      },
    },
  };
}

/** A view's limits; null is auto (a reset). */
export interface PlotViewBounds {
  xLim: [number, number] | null;
  yLim: [number, number] | null;
  /** Present only when the plot has a secondary y axis. */
  y2Lim?: [number, number] | null;
}

/** The live view: x, y and (only when the plot has one) the secondary y range;
 *  `auto` gives the same shape with every limit null. */
export function viewBounds(u: uPlot, auto = false): PlotViewBounds {
  const lim = (s: uPlot.Scale): [number, number] | null => (auto ? null : [s.min ?? 0, s.max ?? 1]);
  return { xLim: lim(u.scales.x), yLim: lim(u.scales.y), ...(u.scales.y2 ? { y2Lim: lim(u.scales.y2) } : {}) };
}

/** Observe completed navigation gestures without participating in their
 * mechanics. Pointer drags (box zoom or pan) commit once on mouseup; a wheel
 * burst commits once after a short idle period. uPlot's double-click re-fit
 * commits as auto limits, not as the fitted numbers (which would pin them). */
export function viewHistoryPlugin(onCommit: (before: PlotViewBounds, after: PlotViewBounds) => void): uPlot.Plugin {
  let cleanup = () => {};
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        const bounds = () => viewBounds(u);
        let pointerStart: PlotViewBounds | null = null;
        let wheelStart: PlotViewBounds | null = null;
        let wheelTimer: ReturnType<typeof setTimeout> | null = null;
        let lastBefore: PlotViewBounds | null = null;
        let refits = 0; // a click commit still pending when a double-click lands is dropped
        const down = (e: MouseEvent) => {
          if (e.button === 0) pointerStart = bounds();
        };
        const up = () => {
          if (!pointerStart) return;
          const before = (lastBefore = pointerStart);
          const at = refits;
          pointerStart = null;
          setTimeout(() => at === refits && onCommit(before, bounds()), 0);
        };
        const dbl = () => {
          refits++;
          if (lastBefore) onCommit(lastBefore, viewBounds(u, true));
        };
        const wheel = () => {
          wheelStart ??= bounds();
          if (wheelTimer) clearTimeout(wheelTimer);
          wheelTimer = setTimeout(() => {
            if (wheelStart) onCommit(wheelStart, bounds());
            wheelStart = null;
            wheelTimer = null;
          }, 160);
        };
        over.addEventListener("mousedown", down);
        document.addEventListener("mouseup", up);
        over.addEventListener("wheel", wheel);
        over.addEventListener("dblclick", dbl);
        cleanup = () => {
          over.removeEventListener("mousedown", down);
          document.removeEventListener("mouseup", up);
          over.removeEventListener("wheel", wheel);
          if (wheelTimer) clearTimeout(wheelTimer);
        };
      },
      destroy: () => cleanup(),
    },
  };
}
