// The measurement annotations' shared rules (slope with the power-law
// exponent on log axes, distance, three-point angle, scale bar). Pure: the
// screen's draw pass (`uplotMeasureShapes.ts`) and the Inspector read these,
// and `src/quantized/calc/annotation_measure.py` implements the very same
// rules for the vector export, so a label reads identically in both. One
// table pins them: `tests/fixtures/wire/annotation_measures.json`.
//
// Everything is in DATA units: a distance is hypot(dx, dy) of the data
// coordinates and an angle is measured between the data-space arms, whatever
// the axis scales or the plot's aspect. Only the slope looks at the scales.

import type { Shape } from "./types";

import { isMeasureKind as isKind, MEASURE_KINDS } from "./shapeMeasureFields";
export { MEASURE_KINDS };
export type MeasureKind = (typeof MEASURE_KINDS)[number];
export const isMeasureKind = (kind: string): kind is MeasureKind => isKind(kind);

const INFINITY = "∞";
const NOT_AVAILABLE = "n/a";

/** `v` to `digits` significant digits, trailing zeros dropped, scientific
 *  (`1.23e+4`, no exponent padding) outside 1e-4 <= |v| < 10**digits. */
export function fmtSig(v: number, digits = 3): string {
  if (Number.isNaN(v)) return NOT_AVAILABLE;
  if (!Number.isFinite(v)) return v > 0 ? INFINITY : `-${INFINITY}`;
  if (v === 0) return "0";
  const [mant, expS] = v.toExponential(digits - 1).split("e");
  const exp = Number(expS);
  const strip = (t: string) => (t.includes(".") ? t.replace(/0+$/, "").replace(/\.$/, "") : t);
  if (exp < -4 || exp >= digits) return `${strip(mant)}e${exp >= 0 ? "+" : "-"}${Math.abs(exp)}`;
  return strip(v.toFixed(Math.max(0, digits - 1 - exp)));
}

/** `v` with `decimals` places; a value that rounds to zero has no sign. */
export function fmtFixed(v: number, decimals: number): string {
  const t = v.toFixed(decimals);
  return t.startsWith("-") && Number(t) === 0 ? t.slice(1) : t;
}

export type SlopeMode = "linear" | "exponent" | "semilog_x" | "semilog_y";

const SLOPE_PREFIX: Record<SlopeMode, string> = {
  linear: "slope = ",
  exponent: "n = ",
  semilog_x: "dy/dlog10(x) = ",
  semilog_y: "dlog10(y)/dx = ",
};

const log10Pos = (v: number): number | null => (v > 0 ? Math.log10(v) : null);

/** The slope of (x1,y1)-(x2,y2) in data units: dy/dx, or on log axes the
 *  power-law exponent d log10 y / d log10 x (both log), dy / d log10 x (x log)
 *  or d log10 y / dx (y log). `value` is null for a vertical segment or a log
 *  axis that sees a non-positive coordinate. */
export function slopeMeasure(
  x1: number, y1: number, x2: number, y2: number, xlog: boolean, ylog: boolean,
): { mode: SlopeMode; value: number | null; label: string } {
  const mode: SlopeMode = xlog && ylog ? "exponent" : xlog ? "semilog_x" : ylog ? "semilog_y" : "linear";
  const xs = xlog ? [log10Pos(x1), log10Pos(x2)] : [x1, x2];
  const ys = ylog ? [log10Pos(y1), log10Pos(y2)] : [y1, y2];
  const prefix = SLOPE_PREFIX[mode];
  if ([...xs, ...ys].some((v) => v === null)) return { mode, value: null, label: prefix + NOT_AVAILABLE };
  const dx = (xs[1] as number) - (xs[0] as number);
  const dy = (ys[1] as number) - (ys[0] as number);
  if (dx === 0) return { mode, value: null, label: prefix + INFINITY };
  const value = dy / dx;
  return { mode, value, label: prefix + fmtSig(value) };
}

/** `d` and its X and Y components, in data units, plus the label. */
export function distanceParts(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const d = Math.hypot(dx, dy);
  return { d, dx, dy, label: `d = ${fmtSig(d)} (Δx = ${fmtSig(dx)}, Δy = ${fmtSig(dy)})` };
}

/** The angle at `vertex` between the arms to `a` and `b`, degrees 0..180, in
 *  data coordinates; null when an arm has zero length. */
export function angleDegrees(
  vertex: readonly [number, number], a: readonly [number, number], b: readonly [number, number],
): number | null {
  const ux = a[0] - vertex[0], uy = a[1] - vertex[1];
  const vx = b[0] - vertex[0], vy = b[1] - vertex[1];
  const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy);
  if (nu === 0 || nv === 0) return null;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** The far end of a scale bar: `length` data units from (x1, y1) along X (`h`)
 *  or Y (`v`). */
export function scalebarEnd(x1: number, y1: number, orient: "h" | "v", length: number): [number, number] {
  return orient === "v" ? [x1, y1 + length] : [x1 + length, y1];
}

/** The slope marker's right triangle: both segment ends and the corner at
 *  (x2, y1), so both legs are axis-aligned on any axis scale. */
export function slopeTriangle(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  return [[x1, y1], [x2, y1], [x2, y2]];
}

/** Whether a segment's label sits below-right of its midpoint (a rising
 *  segment) rather than above-right. */
export function labelBelow(x1: number, y1: number, x2: number, y2: number): boolean {
  return (x2 - x1) * (y2 - y1) > 0;
}

type MeasureFields = Pick<Shape, "kind" | "x1" | "y1" | "x2" | "y2" | "x3" | "y3" | "length" | "orient" | "text">;

/** A scale bar's resolved geometry (orientation and length in data units). */
export function scalebarGeometry(
  s: Pick<Shape, "x1" | "y1" | "x2" | "y2" | "length" | "orient">,
): { orient: "h" | "v"; length: number; ex: number; ey: number } {
  const orient = s.orient === "v" ? "v" : "h";
  const length = s.length ?? (Math.abs(orient === "v" ? s.y2 - s.y1 : s.x2 - s.x1) || 0);
  const [ex, ey] = scalebarEnd(s.x1, s.y1, orient, length);
  return { orient, length, ex, ey };
}

/** The text a measurement shape prints, or null for any other kind. */
export function shapeLabel(s: MeasureFields, xlog: boolean, ylog: boolean): string | null {
  switch (s.kind) {
    case "slope":
      return slopeMeasure(s.x1, s.y1, s.x2, s.y2, xlog, ylog).label;
    case "distance":
      return distanceParts(s.x1, s.y1, s.x2, s.y2).label;
    case "angle": {
      const deg = angleDegrees([s.x1, s.y1], [s.x2, s.y2], [s.x3 ?? s.x1, s.y3 ?? s.y1]);
      return `θ = ${deg === null ? NOT_AVAILABLE : `${fmtFixed(deg, 1)}°`}`;
    }
    case "scalebar":
      return s.text ? s.text : fmtSig(scalebarGeometry(s).length);
    default:
      return null;
  }
}

/** Parse the "Set length" dialog entry: a leading number, then an optional
 *  unit ("200 nm" -> length 200, label "200 nm"). Null when it is not a
 *  positive number. */
export function parseScaleBarInput(raw: string): { length: number; text?: string } | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*?)\s*$/.exec(raw);
  if (!m) return null;
  const length = Number(m[1]);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  return m[2] ? { length, text: `${m[1]} ${m[2]}` } : { length };
}

/** The extra fields a freshly drawn measurement carries: an angle's second
 *  arm, a scale bar's length and direction (read off the snapped drag). */
export function newMeasureFields(
  kind: string, x1: number, y1: number, x2: number, y2: number, extra?: { x3: number; y3: number },
): Partial<Pick<Shape, "x3" | "y3" | "length" | "orient">> {
  if (kind === "angle" && extra) return { x3: extra.x3, y3: extra.y3 };
  if (kind === "scalebar") {
    const orient = y2 === y1 ? "h" : "v";
    return { orient, length: Math.abs(orient === "h" ? x2 - x1 : y2 - y1) };
  }
  return {};
}
