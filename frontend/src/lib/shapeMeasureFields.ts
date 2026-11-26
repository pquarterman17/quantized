// The measurement shapes' persisted/wire fields (`Shape.kind` slope | distance |
// angle | scalebar), kept apart from the math in annotationMeasure.ts so the
// eager sanitizers and the export projection reach only this small module.
// A measurement reads data units, so it is never page-anchored.
import type { Shape } from "./types";

export const MEASURE_KINDS = ["slope", "distance", "angle", "scalebar"] as const;

export function isMeasureKind(kind: string): boolean {
  return (MEASURE_KINDS as readonly string[]).includes(kind);
}

type Extra = Pick<Shape, "x3" | "y3" | "length" | "orient" | "text" | "triangle">;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The kind-specific fields of a measurement shape, read from untrusted input
 *  (a `.dwk` or an override bag). Empty for any other kind; a measurement that
 *  lacks what its kind needs returns null (the caller drops it). */
export function measureFields(o: Record<string, unknown>, kind: string): Extra | null {
  if (kind === "angle") return fin(o.x3) && fin(o.y3) ? { x3: o.x3, y3: o.y3 } : null;
  if (kind === "slope") return o.triangle === true ? { triangle: true } : {};
  if (kind === "scalebar") {
    return {
      ...(fin(o.length) && o.length > 0 ? { length: o.length } : {}),
      ...(o.orient === "v" ? { orient: "v" as const } : o.orient === "h" ? { orient: "h" as const } : {}),
      ...(typeof o.text === "string" && o.text ? { text: o.text.slice(0, 80) } : {}),
    };
  }
  return {};
}

/** The same fields on a render request's wire shape. */
export function measureWire(s: Shape): Extra {
  if (!isMeasureKind(s.kind)) return {};
  return {
    ...(s.kind === "angle" && fin(s.x3) && fin(s.y3) ? { x3: s.x3, y3: s.y3 } : {}),
    ...(s.kind === "slope" && s.triangle ? { triangle: true } : {}),
    ...(s.kind === "scalebar" && s.length ? { length: s.length } : {}),
    ...(s.kind === "scalebar" && s.orient ? { orient: s.orient } : {}),
    ...(s.kind === "scalebar" && s.text ? { text: s.text } : {}),
  };
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
