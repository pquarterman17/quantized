// Persisted figure-override validation and compaction, moved verbatim out of
// lib/figureOverrides.ts (bundle diet slice 12, plans/BUNDLE_HEADROOM.md).
// lib/figureDocument.ts parses window documents on the startup path and
// needs only these two (the sanitizer compacts its result); the rest of
// figureOverrides.ts (merge, legend locations, the y2 gate) is reached from
// the lazy Figure Builder and exporters, so it no longer rides in the entry
// chunk behind them. figureOverrides.ts re-exports both.

import type { FigureOverrides } from "./figureOverrides";

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const pair = (value: unknown, nullable = false): [number | null, number | null] | undefined => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const cell = (item: unknown): number | null | undefined =>
    nullable && item === null ? null : finite(item);
  const result = [cell(value[0]), cell(value[1])];
  return result[0] === undefined || result[1] === undefined ? undefined : result as [number | null, number | null];
};

/** Validate persisted publication overrides field-by-field, never retaining raw input. */
export function sanitizeFigureOverrides(value: unknown): FigureOverrides | null {
  const raw = record(value);
  if (!raw) return null;
  const out: FigureOverrides = {};
  if (finite(raw.font_size) !== undefined && finite(raw.font_size)! > 0) out.font_size = finite(raw.font_size);
  if (typeof raw.font_name === "string") out.font_name = raw.font_name;
  if (finite(raw.title_size) !== undefined && finite(raw.title_size)! > 0) out.title_size = finite(raw.title_size);
  const legend = record(raw.legend);
  if (legend) {
    const next: NonNullable<FigureOverrides["legend"]> = {};
    if (typeof legend.show === "boolean") next.show = legend.show;
    if (typeof legend.loc === "string") next.loc = legend.loc;
    if (typeof legend.frame === "boolean") next.frame = legend.frame;
    const anchor = pair(legend.anchor);
    if (anchor) next.anchor = anchor as [number, number];
    if (typeof legend.title === "string") next.title = legend.title;
    if (Object.keys(next).length) out.legend = next;
  }
  const ticks = record(raw.ticks);
  if (ticks) {
    const next: NonNullable<FigureOverrides["ticks"]> = {};
    if (ticks.dir === "in" || ticks.dir === "out") next.dir = ticks.dir;
    if (finite(ticks.len) !== undefined && finite(ticks.len)! >= 0) next.len = finite(ticks.len);
    if (typeof ticks.minor === "boolean") next.minor = ticks.minor;
    if (Object.keys(next).length) out.ticks = next;
  }
  const spines = record(raw.spines);
  if (spines) {
    const next: NonNullable<FigureOverrides["spines"]> = {};
    if (typeof spines.top === "boolean") next.top = spines.top;
    if (typeof spines.right === "boolean") next.right = spines.right;
    if (Object.keys(next).length) out.spines = next;
  }
  for (const key of ["x_lim", "y_lim", "y2_lim"] as const) {
    const limit = pair(raw[key], true);
    if (limit) out[key] = limit;
  }
  const margins = record(raw.margins);
  if (margins) {
    const next: NonNullable<FigureOverrides["margins"]> = {};
    for (const key of ["left", "right", "top", "bottom"] as const) {
      if (finite(margins[key]) !== undefined) next[key] = finite(margins[key]);
    }
    if (Object.keys(next).length) out.margins = next;
  }
  if (typeof raw.grid === "boolean") out.grid = raw.grid;
  if (Array.isArray(raw.annotations)) {
    out.annotations = raw.annotations.flatMap((value) => {
      const annotation = record(value);
      const x = annotation ? finite(annotation.x) : undefined;
      const y = annotation ? finite(annotation.y) : undefined;
      if (!annotation || x === undefined || y === undefined || typeof annotation.text !== "string") return [];
      const next: NonNullable<FigureOverrides["annotations"]>[number] = { x, y, text: annotation.text };
      if (finite(annotation.size) !== undefined && finite(annotation.size)! > 0) next.size = finite(annotation.size);
      if (annotation.anchor === "page") next.anchor = "page";
      const frame = record(annotation.frame);
      if (frame) {
        const cleaned: NonNullable<typeof next.frame> = {};
        if (typeof frame.fill === "string") cleaned.fill = frame.fill;
        if (typeof frame.stroke === "string") cleaned.stroke = frame.stroke;
        if (finite(frame.opacity) !== undefined && finite(frame.opacity)! >= 0 && finite(frame.opacity)! <= 1) cleaned.opacity = finite(frame.opacity);
        if (finite(frame.pad) !== undefined && finite(frame.pad)! >= 0) cleaned.pad = finite(frame.pad);
        if (Object.keys(cleaned).length) next.frame = cleaned;
      }
      return [next];
    });
  }
  if (Array.isArray(raw.x_breaks)) {
    out.x_breaks = raw.x_breaks.flatMap((value) => {
      const range = pair(value);
      return range && range[0] !== null && range[1] !== null && range[0] < range[1]
        ? [[range[0], range[1]]]
        : [];
    });
  }
  if (Array.isArray(raw.shapes)) {
    out.shapes = raw.shapes.flatMap((value) => {
      const shape = record(value);
      if (!shape || !["arrow", "line", "rect", "ellipse"].includes(shape.kind as string)) return [];
      const coordinates = ["x1", "y1", "x2", "y2"].map((key) => finite(shape[key]));
      if (coordinates.some((coordinate) => coordinate === undefined)) return [];
      const next: NonNullable<FigureOverrides["shapes"]>[number] = {
        kind: shape.kind as NonNullable<FigureOverrides["shapes"]>[number]["kind"],
        x1: coordinates[0]!, y1: coordinates[1]!, x2: coordinates[2]!, y2: coordinates[3]!,
      };
      if (shape.anchor === "page") next.anchor = "page";
      if (typeof shape.stroke === "string") next.stroke = shape.stroke;
      if (typeof shape.fill === "string") next.fill = shape.fill;
      if (finite(shape.opacity) !== undefined && finite(shape.opacity)! >= 0 && finite(shape.opacity)! <= 1) next.opacity = finite(shape.opacity);
      if (finite(shape.width) !== undefined && finite(shape.width)! >= 0) next.width = finite(shape.width);
      if (typeof shape.dash === "boolean") next.dash = shape.dash;
      return [next];
    });
  }
  if (Array.isArray(raw.ref_lines)) {
    out.ref_lines = raw.ref_lines.flatMap((value) => {
      const rl = record(value);
      const axis = rl?.axis;
      const v = rl ? finite(rl.value) : undefined;
      if (!rl || (axis !== "x" && axis !== "y") || v === undefined) return [];
      return [{ axis, value: v }];
    });
  }
  if (Array.isArray(raw.region_shades)) {
    out.region_shades = raw.region_shades.flatMap((value) => {
      const shade = record(value);
      if (!shade || typeof shade.fill !== "string") return [];
      const coordinates = ["x1", "x2", "y1", "y2"].map((key) => finite(shade[key]));
      if (coordinates.some((coordinate) => coordinate === undefined)) return [];
      const next: NonNullable<FigureOverrides["region_shades"]>[number] = {
        x1: coordinates[0]!, x2: coordinates[1]!, y1: coordinates[2]!, y2: coordinates[3]!, fill: shade.fill,
      };
      if (shade.axis === 0 || shade.axis === 1) next.axis = shade.axis;
      return [next];
    });
  }
  return compactOverrides(out);
}

const emptyObject = (v: unknown): boolean =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => x === undefined);

/** Drop undefined leaves and empty groups; returns null when NOTHING is set
 *  (so the request omits the key entirely and presets rule untouched). */
export function compactOverrides(ov: FigureOverrides): FigureOverrides | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ov)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      // limits: keep only when at least one bound is set; annotations/breaks/shapes/
      // ref_lines/region_shades: non-empty
      if (
        (k === "annotations" || k === "x_breaks" || k === "shapes" || k === "ref_lines" || k === "region_shades") &&
        v.length === 0
      )
        continue;
      if ((k === "x_lim" || k === "y_lim" || k === "y2_lim") && v.every((b) => b === null))
        continue;
      out[k] = v;
    } else if (typeof v === "object" && v !== null) {
      const grp = Object.fromEntries(
        Object.entries(v).filter(([, x]) => x !== undefined),
      );
      if (!emptyObject(grp) && Object.keys(grp).length) out[k] = grp;
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? (out as FigureOverrides) : null;
}
