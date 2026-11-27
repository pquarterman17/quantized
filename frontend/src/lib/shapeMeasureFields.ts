// The measurement shapes' persisted/wire fields (`Shape.kind` slope | distance |
// angle | scalebar), kept apart from the math in annotationMeasure.ts so the
// eager sanitizers and the export projection reach only this small module.
// A measurement reads data units, so it is never page-anchored.
import type { Shape } from "./types";

export const MEASURE_KINDS = ["slope", "distance", "angle", "scalebar"] as const;

export function isMeasureKind(kind: string): boolean {
  return (MEASURE_KINDS as readonly string[]).includes(kind);
}

type Extra = Pick<Shape, "x3" | "y3" | "length" | "orient" | "text" | "triangle" | "arc">;
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The kind-specific fields of a measurement shape, read from untrusted input
 *  (a `.dwk` or an override bag). Empty for any other kind; a measurement that
 *  lacks what its kind needs returns null (the caller drops it). */
export function measureFields(o: object, kind: string): Extra | null {
  const { x3, y3, length, orient, text, triangle, arc } = o as Record<string, unknown>;
  if (kind === "angle") return fin(x3) && fin(y3) ? { x3, y3, ...(arc === true ? { arc: true } : {}) } : null;
  if (kind === "slope") return triangle === true ? { triangle: true } : {};
  if (kind !== "scalebar") return {};
  return {
    ...(fin(length) && length > 0 ? { length } : {}),
    ...(orient === "h" || orient === "v" ? { orient } : {}),
    ...(typeof text === "string" && text ? { text: text.slice(0, 80) } : {}),
  };
}
