// `categoricalTickFormatter`, moved verbatim out of lib/uplotOpts.ts (its
// line pin) to make room for the figures-audit #6 axis-extras hook there;
// uplotOpts.ts re-exports it, so no importer changed.

import type uPlot from "uplot";

type ValuesFn = Extract<NonNullable<uPlot.Axis["values"]>, (...args: never[]) => unknown>;

/** Build a uPlot axis `values` formatter for a categorical x-axis
 *  (`PlotPayload.xCategories`, gap #20): `data[0]` holds ORDINAL positions
 *  (0, 1, 2, …), so a tick maps to its label only when it lands exactly on an
 *  in-range integer index — a fractional split (uPlot may propose one
 *  between categories at some zoom levels) or an out-of-range one renders
 *  blank rather than a misleading label. */
export function categoricalTickFormatter(categories: readonly string[]): ValuesFn {
  return (_u, splits) =>
    splits.map((v) => {
      if (v == null) return null;
      const i = Math.round(v);
      return i >= 0 && i < categories.length && Math.abs(v - i) < 1e-6 ? categories[i] : "";
    });
}
