// Origin's tick-label "Divide by" (Tick Labels > Display) on an imported
// graph: the axis labels read value / factor and NO "×factor" text is drawn —
// the axis title carries the unit (Moke.opj Graph10: H stored in Oe, ticks
// read -600..600 under "H (mT)"). Decoded per layer and axis side by
// `io/origin_project/opj_tick_divide.py` (`.opj` only) as `tick_label_divide`.
// Screen (`lib/axisExtras.ts`) and export (`calc/axis_extras.py`) both honour
// `AxisFormat.divideMark: false`.

import type { AxisFormat } from "./axisFormat";
import type { OriginFigure } from "./types";

/** The decoded figure field: tick labels read value / factor, per axis side. */
export type TickLabelDivide = Partial<Record<"bottom" | "top" | "left" | "right", number>>;
const sides = (fig: OriginFigure): TickLabelDivide =>
  (fig as OriginFigure & { tick_label_divide?: TickLabelDivide }).tick_label_divide ?? {};

/** Factors for the plot's X, Y and Y2 axes (absent = labels undivided). */
export interface OriginDivides {
  x?: number;
  y?: number;
  y2?: number;
}

/** `fmt` dividing by `divide` the way Origin does; without a factor, the
 *  factor an earlier applied Origin graph set is removed (a user's own
 *  Axis-dialog divide, which shows its mark, is kept). */
export function originDivideFmt(fmt: AxisFormat, divide: number | undefined): AxisFormat {
  if (divide !== undefined && Number.isFinite(divide) && divide > 0 && divide !== 1) {
    return { ...fmt, divide, divideMark: false };
  }
  if (fmt.divideMark !== false) return fmt;
  const { divide: _divide, divideMark: _mark, ...rest } = fmt;
  return rest;
}

/** The decoded factors of one Origin layer — or a double-Y pair, whose upper
 *  layer's own Y axis is the plot's right axis. */
export function figureDivides(main: OriginFigure, upper?: OriginFigure | null): OriginDivides {
  const own = sides(main);
  const right = upper ? sides(upper) : own;
  return { x: own.bottom, y: own.left, y2: upper ? right.right ?? right.left : own.right };
}

type PanelFmt = { x?: Partial<AxisFormat>; y?: Partial<AxisFormat>; y2?: Partial<AxisFormat> };
const divideBy = (v: number): Partial<AxisFormat> => ({ divide: v, divideMark: false });

/** A spatial panel's own format overrides (`SpatialPanel.fmt`) for one
 *  layer's factors. `y2` is set whenever a Y factor is: `{}` keeps the right
 *  axis on the plot's own Y format instead of inheriting this panel's. */
export function originPanelFmt(fig: OriginFigure): PanelFmt | undefined {
  const d = figureDivides(fig);
  if (!d.x && !d.y) return undefined;
  return { ...(d.x ? { x: divideBy(d.x) } : {}), ...(d.y ? { y: divideBy(d.y), y2: {} } : {}) };
}

/** `fmt` with the right axis of a merged frame-coincident layer `upper`. */
export function withY2PanelFmt(fmt: PanelFmt | undefined, upper: OriginFigure): PanelFmt | undefined {
  const own = sides(upper);
  const v = own.right ?? own.left;
  return v ? { ...fmt, y2: divideBy(v) } : fmt;
}

interface Fmts {
  xFmt: AxisFormat;
  yFmt: AxisFormat;
  y2Fmt: AxisFormat | null;
}

/** The store patch applying `d` to the plot's three axis formats. `xFmt`
 *  defaults to the store's own (pass the top-axis-patched one when there is
 *  one). Y2 is set explicitly only when a factor is involved: a null y2Fmt
 *  inherits yFmt, which would otherwise divide the right axis by the left
 *  axis' factor. */
export function originDividePatch(s: Fmts, d: OriginDivides, xFmt: AxisFormat = s.xFmt): Fmts {
  const yFmt = originDivideFmt(s.yFmt, d.y);
  const involved = d.y !== undefined || d.y2 !== undefined || s.y2Fmt?.divideMark === false;
  const y2Fmt = involved ? originDivideFmt(s.y2Fmt ?? originDivideFmt(s.yFmt, undefined), d.y2) : s.y2Fmt;
  return { xFmt: originDivideFmt(xFmt, d.x), yFmt, y2Fmt };
}
