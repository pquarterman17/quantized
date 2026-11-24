// Map operations workshop: the form model and the request/name it produces.
// Pure (no React, no store) so the wiring is unit-testable.

import type { MapOpRequest } from "../../../lib/api/mapOps";

export type MapOpKind = "crop" | "flip" | "rotate" | "transpose" | "level" | "arith" | "scalar";

export const OP_OPTIONS: { value: MapOpKind; label: string }[] = [
  { value: "crop", label: "Crop to a rectangle" },
  { value: "flip", label: "Flip" },
  { value: "rotate", label: "Rotate" },
  { value: "transpose", label: "Transpose" },
  { value: "level", label: "Plane / surface level" },
  { value: "arith", label: "Map ± × ÷ map" },
  { value: "scalar", label: "Map ± × ÷ number" },
];

export const ARITH_OPTIONS = [
  { value: "add", label: "A + B" },
  { value: "sub", label: "A − B" },
  { value: "mul", label: "A × B" },
  { value: "div", label: "A ÷ B" },
] as const;

export interface MapOpsForm {
  op: MapOpKind;
  xmin: string; xmax: string; ymin: string; ymax: string;
  flipAxis: "h" | "v";
  degrees: "90" | "180" | "270";
  order: "1" | "2";
  restoreMean: boolean;
  arith: "add" | "sub" | "mul" | "div";
  otherId: string;
  interpolate: boolean;
  allowMismatch: boolean;
  scalar: string;
  reverse: boolean;
}

export const emptyForm = (): MapOpsForm => ({
  op: "crop", xmin: "", xmax: "", ymin: "", ymax: "", flipAxis: "h", degrees: "90", order: "1", restoreMean: false,
  arith: "sub", otherId: "", interpolate: false, allowMismatch: false, scalar: "1", reverse: false,
});

/** "" -> null (unbounded); a non-number -> NaN so the caller can name it. */
const bound = (t: string): number | null => (t.trim() === "" ? null : Number(t));

const SYMBOL = { add: "+", sub: "−", mul: "×", div: "÷" } as const;

/** The request body for the form (without the dataset payloads), or an error text. */
export function buildRequest(f: MapOpsForm): { req: Omit<MapOpRequest, "dataset">; error?: undefined } | { error: string; req?: undefined } {
  switch (f.op) {
    case "crop": {
      const b = [f.xmin, f.xmax, f.ymin, f.ymax].map(bound);
      if (b.some((v) => v !== null && !Number.isFinite(v))) return { error: "Crop bounds must be numbers (leave a bound empty for no limit)." };
      if (b.every((v) => v === null)) return { error: "Enter at least one crop bound." };
      return { req: { op: "crop", xmin: b[0], xmax: b[1], ymin: b[2], ymax: b[3] } };
    }
    case "flip": return { req: { op: "flip", axis: f.flipAxis } };
    case "rotate": return { req: { op: "rotate", degrees: Number(f.degrees) } };
    case "transpose": return { req: { op: "transpose" } };
    case "level": return { req: { op: "plane_level", order: Number(f.order), restore_mean: f.restoreMean } };
    case "arith":
      if (!f.otherId) return { error: "Pick the second map (B)." };
      return { req: { op: "arith", arith: f.arith, interpolate: f.interpolate, allow_mismatch: f.allowMismatch } };
    case "scalar": {
      const v = Number(f.scalar);
      if (f.scalar.trim() === "" || !Number.isFinite(v)) return { error: "Enter the number to combine with." };
      return { req: { op: "scalar", arith: f.arith, value: v, reverse: f.reverse } };
    }
  }
}

/** Short label of the operation, used in the result's name. */
export function opLabel(f: MapOpsForm, otherName?: string): string {
  switch (f.op) {
    case "crop": return "crop";
    case "flip": return f.flipAxis === "h" ? "flip H" : "flip V";
    case "rotate": return `rotate ${f.degrees}°`;
    case "transpose": return "transpose";
    case "level": return f.order === "1" ? "plane level" : "quadric level";
    case "arith": return `A ${SYMBOL[f.arith]} ${otherName ?? "B"}`;
    case "scalar": return f.reverse ? `${f.scalar} ${SYMBOL[f.arith]} A` : `A ${SYMBOL[f.arith]} ${f.scalar}`;
  }
}
