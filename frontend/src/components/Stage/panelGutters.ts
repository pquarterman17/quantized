// One y-tick gutter width for a whole set of panels (plot audit round 3).
//
// uPlot sizes a y axis from the tick labels it draws, so in a stack (or a facet
// grid) a panel reading "-0.0025" started its plot area ~16 px right of one
// reading "0", and x ticks that mean the same value no longer lined up from
// panel to panel. Every panel's y axes are sized at least the set's widest
// gutter on that side, measured after the first layout and again after a resize.

import type uPlot from "uplot";

/** Each panel set's shared gutter width by axis side (3 left, 1 right). */
const registry = new WeakMap<readonly uPlot[], Map<number, number>>();

/** Wrap `opts`' y axes so each is at least `shared`'s width for its side. */
export function sharedGutters(opts: uPlot.Options, shared: Map<number, number>): void {
  opts.axes = opts.axes?.map((ax, k) => {
    if (k === 0) return ax;
    const own = ax.size ?? 50;
    const side = ax.side ?? 3;
    return {
      ...ax,
      size: (u, values, i, cycle) => Math.max(typeof own === "function" ? own(u, values, i, cycle) : own, shared.get(side) ?? 0),
    };
  });
}

/** The y axes uPlot laid out, with the gutter width it gave each. */
const yGutters = (u: uPlot) =>
  (u.axes ?? []).slice(1).flatMap((ax) => (ax.show === false ? [] : [{ side: ax.side ?? 3, size: (ax as { _size?: number })._size ?? 0 }]));

/** Measure the widest y gutter per side across `plots` (built with
 *  `sharedGutters(…, shared)`) and lay out again every panel narrower than it. */
export function alignGutters(plots: readonly uPlot[], shared: Map<number, number>): void {
  registry.set(plots, shared);
  shared.clear();
  for (const g of plots.flatMap(yGutters)) shared.set(g.side, Math.max(shared.get(g.side) ?? 0, g.size));
  for (const u of plots) {
    if (yGutters(u).some((g) => g.size < (shared.get(g.side) ?? 0))) u.setSize({ width: u.width, height: u.height });
  }
}

/** Resize `plots` through `resize`, then share their gutters again: the new
 *  size may draw different tick labels. */
export function resizeAligned(plots: readonly uPlot[], resize: () => void): void {
  const shared = registry.get(plots);
  shared?.clear();
  resize();
  if (shared) alignGutters(plots, shared);
}
