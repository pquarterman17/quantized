// Equal aspect for an XY plot (plan item 24, Origin's Layer > Size "link axis
// length to the XY ratio"): one X unit is as long on screen as one Y unit, so a
// circle stays a circle and a Nyquist arc keeps its shape. Opt-in on the Y
// axis' format (`AxisFormat.equal`); the export is
// `calc/axis_style.py` (`ax.set_aspect("equal", adjustable="datalim")`).
//
// Like matplotlib's "datalim", the axis whose span is too SMALL is widened about
// its centre until the data-per-pixel of both axes agree; nothing is ever
// cropped. Linear X and Y only (a log axis has no single unit length). Lazy
// with the axis extras (`axisExtras.ts`).

import type uPlot from "uplot";

type Pair = readonly [number, number];

/** The `{x, y}` limits that make one X unit and one Y unit the same length on a
 *  `w` x `h` px plot, or null when they already are (or cannot be computed). */
export function equalAspectRange(x: Pair, y: Pair, w: number, h: number): { x: Pair; y: Pair } | null {
  const dx = x[1] - x[0];
  const dy = y[1] - y[0];
  if (![dx, dy, w, h].every(Number.isFinite) || dx <= 0 || dy <= 0 || w <= 0 || h <= 0) return null;
  const wantDy = (dx * h) / w;
  if (Math.abs(wantDy - dy) <= 1e-9 * Math.max(dy, wantDy)) return null;
  const grow = (lim: Pair, span: number): Pair => {
    const c = (lim[0] + lim[1]) / 2;
    return [c - span / 2, c + span / 2];
  };
  return wantDy > dy ? { x, y: grow(y, wantDy) } : { x: grow(x, (dy * w) / h), y };
}

/** The plugin: re-fits both scales after any scale or size change. The fix runs in a
 *  microtask (uPlot's own redraw is one too), never inside the hook that saw the change. */
export function equalAspectPlugin(): uPlot.Plugin {
  let busy = false;
  const fit = (u: uPlot): void => {
    const sx = u.scales.x;
    const sy = u.scales.y;
    if (!sx || !sy || sx.min == null || sx.max == null || sy.min == null || sy.max == null) return;
    const r = equalAspectRange([sx.min, sx.max], [sy.min, sy.max], u.bbox.width, u.bbox.height);
    if (!r) return;
    busy = true;
    try {
      u.batch(() => {
        u.setScale("x", { min: r.x[0], max: r.x[1] });
        u.setScale("y", { min: r.y[0], max: r.y[1] });
      });
    } finally {
      busy = false;
    }
  };
  const later = (u: uPlot, key?: string): void => {
    if (busy || (key !== undefined && key !== "x" && key !== "y")) return;
    queueMicrotask(() => { if (!busy) fit(u); });
  };
  return { hooks: { setScale: later, setSize: (u) => later(u), ready: (u) => later(u) } };
}
