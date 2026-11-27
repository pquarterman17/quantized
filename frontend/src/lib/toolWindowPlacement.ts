// Where a NEW floating tool window (Ternary, Power, Resample, Map analysis: panels
// with no saved position and no x of their own) first opens (acceptance 5, u11).
// They used to open at a fixed top-left corner, over the layout toolbar and the
// plot's own toolbar. Now: beside the focused plot when there is room (right of
// it, else left of it), and otherwise inside it, but always BELOW the plot toolbar.
// A saved or explicit position still wins (the caller only asks when it has none).
//
// `placeBesidePlot` is pure; `placeNewToolWindow` reads the live boxes once.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlacementInput {
  width: number;
  viewport: { width: number; height: number };
  /** The focused plot's body (uPlot), or null when none is on screen. */
  plot: Box | null;
  /** The plot's floating toolbar, which a window must never cover. */
  toolbar: Box | null;
  /** Right edge of the Library, which a window opens clear of. */
  libraryRight: number;
  /** The desk's top edge (below the menu and layout toolbar rows). */
  deskTop: number;
  /** The position used when there is no plot to sit beside. */
  fallback: { x: number; y: number };
}

const GAP = 8;

/** The top-left of a new tool window of `width`. */
export function placeBesidePlot(i: PlacementInput): { x: number; y: number } {
  const { plot, toolbar, viewport, width } = i;
  if (!plot) {
    const x = i.libraryRight > 0 ? Math.max(i.fallback.x, Math.round(i.libraryRight) + GAP) : i.fallback.x;
    return { x, y: Math.max(i.fallback.y, i.deskTop + GAP) };
  }
  const top = Math.max(plot.top, i.deskTop);
  // Beside: right of the plot, then left of it (clear of the Library).
  if (plot.right + GAP + width <= viewport.width - GAP) return { x: Math.round(plot.right + GAP), y: Math.round(top) };
  if (plot.left - GAP - width >= i.libraryRight + GAP) return { x: Math.round(plot.left - GAP - width), y: Math.round(top) };
  // No room beside it: inside the plot, against its right edge, under the toolbar.
  const below = Math.max(top, (toolbar?.bottom ?? top) + GAP);
  const x = Math.max(i.libraryRight + GAP, Math.min(plot.right - width - GAP, viewport.width - width - GAP));
  return { x: Math.round(x), y: Math.round(below) };
}

const boxOf = (el: Element | null | undefined): Box | null => {
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
};

/** Read the live layout and place a window of `width` (browser only). */
export function placeNewToolWindow(width: number, fallback: { x: number; y: number }): { x: number; y: number } {
  if (typeof document === "undefined" || typeof window === "undefined") return fallback;
  const focused = document.querySelector(".qzk-plotwin.focused .uplot");
  const plotEl = focused ?? document.querySelector(".uplot");
  const plotBox = boxOf(plotEl);
  // A plot window's own frame is the "beside" reference when it is the focused one.
  const frame = focused ? boxOf(focused.closest(".qzk-plotwin")) : null;
  const scope = plotEl?.closest(".qzk-plotwin, .qzk-stage, .qzk-wl-middle") ?? document;
  const toolbar = boxOf(scope.querySelector(".qzk-float-tools"));
  const desk = boxOf(document.querySelector(".qzk-wl-desk, .qzk-main"));
  const lib = document.querySelector(".qzk-library")?.getBoundingClientRect().right ?? 0;
  const body = boxOf(plotEl?.closest(".qzk-wl-middle, .qzk-stage"));
  return placeBesidePlot({
    width,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    plot: frame ?? body ?? plotBox,
    toolbar,
    libraryRight: lib,
    deskTop: desk?.top ?? 0,
    fallback,
  });
}
