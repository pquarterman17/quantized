// The Y3+ half of a graph FORMAT (Copy / Paste Format, graph templates --
// lib/graphFormat.ts) for Origin-style multiple Y axes (gap audit 4 G11).
//
// A format carries how each extra axis LOOKS (scale, number format, colour)
// and which plotted POSITION rides which extra axis -- never a range, a tick
// step or a title, which are data-anchored like every other limit / step /
// title a format leaves alone (Y1 / Y2 steps never travel either). It travels only from a graph that has extra axes; a
// format without them leaves the target's own assignments as they are.
//
// FAIL CLOSED: a position assigned to an axis the format does not carry
// (a damaged or hand-edited template) lands on Y1, and `formatAxisOrphans`
// counts it so the command can say so.

import { MAX_EXTRA_Y, newExtraYAxis, sanitizeYAxes, type ExtraYAxis } from "./multiY";
import type { PlotView } from "./plotview";
import type { AxisFormat } from "./types";

export interface FormatYAxis {
  scale: ExtraYAxis["scale"];
  fmt: ExtraYAxis["fmt"];
  color: ExtraYAxis["color"];
}

export interface GraphFormatMultiY {
  /** Y3, Y4, ... looks. */
  yAxes?: FormatYAxis[];
  /** Per plotted position: its extra axis number (3+), or null (Y1 / Y2). */
  seriesAxis?: (number | null)[];
}

type View = Pick<PlotView, "yAxes" | "yAxisOf" | "y2Keys">;

/** Capture the extra axes of `view` over `plotted` (display order). */
export function captureMultiY(view: Partial<View>, plotted: readonly number[]): GraphFormatMultiY {
  const axes = view.yAxes ?? [];
  if (axes.length === 0) return {};
  const of = view.yAxisOf ?? {};
  return {
    yAxes: axes.map(({ scale, fmt, color }) => ({ scale, fmt: fmt && structuredClone(fmt), color })),
    seriesAxis: plotted.map((ch) => (of[ch] !== undefined && of[ch] - 3 < axes.length ? of[ch] : null)),
  };
}

/** Validate an untrusted format's extra-axis fields. */
export function sanitizeMultiY(o: Record<string, unknown>, isFmt: (f: unknown) => f is AxisFormat): GraphFormatMultiY {
  if (!Array.isArray(o.yAxes) || !Array.isArray(o.seriesAxis)) return {};
  const yAxes = sanitizeYAxes(o.yAxes, isFmt).map(({ scale, fmt, color }) => ({ scale, fmt, color }));
  const seriesAxis = o.seriesAxis.map((n) => (Number.isInteger(n) && (n as number) >= 3 && (n as number) < 3 + MAX_EXTRA_Y ? (n as number) : null));
  return { yAxes, seriesAxis };
}

/** Positions assigned to an axis `format` does not carry (drawn on Y1). */
export function formatAxisOrphans(format: GraphFormatMultiY): number {
  const n = format.yAxes?.length ?? 0;
  return (format.seriesAxis ?? []).filter((a) => a !== null && a - 3 >= n).length;
}

/** The view patch applying `format`'s extra axes to `target` (plotted =
 *  its plotted channels in display order); {} when the format has none. */
export function multiYPatch(format: GraphFormatMultiY, plotted: readonly number[], target: Partial<View>): Partial<View> {
  if (!format.yAxes || !format.seriesAxis) return {};
  const own = target.yAxes ?? [];
  const yAxes: ExtraYAxis[] = format.yAxes.map((look, i) => ({ ...(own[i] ?? newExtraYAxis()), ...structuredClone(look) }));
  for (let i = format.yAxes.length; i < own.length; i++) yAxes.push(own[i]);
  const yAxisOf = { ...(target.yAxisOf ?? {}) };
  let y2 = [...(target.y2Keys ?? [])];
  plotted.forEach((ch, p) => {
    if (p >= format.seriesAxis!.length) return;
    const n = format.seriesAxis![p];
    delete yAxisOf[ch];
    if (n !== null && n - 3 < format.yAxes!.length) {
      yAxisOf[ch] = n;
      y2 = y2.filter((k) => k !== ch);
    }
  });
  return { yAxes, yAxisOf, y2Keys: y2.length ? y2 : null };
}
