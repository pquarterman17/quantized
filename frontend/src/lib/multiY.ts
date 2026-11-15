// Origin-style multiple Y axes (gap audit 4 G11): Y3, Y4, ... on the right,
// each pushed outward past the one before it, each with its own series,
// range, scale, number format, title and colour.
//
// THE MODEL (two PlotView fields, both saved in the .dwk / document):
//   * `yAxes`   -- the settings of Y3, Y4, ... in order (index 0 = Y3);
//   * `yAxisOf` -- channel -> its Y axis NUMBER (3 = Y3). Only extra axes
//     are recorded here; Y1/Y2 membership stays `y2Keys` (lib/axisspec.ts).
// A channel in `yAxisOf` rides that axis even if `y2Keys` also names it (the
// store's assign action keeps the two disjoint; this is the tie-break).
//
// FAIL CLOSED: an assignment to an axis that does not exist (a hand-edited
// file, a template from a graph with more axes) draws that series on Y1,
// on screen AND in export, and `resolveExtraYAxes` reports it as an orphan
// so the caller can say so (`multiYNote`) -- never silently.
//
// GEOMETRY (the screen/export contract, tests/fixtures/wire/multi_y.json):
// the right-hand axes stack outward in order Y2, Y3, Y4, ...; every right
// axis but the outermost takes a fixed slot of MULTI_Y_SLOT_PT points, so
// the k-th right axis sits k slots outside the frame -- matplotlib
// `spines.right.set_position(("outward", k * slot))`, uPlot by sizing each
// inner right axis to exactly one slot (lib/uplotMultiY.ts).
//
// WHAT AN EXTRA AXIS DOES NOT DO (refused, documented, tested):
//   * crossing, breaks, the gap-#5 offset, per-axis grid and a top axis are
//     stripped from its format -- it is a stacked right axis by definition;
//   * linked Y (G19) links Y1 only; an extra axis never links;
//   * the views that draw several panels (stack, facets, X breaks, the
//     Origin multi-panel composition), a group split or a colour/symbol
//     encoding draw every series on Y1/Y2 with a status note (`multiYNote`),
//     in the export too (lib/figureSpec.ts sends no `y_axes` there).

import { inheritedAxisFormat, sanitizeAxisExtras, type AxisFormat } from "./axisFormat";
import type { AxisScale, Dataset } from "./types";
import type { FigureEncoding } from "./figureEncoding";
import type { ExtraYAxis } from "./multiYModel";
import type { PlotPayload } from "./plotdata";
import { windowEncoding } from "./plotEncodingBinding";
import { canvasGroupCol } from "./plotGroupSplit";

export * from "./multiYModel";

/** Y3..Y8. */
export const MAX_EXTRA_Y = 6;
/** One right-axis slot, pt (screen: `ptToPx`). */
export const MULTI_Y_SLOT_PT = 60;

export const newExtraYAxis = (): ExtraYAxis => ({ lim: null, scale: null, step: null, fmt: null, label: "", color: null });


/** An extra axis' format: what a stacked right axis can draw. */
export function extraAxisFmt(fmt: AxisFormat): AxisFormat {
  const out = sanitizeAxisExtras(fmt) as Partial<Record<keyof AxisFormat, unknown>>;
  for (const k of ["cross", "breaks", "offset", "grid", "top", "rotate"] as const) delete out[k];
  return out as AxisFormat;
}

/** An extra axis in play: its plotted members (display order) and final
 *  scale / format / title, inherit rules applied. `n` = 3 for Y3. */
export interface ResolvedExtraY {
  n: number;
  keys: number[];
  lim: [number, number] | null;
  scale: AxisScale;
  fmt: AxisFormat;
  step: number | null;
  label: string | null;
  color: string | null;
}

export interface MultiYResolution {
  axes: ResolvedExtraY[];
  /** Plotted channels assigned to an axis that does not exist: drawn on Y1. */
  orphans: number[];
}

/** THE derivation, shared by the canvas and the export (lib/figureSpec.ts). */
export function resolveExtraYAxes(
  plotted: readonly number[],
  view: { yAxes?: readonly ExtraYAxis[]; yAxisOf?: Readonly<Record<number, number>> },
  primary: { scale: AxisScale; fmt: AxisFormat },
): MultiYResolution {
  const yAxes = view.yAxes ?? [];
  const of = view.yAxisOf ?? {};
  const axes: ResolvedExtraY[] = [];
  const orphans: number[] = [];
  for (const ch of plotted) {
    const n = of[ch];
    if (n === undefined) continue;
    const spec = yAxes[n - 3];
    if (!spec) {
      orphans.push(ch);
      continue;
    }
    let axis = axes.find((a) => a.n === n);
    if (!axis) {
      axis = {
        // A tick step rides a FIXED range only (as Y1's: a zoom clears it), on both sides.
        n, keys: [], lim: spec.lim, scale: spec.scale ?? primary.scale, step: spec.lim ? spec.step : null,
        fmt: extraAxisFmt(spec.fmt ?? inheritedAxisFormat(primary.fmt)), label: spec.label.trim() || null, color: spec.color,
      };
      axes.push(axis);
    }
    axis.keys.push(ch);
  }
  return { axes: axes.sort((a, b) => a.n - b.n), orphans };
}

/** `payload` with each extra-axis series re-tagged `axis: n - 1` (`plotted`
 *  is parallel to `payload.series`; overlays past it are left alone). */
export function withExtraYAxes<P extends { series: { axis?: number }[] }>(
  payload: P,
  plotted: readonly number[],
  axes: readonly ResolvedExtraY[],
): P {
  if (axes.length === 0) return payload;
  const of = new Map<number, number>();
  for (const a of axes) for (const k of a.keys) of.set(k, a.n - 1);
  return { ...payload, series: payload.series.map((s, i) => (of.has(plotted[i]) ? { ...s, axis: of.get(plotted[i]) } : s)) };
}

/** Why a view cannot draw Y3+ axes, or null -- the SAME gates the export
 *  applies (lib/figureSpec.ts). */
export function multiYBlocked(multiPanel: boolean, grouped: boolean, encoded: boolean): string | null {
  return multiPanel ? "a multi-panel view" : grouped ? "a group split" : encoded ? "a colour/symbol encoding" : null;
}

/** Why this view draws its Y3+ series on Y1 (null = it does not), for the
 *  status line. `orphans` names the channels whose axis is missing. */
export function multiYNote(blocked: string | null, orphans: readonly number[], name: (ch: number) => string): string | null {
  if (blocked) return `Y3+ axes are not drawn in ${blocked}: those series are on Y1 here and in the export`;
  if (orphans.length === 0) return null;
  return `${orphans.map(name).join(", ")}: assigned to a Y axis that no longer exists — drawn on Y1`;
}

/** What a window's canvas needs to draw its Y3+ axes (components/Stage/useMultiY.ts). */
export interface MultiYInputs {
  yAxes: ExtraYAxis[];
  yAxisOf: Record<number, number>;
  yScale: AxisScale;
  yFmt: AxisFormat;
  groupKey: number | null;
  y2Keys: number[] | null;
  /** The window's colour / symbol encoding picks and its dataset. */
  picks?: FigureEncoding | null;
  active: Dataset | null;
  /** A stack / facet / break / Origin multi-panel arrangement is showing. */
  multiPanel: boolean;
  /** Legend-hidden channels: an axis none of whose series is drawn takes no
   *  slot, as in the export (which never receives hidden series). */
  hiddenChannels?: readonly number[];
}

/** The canvas' whole Y3+ step for one window: the payload with its series
 *  re-tagged, the axes the viewport draws, and the status note (or null). */
export function multiYView(
  payload: PlotPayload | null,
  plotted: readonly number[],
  v: MultiYInputs,
): { payload: PlotPayload | null; axes: ResolvedExtraY[]; note: string | null } {
  const res = resolveExtraYAxes(plotted, v, { scale: v.yScale, fmt: v.yFmt });
  const groupCol = canvasGroupCol(v.groupKey, v.y2Keys);
  const encoded = !!v.picks && !!v.active && windowEncoding(v.picks, v.active, groupCol, v.y2Keys) !== null;
  const blocked = multiYBlocked(v.multiPanel, groupCol !== null, encoded);
  const axes = blocked ? [] : res.axes;
  const hidden = new Set(v.hiddenChannels ?? []);
  const name = (ch: number) => v.active?.data.labels[ch] ?? `column ${ch}`;
  return {
    // Every member is tagged (a hidden one rides its own, undrawn scale) ...
    payload: payload && withExtraYAxes(payload, plotted, axes),
    // ... but only an axis with a DRAWN series is laid out.
    axes: axes.filter((a) => a.keys.some((ch) => !hidden.has(ch))),
    note: multiYNote(blocked && (res.axes.length || res.orphans.length) ? blocked : null, res.orphans, name),
  };
}
