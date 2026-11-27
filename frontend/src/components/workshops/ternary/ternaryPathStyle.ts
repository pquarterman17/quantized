// The line / vector style of the ternary workshop (plan item 25): colour,
// width (pt), dash, markers, arrowhead. Saved inside `TernaryField.path` as an
// opaque record (the eager project loader does not know its shape), so THIS is
// where it is validated: anything missing or malformed reads as the default.

import type { TernaryField } from "../../../lib/ternaryProject";

export const PATH_DASHES = ["solid", "dashed", "dotted", "dashdot"] as const;
export type PathDash = (typeof PATH_DASHES)[number];
export const HEAD_STYLES = ["filled", "open"] as const;
export type HeadStyle = (typeof HEAD_STYLES)[number];

export interface TernaryPathStyle {
  /** `#rrggbb`, or null = automatic (per-series cycle; `C0` for arrows). */
  color: string | null;
  /** Line / shaft width in points. */
  width: number;
  dash: PathDash;
  /** A marker on every point of a line. */
  markers: boolean;
  /** Arrowhead scale (1 = default). */
  headSize: number;
  head: HeadStyle;
}

export const DEFAULT_PATH_STYLE: TernaryPathStyle = { color: null, width: 1.5, dash: "solid", markers: false, headSize: 1, head: "filled" };
export const WIDTH_RANGE: readonly [number, number] = [0.25, 20];
export const HEAD_RANGE: readonly [number, number] = [0.2, 5];

const clamp = (v: unknown, [lo, hi]: readonly [number, number], d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

export function readPathStyle(field: TernaryField): TernaryPathStyle {
  const o = field.path ?? {};
  const d = DEFAULT_PATH_STYLE;
  return {
    color: typeof o.color === "string" && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color : null,
    width: clamp(o.width, WIDTH_RANGE, d.width),
    dash: PATH_DASHES.includes(o.dash as PathDash) ? (o.dash as PathDash) : d.dash,
    markers: typeof o.markers === "boolean" ? o.markers : d.markers,
    headSize: clamp(o.headSize, HEAD_RANGE, d.headSize),
    head: HEAD_STYLES.includes(o.head as HeadStyle) ? (o.head as HeadStyle) : d.head,
  };
}

/** The field with `patch` applied to its (validated) path style. */
export function withPathStyle(field: TernaryField, patch: Partial<TernaryPathStyle>): TernaryField {
  return { ...field, path: { ...readPathStyle(field), ...patch } };
}
