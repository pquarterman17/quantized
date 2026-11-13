// The Axis dialog's model (figures-audit #6): read one axis' settings out
// of the live view into a flat, editable draft, and turn an edited draft
// back into ONE view patch. Pure, so the round trip is unit-testable.
//
// Where each field lives -- nothing here is a new store field:
//   scale            xScale / yScale / y2Scale ("ln" = log + fmt.base "e")
//   from / to        xLim / yLim (half-open allowed) / y2Lim (both or none)
//   increment        xStep / yStep / y2Step (major tick step)
//   format, digits   xFmt / yFmt / y2Fmt (the existing tick-label format)
//   minor, ticks,    the same AxisFormat's figures-audit #6 extras
//   divide, size
//   titleSize        axisLabelStyles[axis].size (the axis title font, px)

import type { AxisId } from "../store/figureDialogs";
import type { PlotView } from "./plotview";
import type { AxisFormat, AxisScale, TickMode } from "./types";

export type AxisScaleChoice = AxisScale | "ln";

export interface AxisDraft {
  scale: AxisScaleChoice;
  from: string;
  to: string;
  increment: string;
  mode: TickMode;
  digits: string;
  minor: string;
  ticks: "out" | "in" | "both";
  divide: string;
  size: string;
  titleSize: string;
}

export type AxisView = Pick<
  PlotView,
  | "xScale" | "yScale" | "y2Scale" | "xLim" | "yLim" | "y2Lim" | "xStep" | "yStep" | "y2Step"
  | "xFmt" | "yFmt" | "y2Fmt" | "axisLabelStyles"
>;

const str = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? "" : String(v));

function parts(view: AxisView, axis: AxisId): { scale: AxisScale; lim: readonly (number | null)[] | null; step: number | null; fmt: AxisFormat } {
  if (axis === "x") return { scale: view.xScale, lim: view.xLim, step: view.xStep, fmt: view.xFmt };
  if (axis === "y") return { scale: view.yScale, lim: view.yLim, step: view.yStep, fmt: view.yFmt };
  return { scale: view.y2Scale ?? view.yScale, lim: view.y2Lim, step: view.y2Step, fmt: view.y2Fmt ?? view.yFmt };
}

export function axisDraft(view: AxisView, axis: AxisId): AxisDraft {
  const { scale, lim, step, fmt } = parts(view, axis);
  return {
    scale: scale === "log" && fmt.base === "e" ? "ln" : scale,
    from: str(lim?.[0]),
    to: str(lim?.[1]),
    increment: str(step),
    mode: fmt.mode,
    digits: str(fmt.digits),
    minor: str(fmt.minor),
    ticks: fmt.ticks ?? "out",
    divide: str(fmt.divide),
    size: str(fmt.size),
    titleSize: str(view.axisLabelStyles[axis]?.size),
  };
}

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** Validation messages for a draft (empty = valid). */
export function axisDraftErrors(d: AxisDraft, axis: AxisId): string[] {
  const out: string[] = [];
  const bad = (s: string) => s.trim() !== "" && num(s) === null;
  for (const [label, v] of [["From", d.from], ["To", d.to], ["Major increment", d.increment], ["Divide by", d.divide], ["Tick label size", d.size], ["Title size", d.titleSize], ["Minor ticks", d.minor], ["Digits", d.digits]] as const) {
    if (bad(v)) out.push(`${label} must be a number.`);
  }
  const lo = num(d.from);
  const hi = num(d.to);
  if (lo !== null && hi !== null && lo === hi) out.push("From and To must differ.");
  if ((d.scale === "log" || d.scale === "ln" || d.scale === "reciprocal") && ((lo !== null && lo <= 0) || (hi !== null && hi <= 0))) {
    out.push("A log, ln or reciprocal axis needs positive limits.");
  }
  if (axis === "y2" && (lo === null) !== (hi === null)) out.push("The Y2 axis takes both limits or neither.");
  const inc = num(d.increment);
  if (inc !== null && inc <= 0) out.push("Major increment must be positive.");
  const div = num(d.divide);
  if (div !== null && div <= 0) out.push("Divide by must be positive.");
  const minor = num(d.minor);
  if (minor !== null && (!Number.isInteger(minor) || minor < 0 || minor > 20)) out.push("Minor ticks must be a whole number from 0 to 20.");
  return out;
}

/** The view patch an edited, VALID draft commits. */
export function axisPatch(view: AxisView, axis: AxisId, d: AxisDraft): Partial<PlotView> {
  const base = parts(view, axis).fmt;
  const div = num(d.divide);
  const minor = num(d.minor);
  const size = num(d.size);
  const fmt: AxisFormat = {
    mode: d.mode,
    digits: num(d.digits) ?? base.digits,
    ...(div !== null && div !== 1 ? { divide: div } : {}),
    ...(minor ? { minor } : {}),
    ...(d.ticks !== "out" ? { ticks: d.ticks } : {}),
    ...(size !== null ? { size } : {}),
    ...(d.scale === "ln" ? { base: "e" as const } : {}),
  };
  const scale: AxisScale = d.scale === "ln" ? "log" : d.scale;
  const lo = num(d.from);
  const hi = num(d.to);
  const step = num(d.increment);
  const titleSize = num(d.titleSize);
  const styles = { ...view.axisLabelStyles };
  const { size: _old, ...restStyle } = styles[axis] ?? {};
  void _old;
  styles[axis] = titleSize !== null ? { ...restStyle, size: titleSize } : restStyle;
  const lim = lo === null && hi === null ? null : ([lo, hi] as [number | null, number | null]);
  if (axis === "x") return { xScale: scale, xLim: lim, xStep: step, xFmt: fmt, axisLabelStyles: styles };
  if (axis === "y") return { yScale: scale, yLim: lim, yStep: step, yFmt: fmt, axisLabelStyles: styles };
  return {
    y2Scale: scale,
    y2Lim: lo !== null && hi !== null ? [lo, hi] : null,
    y2Step: step,
    y2Fmt: fmt,
    axisLabelStyles: styles,
  };
}
