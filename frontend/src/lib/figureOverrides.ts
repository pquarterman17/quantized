// Figure property overrides (#11) — the ONE config object behind the property
// panels. Mirrors calc/figure._apply_overrides key-for-key: every panel field
// lands as a render_figure override, no side channels. `compact` strips
// untouched values so requests stay lean and old backends keep working. Pure.

import type { LegendPos } from "./plotview";

export interface FigureOverrides {
  font_size?: number;
  font_name?: string;
  title_size?: number;
  legend?: { show?: boolean; loc?: string; frame?: boolean; anchor?: [number, number]; title?: string };
  ticks?: { dir?: "in" | "out"; len?: number; minor?: boolean };
  spines?: { top?: boolean; right?: boolean };
  x_lim?: [number | null, number | null];
  y_lim?: [number | null, number | null];
  /** Fixed secondary (right) Y-axis range — the twinx counterpart of
   *  `y_lim`, applied by `calc.figure_y2.render_with_secondary_axis`
   *  (not `calc.figure_overrides._apply_overrides`, which only ever
   *  targets a single axes). Only meaningful when the request also sets
   *  `y2_keys` — `lib/exportFigureCommand.ts`'s `runExportFigureCommand`
   *  (via `gateY2Overrides`) strips a stale value here once it learns no
   *  channel is actually plotted on the secondary axis, so a request never
   *  carries a leftover range with no y2 axis to apply it to
   *  (GUI_INTERACTION #12 slice 4a). */
  y2_lim?: [number | null, number | null];
  margins?: { left?: number; right?: number; top?: number; bottom?: number };
  grid?: boolean;
  /** `size` (MAIN #18 — export parity for the pointer tool's font-size
   *  resize): a per-annotation override, falling back to `font_size` (or
   *  the style preset's own font size) on the backend when absent. `anchor`
   *  (MAIN #21): `"page"` renders `x`/`y` as FIGURE-fraction placement
   *  (`xycoords="figure fraction"`, y FLIPPED — canvas y grows downward,
   *  matplotlib figure fraction grows upward) instead of axes-data
   *  coordinates; absent = the pre-#21 data-coordinate behaviour. See
   *  `calc.figure_overrides._apply_overrides`. */
  annotations?: {
    x: number;
    y: number;
    text: string;
    size?: number;
    anchor?: "page";
    /** MAIN #27 "text box": a bbox behind the text —
     *  `calc.figure_overrides._apply_overrides`'s `ann.get("frame")` branch. */
    frame?: { fill?: string; stroke?: string; opacity?: number; pad?: number };
  }[];
  /** Manual axis breaks (gap #21, export-side): elided `[lo, hi]` x-ranges,
   *  rendered as twinned panels with diagonal break glyphs
   *  (`calc.figure._render_impl`). `lib/facet.suggestBreaks` proposes
   *  candidates from a gap scan of the x column. */
  x_breaks?: [number, number][];
  /** MAIN #27 drawn shapes (arrow/line/rect/ellipse) —
   *  `calc.figure_shapes._apply_shapes`. Mirrors `Shape` minus the `id`
   *  (the wire shape needs no identity, unlike the screen's editable list). */
  shapes?: {
    kind: "arrow" | "line" | "rect" | "ellipse";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    anchor?: "page";
    stroke?: string;
    fill?: string;
    opacity?: number;
    width?: number;
    dash?: boolean;
  }[];
  /** Export-fidelity gap (2026-08-11): fixed X/Y reference lines (Hc/Tc
   *  markers, a zero line, a critical edge…) — `lib/uplotOverlays.ts`'s
   *  refLinePlugin. Mirrors `RefLine` minus `id` (the wire needs no
   *  identity, unlike the screen's editable list — same reasoning as
   *  `shapes` above). Always the PRIMARY axes — `RefLine` has no
   *  secondary-axis concept, unlike `RegionShade` below. See
   *  `calc.figure_decor._apply_ref_lines`. */
  ref_lines?: { axis: "x" | "y"; value: number }[];
  /** Export-fidelity gap (2026-08-11): filled rectangular region bands
   *  (Origin `Rect*` film-stack shading, decode-plan #41) —
   *  `lib/uplotOverlays.ts`'s regionShadePlugin. Mirrors `RegionShade`
   *  minus `id`. `axis: 1` renders on the SECONDARY (y2) scale when the
   *  request has one (`y2_keys` set and non-empty); falls back to the
   *  primary scale otherwise — matches the screen's own `hasY2` fallback.
   *  See `calc.figure_decor._apply_region_shades`/`_split_region_shades_by_axis`. */
  region_shades?: { x1: number; x2: number; y1: number; y2: number; fill: string; axis?: 0 | 1 }[];
}

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

/** Overlay publication settings without replacing a partially specified nested group. */
export function mergeFigureOverrides(
  canonical: FigureOverrides | undefined,
  publication: FigureOverrides | null | undefined,
): FigureOverrides | undefined {
  if (!publication) return canonical;
  const merged: FigureOverrides = { ...canonical, ...publication };
  if (canonical?.legend || publication.legend) merged.legend = { ...canonical?.legend, ...publication.legend };
  if (canonical?.ticks || publication.ticks) merged.ticks = { ...canonical?.ticks, ...publication.ticks };
  if (canonical?.spines || publication.spines) merged.spines = { ...canonical?.spines, ...publication.spines };
  if (canonical?.margins || publication.margins) merged.margins = { ...canonical?.margins, ...publication.margins };
  return compactOverrides(merged) ?? undefined;
}

export const LEGEND_LOCS = [
  "best",
  "upper right",
  "upper left",
  "lower left",
  "lower right",
  "center left",
  "center right",
  "upper center",
  "lower center",
  "outside right",
  "outside top",
] as const;

/** The screen's corner-preset legend position (`ne`/`nw`/`se`/`sw`) as a
 *  matplotlib `loc` string — MAIN #18's export-parity mapping for the
 *  non-free-position case (a free `legendXY` uses `loc: "custom"` +
 *  `anchor` instead, matching `calc.figure_overrides`' existing #14
 *  drag-to-place handling verbatim). */
export function legendPosToLoc(pos: LegendPos): string {
  const loc: Record<LegendPos, string> = {
    ne: "upper right",
    nw: "upper left",
    se: "lower right",
    sw: "lower left",
  };
  return loc[pos];
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

/** Second-pass gate for the two override fields `liveViewOverrides` cannot
 *  compute correctly on its own, because it only sees raw store state
 *  before the caller has derived which channels are ACTUALLY plotted on
 *  the secondary axis (GUI_INTERACTION #12 slice 4a):
 *    - `y2_lim` must not reach the request when nothing is plotted on y2
 *      (a stale range from a since-untagged y2 channel would otherwise
 *      leak through — the request would have no y2 axis to apply it to).
 *    - `ticks.minor` must ALSO turn on for a log-scaled secondary axis,
 *      not just a log primary xScale/yScale — folded into the SAME single
 *      boolean `_apply_overrides` already reads (see its caller,
 *      `runExportFigureCommand`, for the exact OR condition).
 *  `liveViewOverrides` itself stays a pure function of raw state (and its
 *  own unit tests keep exercising it directly with no knowledge of the
 *  plotted split) — this runs ONLY at the `runExportFigureCommand` call
 *  site, once `y2Plotted`/`minorTicks` are known. */
export function gateY2Overrides(
  ov: FigureOverrides | undefined,
  opts: { y2Plotted: boolean; minorTicks: boolean },
): FigureOverrides | undefined {
  if (!ov && !opts.minorTicks) return ov;
  const { y2_lim, ticks, ...rest } = ov ?? {};
  return (
    compactOverrides({
      ...rest,
      ...(opts.y2Plotted ? { y2_lim } : {}),
      ticks: opts.minorTicks ? { ...ticks, minor: true } : ticks,
    }) ?? undefined
  );
}
