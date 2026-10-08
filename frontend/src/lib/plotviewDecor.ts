// Legend / axis-title / annotation / shape sanitizers for a persisted
// PlotView, moved verbatim out of lib/plotview.ts (module-size ratchet) and
// re-exported from there, so no importer changed. Pure; never throws.

import type { LegendPos } from "./plotview";
import type { Annotation, AxisLabelOffsets, AxisLabelStyles, Shape } from "./types";

/** The corner-preset nearest a free legend position (MAIN #18's pointer-mode
 *  drag): quadrant of the fractional position within the plot area — the
 *  double-click-to-reset gesture's pure geometry. `[0.5, 0.5]` (dead center)
 *  resolves to "ne" — an arbitrary but deterministic tie-break, never a
 *  random/unstable pick. */
export function nearestLegendCorner(fx: number, fy: number): LegendPos {
  const n = fy <= 0.5; // <= (not <): a dead-center tie resolves north
  const e = fx >= 0.5; // >= : a dead-center tie resolves east
  return n ? (e ? "ne" : "nw") : e ? "se" : "sw";
}

export function isRange(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

/** Every valid legend corner preset — exported so a consumer that needs to
 *  validate a bare `legendPos` value outside `sanitizeView` (GUI_INTERACTION
 *  #12's `decor.legend` block, `lib/plotspec2.ts`) reuses the SAME list
 *  rather than redeclaring it. */
export const LEGEND_POS: readonly LegendPos[] = ["auto", "ne", "nw", "se", "sw"];

/** A `legendXY` fraction pair: a finite 2-tuple, each component clamped to
 *  [0, 1] — a hand-edited or stale `.dwk` can't smuggle in an off-canvas
 *  position. Exported so `lib/plotspec2.ts`'s `decor.legend.xy` validator
 *  reuses this exact clamp instead of a second copy. */
export function legendXYOrNull(v: unknown): [number, number] | null {
  if (!isRange(v)) return null;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return [clamp(v[0]), clamp(v[1])];
}

/** Per-axis title offsets from a persisted view: keep only x/y/y2 keys whose
 *  value is a finite 2-tuple, each px clamped to a sane range so a stale/hand-
 *  edited `.dwk` can't fling a title far off-screen (mirrors `legendXYOrNull`'s
 *  clamp-not-drop convention). */
export function axisLabelOffsetsOrDefault(v: unknown): AxisLabelOffsets {
  const out: AxisLabelOffsets = {};
  if (!v || typeof v !== "object") return out;
  const clamp = (n: number) => Math.max(-2000, Math.min(2000, n));
  for (const k of ["x", "y", "y2"] as const) {
    const o = (v as Record<string, unknown>)[k];
    if (isRange(o)) out[k] = [clamp(o[0]), clamp(o[1])];
  }
  return out;
}

/** Per-axis title styles from a persisted view: keep only x/y/y2 keys with a
 *  sane subset of {size (clamped 6..96 px), italic, bold}; drop empties. */
export function axisLabelStylesOrDefault(v: unknown): AxisLabelStyles {
  const out: AxisLabelStyles = {};
  if (!v || typeof v !== "object") return out;
  for (const k of ["x", "y", "y2"] as const) {
    const raw = (v as Record<string, unknown>)[k];
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const style: { size?: number; italic?: boolean; bold?: boolean } = {};
    if (typeof s.size === "number" && Number.isFinite(s.size)) {
      style.size = Math.max(6, Math.min(96, s.size));
    }
    if (s.italic === true) style.italic = true;
    if (s.bold === true) style.bold = true;
    if (Object.keys(style).length) out[k] = style;
  }
  return out;
}

const ANNOTATION_ANCHORS: readonly Annotation["anchor"][] = ["data", "page"];

/** Validate a persisted annotation list (MAIN #21's `.anchor` field). The
 *  other simple overlay list in this sanitizer (`refLines`) is a structural
 *  "cast, don't deep-validate" passthrough — but `anchor` gets
 *  real validation because an unrecognized value would silently change
 *  where `annotationLayout` reads `x`/`y` FROM (data coords vs. canvas
 *  fractions): an unknown string falls back to `undefined` (= "data", the
 *  back-compat default) rather than being trusted verbatim. A `"page"`
 *  entry's `x`/`y` are canvas FRACTIONS, so they're clamped into [0, 1] —
 *  same clamp-not-drop convention as `legendXYOrNull` for the identical
 *  fraction-coordinate shape — rather than dropping the whole annotation
 *  for a stale/hand-edited out-of-range value. An entry missing the
 *  required `id`/finite `x`/`y` shape is dropped (nothing sane to fall back
 *  to for a single list entry). Never throws. Exported so GUI_INTERACTION
 *  #12's `decor` PlotSpec v2 block (`lib/plotspec2.ts`) validates a saved
 *  spec's captured annotations through the SAME sanitizer `.dwk` window
 *  restore uses — never a second, drifting copy. */
export function sanitizeAnnotations(v: unknown): Annotation[] {
  if (!Array.isArray(v)) return [];
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const out: Annotation[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.x !== "number" || typeof o.y !== "number") continue;
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
    const anchor = ANNOTATION_ANCHORS.includes(o.anchor as Annotation["anchor"])
      ? (o.anchor as Annotation["anchor"])
      : undefined;
    const isPage = anchor === "page";
    const frame = sanitizeFrame(o.frame);
    out.push({
      id: o.id,
      ...(typeof o.groupId === "string" && o.groupId ? { groupId: o.groupId } : {}),
      x: isPage ? clamp01(o.x) : o.x,
      y: isPage ? clamp01(o.y) : o.y,
      text: typeof o.text === "string" ? o.text : "",
      ...(o.axis === 0 || o.axis === 1 ? { axis: o.axis } : {}),
      ...(typeof o.size === "number" && Number.isFinite(o.size) ? { size: o.size } : {}),
      ...(anchor ? { anchor } : {}),
      ...(frame ? { frame } : {}),
    });
  }
  return out;
}

/** Validate a persisted annotation `frame` (MAIN #27's "text box" backing
 *  rect) — every field optional/independently defaulted at draw time, so
 *  this only needs to drop non-string colors and clamp `opacity`/`pad` into
 *  sane ranges; a non-object input (absent, on every pre-#27 annotation)
 *  returns null (no frame). */
function sanitizeFrame(
  v: unknown,
): { fill?: string; stroke?: string; opacity?: number; pad?: number } | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: { fill?: string; stroke?: string; opacity?: number; pad?: number } = {};
  if (typeof o.fill === "string") out.fill = o.fill;
  if (typeof o.stroke === "string") out.stroke = o.stroke;
  if (typeof o.opacity === "number" && Number.isFinite(o.opacity)) {
    out.opacity = Math.min(1, Math.max(0, o.opacity));
  }
  if (typeof o.pad === "number" && Number.isFinite(o.pad)) out.pad = Math.max(0, o.pad);
  return out;
}

const SHAPE_KINDS: readonly Shape["kind"][] = ["arrow", "line", "rect", "ellipse"];
const SHAPE_ANCHORS: readonly Shape["anchor"][] = ["data", "page"];

/** Validate a persisted shape list (MAIN #27) — the `Shape` analogue of
 *  `sanitizeAnnotations` above: an entry missing its required `id`/`kind`/
 *  finite `x1..y2` shape is dropped (nothing sane to fall back to for a
 *  single list entry); a `"page"` anchor's coords are canvas FRACTIONS,
 *  clamped into [0, 1] (same convention as a page-anchored annotation);
 *  `opacity` clamps into [0, 1]; `width` floors at a hairline (0 would be
 *  invisible AND unclickable). Never throws. Exported for the same reason
 *  as `sanitizeAnnotations` — GUI_INTERACTION #12's `decor` block reuses
 *  this exact sanitizer. */
export function sanitizeShapes(v: unknown): Shape[] {
  if (!Array.isArray(v)) return [];
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const out: Shape[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || !SHAPE_KINDS.includes(o.kind as Shape["kind"])) continue;
    const coords = [o.x1, o.y1, o.x2, o.y2];
    if (!coords.every((n): n is number => typeof n === "number" && Number.isFinite(n))) continue;
    const anchor = SHAPE_ANCHORS.includes(o.anchor as Shape["anchor"])
      ? (o.anchor as Shape["anchor"])
      : undefined;
    const isPage = anchor === "page";
    out.push({
      id: o.id,
      ...(typeof o.groupId === "string" && o.groupId ? { groupId: o.groupId } : {}),
      kind: o.kind as Shape["kind"],
      x1: isPage ? clamp01(o.x1 as number) : (o.x1 as number),
      y1: isPage ? clamp01(o.y1 as number) : (o.y1 as number),
      x2: isPage ? clamp01(o.x2 as number) : (o.x2 as number),
      y2: isPage ? clamp01(o.y2 as number) : (o.y2 as number),
      ...(anchor ? { anchor } : {}),
      ...(typeof o.stroke === "string" ? { stroke: o.stroke } : {}),
      ...(typeof o.fill === "string" ? { fill: o.fill } : {}),
      ...(typeof o.opacity === "number" && Number.isFinite(o.opacity)
        ? { opacity: clamp01(o.opacity) }
        : {}),
      ...(typeof o.width === "number" && Number.isFinite(o.width)
        ? { width: Math.max(0.5, o.width) }
        : {}),
      ...(typeof o.dash === "boolean" ? { dash: o.dash } : {}),
    });
  }
  return out;
}

/** The magnifier inset's geometry (`PlotView.inset`; `insetMode` is its
 *  visibility). The screen draws it (`Stage/InsetPlot.tsx`) and the vector
 *  export draws the same inset (`calc/figure_inset.py`), so a saved inset
 *  exports as shown. */
export interface InsetView {
  /** The source region's x range, data coordinates. */
  x: [number, number];
  /** Its y range as last drawn; `yZoom` false = autoscaled (re-ranged on redraw). */
  y: [number, number] | null;
  /** A dual-Y plot's secondary range as last drawn (zoomed with y). */
  y2?: [number, number];
  yZoom: boolean;
  /** The inset's plot area as fractions of the main plot frame:
   *  [left, top, width, height], top-origin (`legendFrameXY`'s convention). */
  at: [number, number, number, number];
  /** Connector lines from the source outline to the inset. */
  lines: boolean;
}

/** A persisted inset, or null (absent or malformed = no saved inset, so an
 *  older `.dwk` opens unchanged): finite x and y pairs (y may be absent) and a
 *  finite placement. Kept this small because it is eager: the lazy readers
 *  order-check the pairs and clamp the placement into the frame
 *  (`lib/inset.clampAt` / `insetWire`), so neither the screen nor the export
 *  ever draws a malformed one. */
export function sanitizeInset(v: unknown): InsetView | null {
  const o = v as InsetView | null;
  const at = o?.at;
  return o && isRange(o.x) && Array.isArray(at) && at.length === 4 && at.every(Number.isFinite)
    ? { x: o.x, y: isRange(o.y) ? o.y : null, ...(isRange(o.y2) && { y2: o.y2 }), yZoom: !!o.yZoom, at, lines: o.lines !== false }
    : null;
}
