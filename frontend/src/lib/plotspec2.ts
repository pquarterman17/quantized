// PlotSpec v2 — the ADDITIVE-OPTIONAL blocks (GUI_INTERACTION_PLAN #12, Slice
// 2) that extend the v1 zones+mark grammar (lib/plotspec.ts) into the
// canonical spec every surface (Stage / Graph Builder / Figure Builder /
// export) will eventually adapt over. Kept in its OWN module — plotspec.ts is
// already 600+ lines and is the review centre of the item — so plotspec.ts
// only needs a thin delegation seam (its own `version`/`display`/`axes`
// fields + a call into this module's validators from `validatePlotSpec`).
//
// ─────────────────────────────────────────────────────────────────────────
// THE BLOCKS
// ─────────────────────────────────────────────────────────────────────────
//
//   display : per-plotted-channel style override + explicit display order.
//             Field vocabulary mirrors the store's real `SeriesStyle`
//             (lib/types.ts) for the fields display actually needs today —
//             `line` (not `lineStyle`), matching `SeriesStyle.line`, is the
//             one name a first draft of this block got wrong; kept as `line`
//             here so a future Slice-3 builder call is a straight field copy,
//             never a rename. `hidden`/`axis` aren't SeriesStyle fields — they
//             capture the store's separate `hiddenChannels`/`y2Keys` arrays
//             per channel, folded into the same per-series record because
//             that's how a consumer (Figure Builder, export) wants to read
//             "how is this channel displayed" as ONE lookup.
//
//   axes    : label/limits/scale/step/format for the fixed x/y/y2 keys (a
//             per-axis map, not a fourth zone — the spec's ZONES stay data
//             bindings; axes are display). N-axis generalization stays
//             #54-specimen-gated and is not this block's job.
//
//   decor   : annotations/shapes/legend placement — the item's "part C"
//             finish (2026-07-18, landed after the 5 numbered slices).
//             `annotations`/`shapes` are the EXACT store types (`lib/
//             types.ts`), validated through the SAME sanitizers `.dwk`
//             window restore uses (`sanitizeAnnotations`/`sanitizeShapes`,
//             `lib/plotview.ts`) — never a second, drifting validator for
//             the identical shape. `legend` captures the free-placement
//             subset of the store's legend fields (`legendPos`/`legendXY`/
//             `legendTitle`) — see `LegendBlock`'s doc for exactly why
//             `legendFrameXY`/`legendStatic` are deliberately excluded.
//
//   page    : RESERVED — no fields yet, and no slice of THIS item is
//             planned to give it any. Panel/facet/layer geometry belongs to
//             ORIGIN_FILE_DECODE_PLAN #54 ("Layer/page layout fidelity" —
//             `plans/ORIGIN_FILE_DECODE_PLAN.md`), which explicitly prefers
//             "a generalized FigureDoc/page-layer model over more singleton
//             plot state branches" — that generalized model, when it lands,
//             is what fills this block. Declared now (an empty-shape
//             interface, not `unknown`) so `PlotSpec`'s field list doesn't
//             need to change shape again when #54 lands — `validatePlotSpec`
//             STRIPS any content on this key unconditionally today (no
//             validator call at all): a hand-edited or forward-authored
//             `.dwk` cannot smuggle unvalidated content onto the wire before
//             #54 defines its shape.
//
// ─────────────────────────────────────────────────────────────────────────
// VALIDATION STYLE
// ─────────────────────────────────────────────────────────────────────────
//
// Same tolerant discipline as `validatePlotSpec`: a block validator returns
// null ONLY when the input isn't an object at all; a malformed FIELD (wrong
// type, NaN/non-finite lim, unknown enum value, a non-integer series key)
// drops just that field/entry, never the whole block. A block that ends up
// with no surviving content (e.g. `{}`, or every field dropped) is still a
// valid `{}` return from the validator — it's `displayBlockHasContent` /
// `axesBlockHasContent` (the v1/v2 PROMOTION gate `plotspec.ts` calls) that
// decide whether an empty block counts as "present" for serialization. This
// split is what keeps a spec with `display: {}` from spuriously flipping to
// version 2 on re-serialize.
//
// ─────────────────────────────────────────────────────────────────────────
// PURE CAPTURE BUILDERS
// ─────────────────────────────────────────────────────────────────────────
//
// `buildDisplayBlock`/`buildAxesBlock` turn live values into a block with NO
// store import (plain args in, a block or `undefined` out) — Slice 3/5 wire
// these to the real store fields (`seriesStyles`, `y2Keys`, `hiddenChannels`,
// `seriesOrder`, the x/y/y2 label/lim/scale/step/fmt singleton fields). Both
// follow the same "all-default -> undefined" rule as the validators' empty-
// block convention: capturing a spec from a plot that never touched styling
// must not flip that spec to version 2.

import type { Annotation, AxisFormat, AxisScale, LineStyle, MarkerShape, Shape, TickMode } from "./types";
import { MARKER_SHAPES } from "./markers";
import { LEGEND_POS, legendXYOrNull, sanitizeAnnotations, sanitizeShapes, type LegendPos } from "./plotview";
import { axisFmtParam } from "./types";

// ── Display block ───────────────────────────────────────────────────────

/** A per-channel display override. Field vocabulary mirrors `SeriesStyle`
 *  (color/width/marker/markerShape/line) for the subset display needs today;
 *  `hidden`/`axis` are NOT SeriesStyle fields — see the module doc. */
export interface SeriesDisplay {
  color?: string;
  width?: number;
  marker?: boolean;
  markerShape?: MarkerShape;
  line?: LineStyle;
  hidden?: boolean;
  /** Which Y scale this channel plots on: 0/undefined = primary, 1 =
   *  secondary (y2) — same convention as `Annotation.axis`/`SeriesStyle.axis`
   *  is NOT a real field (the store keys this via `y2Keys` instead), so this
   *  is the display block's own capture of that membership. */
  axis?: 0 | 1;
}

/** Per-series overrides (keyed by dataset *channel index*, matching every
 *  other channel-keyed record in the store) plus the explicit display order
 *  of the plotted channels. Both optional — a block need not carry either. */
export interface DisplayBlock {
  series?: Record<number, SeriesDisplay>;
  order?: number[];
}

// ── Axes block ───────────────────────────────────────────────────────────

/** One axis's display config — the v2 analogue of the store's per-axis
 *  singleton fields (`xLabel`/`xLim`/`xScale`/`xStep`/`xFmt`, mirrored for
 *  y/y2). All optional; an axis with nothing to say about it is omitted from
 *  `AxesBlock` entirely (see `axesBlockHasContent`). */
export interface AxisSpecV2 {
  label?: string;
  lim?: [number, number];
  scale?: AxisScale;
  step?: number;
  fmt?: AxisFormat;
}

/** Axes display config for the fixed x/y/y2 keys, plus the plot title.
 *  N-axis generalization is out of scope (stays #54-specimen-gated). */
export interface AxesBlock {
  x?: AxisSpecV2;
  y?: AxisSpecV2;
  y2?: AxisSpecV2;
  title?: string;
}

// ── Decor block (annotations/shapes/legend — "part C") ───────────────────

/** Free legend PLACEMENT (`pos`/`xy`) + its Origin-decode TITLE header — the
 *  subset of the store's FIVE legend-adjacent fields (`legendPos`/
 *  `legendXY`/`legendFrameXY`/`legendStatic`/`legendTitle`) a Graph Builder
 *  save can meaningfully capture/reapply. `legendFrameXY` (Origin's
 *  frame-anchored placement) and `legendStatic` (Origin's read-only legend
 *  chrome) are deliberately OUT of this block: both are decode-only
 *  artifacts `applyOriginFigure` writes with a direct `set()` call — no
 *  setter exists for either at all (unlike `legendPos`/`legendXY`'s real
 *  `setLegendPos`/`setLegendXY` actions), so there is nothing for
 *  `plotspecApply.ts` to push even if they were captured here. A
 *  hand-styled Graph Builder plot never has either field set, so this gap
 *  only ever touches an Origin-imported legend's exact frame anchor — a
 *  fidelity concern of the Origin import path itself, not the canonical
 *  spec. `title` mirrors `axes.*.step`'s existing precedent: captured for
 *  round-trip fidelity even though `plotspecApply.ts` currently has no
 *  `setLegendTitle` action to push it back through (documented there, not
 *  silently dropped). */
export interface LegendBlock {
  pos?: LegendPos;
  xy?: [number, number];
  title?: string;
}

/** Drawn overlays + legend placement (the item's "part C" finish —
 *  annotations/shapes/legend). `annotations`/`shapes` reuse the EXACT store
 *  types (`lib/types.ts`) and are validated through the SAME sanitizers
 *  `.dwk` window restore uses (`sanitizeAnnotations`/`sanitizeShapes`,
 *  `lib/plotview.ts`) — never a second, drifting validator for the
 *  identical shape. Both are GLOBAL plot overlays (not channel-scoped like
 *  `display.series`), so there's no "plotted subset" filter the way
 *  `buildDisplayBlock` filters by channel — a capture takes the plot's
 *  WHOLE annotation/shape list. */
export interface DecorBlock {
  annotations?: Annotation[];
  shapes?: Shape[];
  legend?: LegendBlock;
}

// ── Reserved blocks (content lands with a later, larger effort) ──────────

/** Reserved — see the module doc's "page" entry: panel/facet/layer geometry
 *  belongs to ORIGIN_FILE_DECODE_PLAN #54, not a slice of this item. No
 *  fields yet; `validatePlotSpec` strips any content on this key
 *  unconditionally. */
export interface PageBlock {
  readonly __reserved?: never;
}

// ── Small validation primitives ───────────────────────────────────────────

const LINE_STYLES: readonly LineStyle[] = ["solid", "dashed", "dotted"];
const AXIS_SCALES: readonly AxisScale[] = ["linear", "log", "reciprocal"];
const TICK_MODES: readonly TickMode[] = ["auto", "fixed", "sci", "eng"];
const MARKER_SHAPE_VALUES: ReadonlySet<MarkerShape> = new Set(MARKER_SHAPES.map((m) => m.value));

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Line width: 0 is a real, meaningful value (marker-only "scatter" preset —
 *  see SeriesStyleCard's trace-type toggle), so this allows zero; only a
 *  negative or absurd (>100 px) width drops. */
function isValidWidth(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 100;
}

function isRange(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && isFiniteNumber(v[0]) && isFiniteNumber(v[1]);
}

function isAxisFormat(v: unknown): v is AxisFormat {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.mode === "string" &&
    (TICK_MODES as readonly string[]).includes(o.mode) &&
    isFiniteNumber(o.digits)
  );
}

// ── Display block validation ──────────────────────────────────────────────

function validateSeriesDisplay(v: unknown): SeriesDisplay | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: SeriesDisplay = {};
  if (typeof o.color === "string") out.color = o.color;
  if (isValidWidth(o.width)) out.width = o.width;
  if (typeof o.marker === "boolean") out.marker = o.marker;
  if (typeof o.markerShape === "string" && MARKER_SHAPE_VALUES.has(o.markerShape as MarkerShape)) {
    out.markerShape = o.markerShape as MarkerShape;
  }
  if (typeof o.line === "string" && (LINE_STYLES as readonly string[]).includes(o.line)) {
    out.line = o.line as LineStyle;
  }
  if (typeof o.hidden === "boolean") out.hidden = o.hidden;
  if (o.axis === 0 || o.axis === 1) out.axis = o.axis;
  return out;
}

/** Validate + normalize an arbitrary value into a `DisplayBlock`, or null if
 *  the input isn't even an object. Tolerant per-FIELD/per-ENTRY: a malformed
 *  series entry, an unknown enum value, or a non-integer channel key drops
 *  just that piece — never nulls the whole block. See the module doc for why
 *  an empty (but non-null) result is still a valid return here. */
export function validateDisplayBlock(v: unknown): DisplayBlock | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: DisplayBlock = {};
  if (typeof o.series === "object" && o.series !== null) {
    const series: Record<number, SeriesDisplay> = {};
    for (const [key, val] of Object.entries(o.series as Record<string, unknown>)) {
      const channel = Number(key);
      if (!Number.isInteger(channel)) continue;
      const sd = validateSeriesDisplay(val);
      if (sd && Object.keys(sd).length > 0) series[channel] = sd;
    }
    if (Object.keys(series).length > 0) out.series = series;
  }
  if (Array.isArray(o.order)) {
    const order = o.order.filter((n): n is number => typeof n === "number" && Number.isInteger(n));
    if (order.length > 0) out.order = order;
  }
  return out;
}

/** Is this a `DisplayBlock` with actual content (as opposed to `null`/`{}`)?
 *  The v1/v2 promotion gate `plotspec.ts` uses. */
export function displayBlockHasContent(b: DisplayBlock | null | undefined): b is DisplayBlock {
  if (!b) return false;
  return (
    (b.series !== undefined && Object.keys(b.series).length > 0) ||
    (b.order !== undefined && b.order.length > 0)
  );
}

// ── Axes block validation ─────────────────────────────────────────────────

function validateAxisSpec(v: unknown): AxisSpecV2 | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: AxisSpecV2 = {};
  if (typeof o.label === "string") out.label = o.label;
  if (isRange(o.lim)) out.lim = o.lim;
  if (typeof o.scale === "string" && (AXIS_SCALES as readonly string[]).includes(o.scale)) {
    out.scale = o.scale as AxisScale;
  }
  if (isFiniteNumber(o.step)) out.step = o.step;
  if (isAxisFormat(o.fmt)) out.fmt = o.fmt;
  return out;
}

/** Validate + normalize an arbitrary value into an `AxesBlock`, or null if
 *  the input isn't even an object. Same per-field tolerance as
 *  `validateDisplayBlock`. */
export function validateAxesBlock(v: unknown): AxesBlock | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: AxesBlock = {};
  const x = validateAxisSpec(o.x);
  if (x && Object.keys(x).length > 0) out.x = x;
  const y = validateAxisSpec(o.y);
  if (y && Object.keys(y).length > 0) out.y = y;
  const y2 = validateAxisSpec(o.y2);
  if (y2 && Object.keys(y2).length > 0) out.y2 = y2;
  if (typeof o.title === "string") out.title = o.title;
  return out;
}

/** Is this an `AxesBlock` with actual content? The v1/v2 promotion gate. */
export function axesBlockHasContent(b: AxesBlock | null | undefined): b is AxesBlock {
  if (!b) return false;
  return b.x !== undefined || b.y !== undefined || b.y2 !== undefined || b.title !== undefined;
}

// ── Decor block validation ────────────────────────────────────────────────

function validateLegendBlock(v: unknown): LegendBlock | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: LegendBlock = {};
  if (typeof o.pos === "string" && (LEGEND_POS as readonly string[]).includes(o.pos)) {
    out.pos = o.pos as LegendPos;
  }
  const xy = legendXYOrNull(o.xy);
  if (xy) out.xy = xy;
  if (typeof o.title === "string") out.title = o.title;
  return out;
}

/** Validate + normalize an arbitrary value into a `DecorBlock`, or null if
 *  the input isn't even an object. `annotations`/`shapes` delegate entirely
 *  to `sanitizeAnnotations`/`sanitizeShapes` (per-entry tolerant, same as
 *  every `.dwk` window restore — this function never re-validates their
 *  internals a second way). `legend` gets the same per-field tolerance as
 *  `validateAxesBlock`. */
export function validateDecorBlock(v: unknown): DecorBlock | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const out: DecorBlock = {};
  const annotations = sanitizeAnnotations(o.annotations);
  if (annotations.length > 0) out.annotations = annotations;
  const shapes = sanitizeShapes(o.shapes);
  if (shapes.length > 0) out.shapes = shapes;
  const legend = validateLegendBlock(o.legend);
  if (legend && Object.keys(legend).length > 0) out.legend = legend;
  return out;
}

/** Is this a `DecorBlock` with actual content? The v1/v2 promotion gate. */
export function decorBlockHasContent(b: DecorBlock | null | undefined): b is DecorBlock {
  if (!b) return false;
  return (
    (b.annotations !== undefined && b.annotations.length > 0) ||
    (b.shapes !== undefined && b.shapes.length > 0) ||
    b.legend !== undefined
  );
}

// ── Pure capture builders (no store import — Slice 3/5/"part C" wire these) ─

/** The live per-channel style shape `buildDisplayBlock` reads — the subset
 *  of `SeriesStyle` the display block captures (see the module doc for why
 *  `fill`/`colorBy`/`colormap`/`markerSize` aren't part of v2 yet). */
export type SeriesDisplayStyle = Pick<SeriesDisplay, "color" | "width" | "marker" | "markerShape" | "line">;

/** Capture a `DisplayBlock` from live styling + display state, for the
 *  PLOTTED channels only. `styles` is the store's `seriesStyles` map (or a
 *  plain test double); `plotted` is the channel indices currently shown (in
 *  their natural/ascending order — the caller decides what "plotted" means);
 *  `y2Keys`/`hiddenChannels` mirror the store fields of the same name;
 *  `seriesOrder` is the store's explicit display-order override (`null` =
 *  no override, i.e. ascending). Returns `undefined` when every plotted
 *  channel is fully default AND the order matches ascending-plotted — an
 *  all-default capture must never flip a spec to version 2. */
export function buildDisplayBlock(
  styles: Record<number, SeriesDisplayStyle>,
  plotted: number[],
  y2Keys: number[] | null,
  hiddenChannels: number[],
  seriesOrder: number[] | null,
): DisplayBlock | undefined {
  const y2Set = new Set(y2Keys ?? []);
  const hiddenSet = new Set(hiddenChannels);
  const series: Record<number, SeriesDisplay> = {};
  for (const ch of plotted) {
    const s = styles[ch];
    const sd: SeriesDisplay = {};
    if (s?.color !== undefined) sd.color = s.color;
    if (s?.width !== undefined) sd.width = s.width;
    if (s?.marker !== undefined) sd.marker = s.marker;
    if (s?.markerShape !== undefined) sd.markerShape = s.markerShape;
    if (s?.line !== undefined) sd.line = s.line;
    if (hiddenSet.has(ch)) sd.hidden = true;
    if (y2Set.has(ch)) sd.axis = 1;
    if (Object.keys(sd).length > 0) series[ch] = sd;
  }
  const ascending = [...plotted].sort((a, b) => a - b);
  const orderDiffers =
    seriesOrder !== null &&
    seriesOrder.length > 0 &&
    (seriesOrder.length !== ascending.length || seriesOrder.some((v, i) => v !== ascending[i]));

  const block: DisplayBlock = {};
  if (Object.keys(series).length > 0) block.series = series;
  if (orderDiffers) block.order = [...(seriesOrder as number[])];
  return displayBlockHasContent(block) ? block : undefined;
}

/** The live values `buildAxesBlock` reads — plain args mirroring the store's
 *  per-axis singleton fields. Blank/default values are omitted per-field
 *  (see the doc below); `y2Fmt` follows its own store default of `null`
 *  ("inherit yFmt") — captured only when non-null, so an unset y2Fmt never
 *  flips a spec to version 2 (same inherit-semantics as `y2Scale`'s `null`,
 *  but fmt's non-null default is NOT itself a real override to preserve). */
export interface AxesBlockArgs {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  y2Label?: string;
  xLim?: [number, number] | null;
  yLim?: [number, number] | null;
  y2Lim?: [number, number] | null;
  /** Default "linear" — captured only when it differs (matches the store's
   *  own default for `xScale`/`yScale`). */
  xScale?: AxisScale;
  yScale?: AxisScale;
  /** Default `null` ("inherit the primary Y scale") — captured whenever
   *  explicitly set, INCLUDING an explicit "linear" (unlike x/y, "linear"
   *  here is a real override of the inherit-default, not itself the
   *  default). */
  y2Scale?: AxisScale | null;
  xStep?: number | null;
  yStep?: number | null;
  xFmt?: AxisFormat;
  yFmt?: AxisFormat;
  /** null/undefined = inherit yFmt (the compatibility default) — captured
   *  ONLY when explicitly set to a real format. */
  y2Fmt?: AxisFormat | null;
}

function captureAxisSpec(
  label: string | undefined,
  lim: [number, number] | null | undefined,
  scale: AxisScale | undefined,
  defaultScale: AxisScale | undefined,
  step: number | null | undefined,
  fmt: AxisFormat | undefined,
): AxisSpecV2 {
  const out: AxisSpecV2 = {};
  if (label) out.label = label;
  if (lim != null) out.lim = lim;
  if (scale !== undefined && scale !== defaultScale) out.scale = scale;
  if (step != null) out.step = step;
  const f = fmt ? axisFmtParam(fmt) : undefined;
  if (f) out.fmt = f;
  return out;
}

/** Capture an `AxesBlock` from live axis state. Returns `undefined` when
 *  every axis (and the title) is fully default — an all-default capture must
 *  never flip a spec to version 2. Blank labels ("") are treated as absent,
 *  matching the store's own empty-string default for the label fields. */
export function buildAxesBlock(args: AxesBlockArgs): AxesBlock | undefined {
  const x = captureAxisSpec(args.xLabel, args.xLim, args.xScale, "linear", args.xStep, args.xFmt);
  const y = captureAxisSpec(args.yLabel, args.yLim, args.yScale, "linear", args.yStep, args.yFmt);
  // y2Scale's default is `null` (inherit), not "linear" — pass a
  // never-matching sentinel default so an explicit "linear" still captures.
  // y2Fmt's own `null` (inherit yFmt) collapses to `undefined` here so
  // captureAxisSpec's `fmt ? ... : undefined` never captures the inherit
  // default (see AxesBlockArgs's doc — inherit must never flip a spec to v2).
  const y2 = captureAxisSpec(
    args.y2Label,
    args.y2Lim,
    args.y2Scale ?? undefined,
    undefined,
    undefined,
    args.y2Fmt ?? undefined,
  );

  const block: AxesBlock = {};
  if (Object.keys(x).length > 0) block.x = x;
  if (Object.keys(y).length > 0) block.y = y;
  if (Object.keys(y2).length > 0) block.y2 = y2;
  if (args.title) block.title = args.title;
  return axesBlockHasContent(block) ? block : undefined;
}

/** The live legend-placement fields `buildDecorBlock` reads — the store's
 *  `legendPos`/`legendXY`/`legendTitle` (see `LegendBlock`'s doc for why
 *  `legendFrameXY`/`legendStatic` aren't part of v2 yet). */
export interface DecorLegendArgs {
  pos: LegendPos;
  xy: [number, number] | null;
  title: string | null;
}

/** Capture a `DecorBlock` from live annotations/shapes/legend state.
 *  Returns `undefined` when there's nothing to capture (no annotations, no
 *  shapes, and the legend sits at its default corner with no free position
 *  and no title) — an all-default capture must never flip a spec to version
 *  2, the same rule `buildDisplayBlock`/`buildAxesBlock` follow.
 *  `annotations`/`shapes` are captured verbatim (both are GLOBAL plot state,
 *  not channel-scoped, so there's no "plotted subset" to filter the way
 *  `buildDisplayBlock` filters by channel). */
export function buildDecorBlock(
  annotations: readonly Annotation[],
  shapes: readonly Shape[],
  legend: DecorLegendArgs,
): DecorBlock | undefined {
  const block: DecorBlock = {};
  if (annotations.length > 0) block.annotations = [...annotations];
  if (shapes.length > 0) block.shapes = [...shapes];
  const legendBlock: LegendBlock = {};
  // "ne" is legendPos's default (store/useApp.ts's initial state) — only a
  // real deviation counts as a captured override, mirroring buildAxesBlock's
  // xScale/yScale "captured only when it differs from default" rule.
  if (legend.pos !== "ne") legendBlock.pos = legend.pos;
  if (legend.xy != null) legendBlock.xy = legend.xy;
  if (legend.title) legendBlock.title = legend.title;
  if (Object.keys(legendBlock).length > 0) block.legend = legendBlock;
  return decorBlockHasContent(block) ? block : undefined;
}
