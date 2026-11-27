// The lazy-only half of lib/axisFormat.ts (bundle diet, plans/BUNDLE_HEADROOM.md
// slice 34): the Y2-inherits-Y format rule. Only the lazy Axis dialog and the
// on-demand axis extras apply it, so the code moved here verbatim and
// lib/axisFormat.ts re-exports it with `export *` - importers and tests are
// unchanged, and Rollup bundles this file with the lazy chunks that use it.
// architecture.test.ts ("re-exported lazy half") keeps eager modules off it.

import type { AxisFormat } from "./axisFormat";

/** The format a Y2 axis with none of its own inherits from the primary Y
 *  axis: its number format and tick look, but not what belongs to the Y
 *  axis itself -- the breaks and custom ticks (in Y's units), the
 *  probability scale, reverse, offset, crossing, grid and the
 *  label prefix / suffix (Y's units). */
export function inheritedAxisFormat(fmt: AxisFormat): AxisFormat {
  if (!fmt.breaks && !fmt.reverse && !fmt.equal && fmt.anchor === undefined && !fmt.offset && !fmt.grid && !fmt.top && !fmt.prob && !fmt.custom && fmt.cross === undefined && !fmt.prefix && !fmt.suffix) return fmt;
  const { breaks: _b, reverse: _r, equal: _eq, anchor: _an, offset: _o, grid: _g, top: _t, prob: _p, custom: _c, cross: _x, prefix: _pf, suffix: _sf, ...rest } = fmt;
  void [_b, _r, _eq, _an, _o, _g, _t, _p, _c, _x, _pf, _sf];
  return rest;
}
