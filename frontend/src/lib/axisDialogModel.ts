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
//   breakFrom/To     the same AxisFormat's `breaks[0]` (Y and Y2 only: a
//                    linear axis with that stretch elided, lib/axisBreaks.ts)
//   titleSize        axisLabelStyles[axis].size (the axis title font, px)
//   reverse          xReversed (X) / the AxisFormat's `reverse` (Y, Y2)
//   grid*, rotate,   the same AxisFormat's gap-audit-2 #5 fields
//   offset, top*     (lib/axisStyleExtras.ts, calc/axis_style.py)
//   scale log2 /     gap audit 4 G17: log + fmt.base "2"; linear + fmt.prob
//   probit*          ("fraction" / "percent") (lib/axisScales.ts)
//   tickAt/Labels    the same AxisFormat's `custom` ticks
//   cross            the same AxisFormat's `cross` (axis position at)

import type { AxisId } from "../store/figureDialogs";
import type { PlotView } from "./plotview";
import { inheritedAxisFormat, MAX_CUSTOM_TICKS, normalizeBreaks, type AxisGrid, type TopAxis } from "./axisFormat";
import { topAxisProblem, topRangeProblem } from "./axisTop";
import { drawableOn, inProbDomain } from "./axisScales";
import type { AxisFormat, AxisScale, TickMode } from "./types";

/** "plot" = follow the plot-wide grid switch (no per-axis grid). */
export type GridLines = "plot" | "none" | "major" | "minor" | "both";
export type TopKind = "none" | TopAxis["kind"];

export type AxisScaleChoice = AxisScale | "ln" | "log2" | "probit" | "probitPct";

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
  /** The elided stretch of a broken Y / Y2 axis; both blank = no break. */
  breakFrom: string;
  breakTo: string;
  reverse: boolean;
  gridLines: GridLines;
  /** `#rrggbb`, or blank for the theme's grid colour. */
  gridColor: string;
  gridDash: NonNullable<AxisGrid["dash"]>;
  /** X only: tick-label rotation, degrees counter-clockwise. */
  rotate: string;
  offset: string;
  /** X only: the top axis. */
  topKind: TopKind;
  topFactor: string;
  /** `expr` kind: f(x) of the bottom axis. */
  topExpr: string;
  topShift: string;
  topWavelength: string;
  topTitle: string;
  /** G17: custom major positions and labels, comma-separated (blank = auto). */
  tickAt: string;
  tickLabels: string;
  /** G17: the value on the OTHER axis this axis crosses at (blank = frame). */
  cross: string;
}

export type AxisView = Pick<
  PlotView,
  | "xScale" | "yScale" | "y2Scale" | "xLim" | "yLim" | "y2Lim" | "xStep" | "yStep" | "y2Step"
  | "xFmt" | "yFmt" | "y2Fmt" | "axisLabelStyles" | "xReversed"
>;

const str = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? "" : String(v));

function parts(view: AxisView, axis: AxisId): { scale: AxisScale; lim: readonly (number | null)[] | null; step: number | null; fmt: AxisFormat } {
  if (axis === "x") return { scale: view.xScale, lim: view.xLim, step: view.xStep, fmt: view.xFmt };
  if (axis === "y") return { scale: view.yScale, lim: view.yLim, step: view.yStep, fmt: view.yFmt };
  return { scale: view.y2Scale ?? view.yScale, lim: view.y2Lim, step: view.y2Step, fmt: view.y2Fmt ?? inheritedAxisFormat(view.yFmt) };
}

function scaleChoice(scale: AxisScale, fmt: AxisFormat): AxisScaleChoice {
  if (scale === "log") return fmt.base === "e" ? "ln" : fmt.base === "2" ? "log2" : "log";
  if (scale === "linear" && fmt.prob) return fmt.prob === "percent" ? "probitPct" : "probit";
  return scale;
}

/** How the axis that `axis` would cross draws values (for the crossing's
 *  check): its scale, or "prob:<unit>" for a probability axis. */
export function otherAxisKind(view: AxisView, axis: AxisId): string {
  const { scale, fmt } = parts(view, axis === "x" ? "y" : "x");
  return scale === "linear" && fmt.prob ? `prob:${fmt.prob}` : scale;
}

export function axisDraft(view: AxisView, axis: AxisId): AxisDraft {
  const { scale, lim, step, fmt } = parts(view, axis);
  return {
    scale: scaleChoice(scale, fmt),
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
    breakFrom: axis === "x" ? "" : str(fmt.breaks?.[0]?.[0]),
    breakTo: axis === "x" ? "" : str(fmt.breaks?.[0]?.[1]),
    reverse: axis === "x" ? !!view.xReversed : !!fmt.reverse,
    gridLines: !fmt.grid ? "plot" : fmt.grid.major && fmt.grid.minor ? "both" : fmt.grid.major ? "major" : fmt.grid.minor ? "minor" : "none",
    gridColor: fmt.grid?.color ?? "",
    gridDash: fmt.grid?.dash ?? "solid",
    rotate: str(fmt.rotate),
    offset: str(fmt.offset),
    topKind: axis === "x" ? fmt.top?.kind ?? "none" : "none",
    topFactor: str(fmt.top?.factor),
    topExpr: fmt.top?.expr ?? "",
    topShift: str(fmt.top?.shift),
    topWavelength: str(fmt.top?.wavelength),
    topTitle: fmt.top?.title ?? "",
    tickAt: fmt.custom?.at.join(", ") ?? "",
    tickLabels: joinLabels(fmt.custom?.labels ?? []),
    cross: str(fmt.cross),
  };
}

/** A comma-separated list as entries (blank = none). */
const listOf = (s: string): string[] => (s.trim() === "" ? [] : s.split(",").map((t) => t.trim()));

/** Tick labels as one field: comma-separated, a literal comma (or
 *  backslash) written `\,` (`\\`), so "1,000" survives a reopen. */
export const joinLabels = (labels: readonly string[]): string => labels.map((l) => l.replace(/[\\,]/g, (c) => `\\${c}`)).join(", ");

/** `joinLabels`' inverse. */
export function splitLabels(s: string): string[] {
  if (s.trim() === "") return [];
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) cur += s[++i];
    else if (s[i] === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  out.push(cur.trim());
  return out;
}

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** The probability unit a scale choice stands for, if any. */
const probOf = (c: AxisScaleChoice): "fraction" | "percent" | undefined => (c === "probit" ? "fraction" : c === "probitPct" ? "percent" : undefined);

/** G17's checks: the probability domain, custom ticks, the crossing.
 *  `other` is `otherAxisKind` of the axis being crossed. */
function scaleExtraErrors(d: AxisDraft, axis: AxisId, other: string | undefined, lo: number | null, hi: number | null): string[] {
  const out: string[] = [];
  const prob = probOf(d.scale);
  const span = prob === "percent" ? "0 and 100 %" : "0 and 1";
  if (prob && ((lo !== null && !inProbDomain(lo, prob)) || (hi !== null && !inProbDomain(hi, prob)))) out.push(`A probability axis needs limits strictly between ${span}.`);
  if (prob && axis !== "x" && (d.breakFrom.trim() !== "" || d.breakTo.trim() !== "")) out.push("A probability axis cannot have a break.");
  const at = listOf(d.tickAt);
  const labels = splitLabels(d.tickLabels);
  const vals = at.map((t) => (t === "" ? NaN : Number(t)));
  if (vals.some((v) => !Number.isFinite(v))) out.push("Tick positions must be numbers, separated by commas.");
  else if (new Set(vals).size !== vals.length) out.push("Each tick position may appear only once.");
  else if (vals.length > MAX_CUSTOM_TICKS) out.push(`At most ${MAX_CUSTOM_TICKS} tick positions.`);
  else if (prob && vals.some((v) => !inProbDomain(v, prob))) out.push(`Tick positions on a probability axis must be strictly between ${span}.`);
  else if (["log", "ln", "log2", "reciprocal"].includes(d.scale) && vals.some((v) => v <= 0)) out.push("Tick positions on a log, ln, log2 or reciprocal axis must be positive.");
  if (labels.length > at.length && at.length > 0) out.push("There are more tick labels than tick positions.");
  if (d.cross.trim() !== "") {
    const c = num(d.cross);
    const [scale, unit] = (other ?? "linear").split(":");
    const otherFmt: AxisFormat = { mode: "auto", digits: 2, ...(unit === "fraction" || unit === "percent" ? { prob: unit } : {}) };
    if (c === null) out.push("Cross at must be a number.");
    else if (!drawableOn(c, scale === "prob" ? "linear" : scale, otherFmt)) out.push(`The ${axis === "x" ? "Y" : "X"} axis cannot show ${c} (its scale), so this axis cannot cross there.`);
    if (num(d.offset)) out.push("An axis that crosses the other cannot also be offset.");
    if (axis === "x" && num(d.rotate)) out.push("An X axis that crosses Y cannot have rotated labels.");
  }
  return out;
}

/** Validation messages for a draft (empty = valid). `other` is
 *  `otherAxisKind` of the axis the crossing would sit on (absent = linear). */
export function axisDraftErrors(d: AxisDraft, axis: AxisId, other?: string): string[] {
  const out: string[] = [];
  const bad = (s: string) => s.trim() !== "" && num(s) === null;
  for (const [label, v] of [["From", d.from], ["To", d.to], ["Major increment", d.increment], ["Divide by", d.divide], ["Tick label size", d.size], ["Title size", d.titleSize], ["Minor ticks", d.minor], ["Digits", d.digits], ["Break from", d.breakFrom], ["Break to", d.breakTo], ["Rotation", d.rotate], ["Offset", d.offset], ["Top factor", d.topFactor], ["Top shift", d.topShift], ["Wavelength", d.topWavelength]] as const) {
    if (bad(v)) out.push(`${label} must be a number.`);
  }
  const lo = num(d.from);
  const hi = num(d.to);
  if (lo !== null && hi !== null && lo === hi) out.push("From and To must differ.");
  if ((d.scale === "log" || d.scale === "ln" || d.scale === "log2" || d.scale === "reciprocal") && ((lo !== null && lo <= 0) || (hi !== null && hi <= 0))) {
    out.push("A log, ln, log2 or reciprocal axis needs positive limits.");
  }
  out.push(...scaleExtraErrors(d, axis, other, lo, hi));
  if (axis === "y2" && (lo === null) !== (hi === null)) out.push("The Y2 axis takes both limits or neither.");
  const inc = num(d.increment);
  if (inc !== null && inc <= 0) out.push("Major increment must be positive.");
  const div = num(d.divide);
  if (div !== null && div <= 0) out.push("Divide by must be positive.");
  const minor = num(d.minor);
  if (minor !== null && (!Number.isInteger(minor) || minor < 0 || minor > 20)) out.push("Minor ticks must be a whole number from 0 to 20.");
  const bLo = num(d.breakFrom);
  const bHi = num(d.breakTo);
  if (axis !== "x" && (d.breakFrom.trim() !== "" || d.breakTo.trim() !== "")) {
    if (bLo === null || bHi === null) out.push("An axis break needs both Break from and Break to.");
    else if (bLo >= bHi) out.push("Break from must be below Break to.");
    if (d.scale !== "linear" && !probOf(d.scale)) out.push("An axis break needs a linear scale.");
  }
  const rot = num(d.rotate);
  if (rot !== null && Math.abs(rot) > 90) out.push("Rotation must be between -90 and 90 degrees.");
  const off = num(d.offset);
  if (off !== null && (off < 0 || off > 72)) out.push("Offset must be from 0 to 72 pt.");
  if (d.gridColor.trim() !== "" && !/^#[0-9a-f]{6}$/i.test(d.gridColor.trim())) out.push("Grid colour must be #rrggbb, or blank for the theme colour.");
  const top = topOf(d);
  const why = top && topAxisProblem(top);
  if (why) out.push(why);
  else if (top && axis === "x") {
    const range = topRangeProblem(top, lo, hi);
    if (range) out.push(range);
  }
  if (top?.kind === "dspacing" && (num(d.topWavelength) ?? 0) > 100) out.push("Wavelength must be at most 100 Å.");
  return out;
}

function gridOf(d: AxisDraft): AxisGrid | undefined {
  if (d.gridLines === "plot") return undefined;
  const color = d.gridColor.trim().toLowerCase();
  return {
    major: d.gridLines === "major" || d.gridLines === "both",
    minor: d.gridLines === "minor" || d.gridLines === "both",
    ...(color ? { color } : {}),
    ...(d.gridDash !== "solid" ? { dash: d.gridDash } : {}),
  };
}

function topOf(d: AxisDraft): TopAxis | undefined {
  if (d.topKind === "none") return undefined;
  const factor = num(d.topFactor);
  const shift = num(d.topShift);
  const wavelength = num(d.topWavelength);
  const title = d.topTitle.trim();
  return {
    kind: d.topKind,
    ...(d.topKind === "expr" ? { expr: d.topExpr.trim() } : {}),
    ...(d.topKind !== "dspacing" && d.topKind !== "expr" && factor !== null ? { factor } : {}),
    ...(d.topKind === "linear" && shift !== null ? { shift } : {}),
    ...(d.topKind === "dspacing" && wavelength !== null ? { wavelength } : {}),
    ...(title ? { title } : {}),
  };
}

/** The view patch an edited, VALID draft commits. */
export function axisPatch(view: AxisView, axis: AxisId, d: AxisDraft): Partial<PlotView> {
  const base = parts(view, axis).fmt;
  const div = num(d.divide);
  const minor = num(d.minor);
  const size = num(d.size);
  const bLo = num(d.breakFrom);
  const bHi = num(d.breakTo);
  // The dialog edits the FIRST break; any further ones a file or template
  // carried stay, as long as they still sit clear of it.
  const breaks = axis === "x" ? base.breaks : bLo !== null && bHi !== null ? normalizeBreaks([[bLo, bHi], ...(base.breaks ?? []).slice(1)]) : undefined;
  const prob = probOf(d.scale);
  const at = listOf(d.tickAt).map(Number);
  const labels = splitLabels(d.tickLabels);
  const cross = num(d.cross);
  const fmt: AxisFormat = {
    mode: d.mode,
    digits: num(d.digits) ?? base.digits,
    ...(div !== null && div !== 1 ? { divide: div } : {}),
    ...(minor ? { minor } : {}),
    ...(d.ticks !== "out" ? { ticks: d.ticks } : {}),
    ...(size !== null ? { size } : {}),
    ...(d.scale === "ln" ? { base: "e" as const } : d.scale === "log2" ? { base: "2" as const } : {}),
    ...(prob ? { prob } : {}),
    ...(at.length ? { custom: { at, ...(labels.some((l) => l !== "") ? { labels } : {}) } } : {}),
    ...(cross !== null ? { cross } : {}),
    ...(breaks ? { breaks } : {}),
    ...(axis !== "x" && d.reverse ? { reverse: true } : {}),
    ...(axis === "x" && num(d.rotate) ? { rotate: num(d.rotate) as number } : {}),
    ...(num(d.offset) ? { offset: num(d.offset) as number } : {}),
    ...(gridOf(d) ? { grid: gridOf(d) } : {}),
    ...(axis === "x" && topOf(d) ? { top: topOf(d) } : {}),
  };
  const scale: AxisScale = d.scale === "ln" || d.scale === "log2" ? "log" : prob ? "linear" : (d.scale as AxisScale);
  const lo = num(d.from);
  const hi = num(d.to);
  const step = num(d.increment);
  const titleSize = num(d.titleSize);
  const styles = { ...view.axisLabelStyles };
  const { size: _old, ...restStyle } = styles[axis] ?? {};
  void _old;
  // No title size and nothing else: drop the axis' entry rather than store
  // an empty `{}` (a "style" that differs from the default by structure only).
  const nextStyle = titleSize !== null ? { ...restStyle, size: titleSize } : restStyle;
  if (Object.keys(nextStyle).length > 0) styles[axis] = nextStyle;
  else delete styles[axis];
  const lim = lo === null && hi === null ? null : ([lo, hi] as [number | null, number | null]);
  if (axis === "x") return { xScale: scale, xLim: lim, xStep: step, xFmt: fmt, axisLabelStyles: styles, xReversed: d.reverse };
  if (axis === "y") return { yScale: scale, yLim: lim, yStep: step, yFmt: fmt, axisLabelStyles: styles };
  return {
    y2Scale: scale,
    y2Lim: lo !== null && hi !== null ? [lo, hi] : null,
    y2Step: step,
    y2Fmt: fmt,
    axisLabelStyles: styles,
  };
}
