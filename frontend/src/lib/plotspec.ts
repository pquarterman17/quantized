// Plot-spec grammar (ORIGIN_GAP_PLAN #51, Graph Builder phase 2) — the CONTRACT
// every later "build a graph" feature (figures, templates, macros, faceting)
// replays. A PlotSpec is a small, serializable, dataset-by-id description of
// what to plot; the pure functions here turn zone assignments into a concrete
// mark and a render payload. No React / store / fetch — everything is plain
// data in, plain data out, so every rule below unit-tests standalone (this file
// is the review centre of the item).
//
// ─────────────────────────────────────────────────────────────────────────────
// THE GRAMMAR (read this before touching anything)
// ─────────────────────────────────────────────────────────────────────────────
//
// A spec has six ZONES and one MARK:
//
//   zones.x     : ChannelRef | null   — the horizontal / category axis
//   zones.y     : ChannelRef[]         — the value axis (one or more series)
//   zones.group : ChannelRef | null   — a categorical split into coloured series
//   zones.facet : ChannelRef | null   — small-multiples key (TYPED-BUT-INERT in
//                                        v1; activates with GAP_PLOTTYPES #5)
//   zones.yErr  : ChannelRef[]        — Y error columns, POSITION-paired with
//                                        `y` (yErr[i] describes y[i]); XY
//                                        family only (#51 phase 3)
//   zones.xErr  : ChannelRef | null   — X error column; XY family only
//
//   mark        : "scatter" | "line" | "box" | "violin" | "bar"
//
// A ChannelRef is `{ datasetId, channel }` — by id, not by object identity, so
// a spec survives a .dwk round-trip and a dataset re-import. `channel` is a
// value-column index (0-based, matching the #49 channel-drag payload); a
// negative index denotes the dataset's x/time column (continuous by definition).
//
// MARK MORPHING (inferMark / validMarks / cycleMark)
// --------------------------------------------------
// The mark is derived from the modeling types of the zoned channels
// (lib/modeling.ts: continuous / ordinal / nominal), driven by the X well:
//
//   • X continuous (or empty) + ≥1 Y     → the "xy" FAMILY  → scatter | line
//         - default: scatter, UNLESS the X channel's values are sorted-monotonic,
//           in which case a connecting line is the honest default (a line across
//           unsorted x would draw a meaningless zig-zag, so we never default to
//           line without monotonic evidence).
//         - group zone → one coloured series per group level (a "colour split").
//   • X categorical (nominal/ordinal) + ≥1 Y → the "categorical" FAMILY
//                                              → box | violin | bar
//         - the Y[0] value column is grouped BY the X category column.
//         - the user cycles box → violin → bar → box on tap (cycleMark).
//   • no Y (or no channels at all)         → incomplete: no mark, no render.
//
// inferMark is STICKY WITHIN A FAMILY and SNAPS ACROSS families: if the current
// mark is still valid for the new zones it is kept (so a user who cycled to
// violin keeps violin when they add a second Y), otherwise it snaps to the
// family default. This is what makes "swap a nominal column onto X" morph a
// scatter into a box, and swapping a continuous column back morph it to scatter.
//
// RENDER (specToRender)
// ---------------------
// specToRender resolves the spec's dataset (by the zones' shared datasetId),
// reads its ANALYSIS view (lib/rowstate.analysisData — exclusion #50 + filter
// #53 honoured, guard #11), and returns ONE of:
//
//   { kind: "xy",  payload }   — a lib/plotdata PlotPayload (scatter/line; the
//                                ordinary uPlot path). `grouped` flags a colour
//                                split so the caller can label it. `facets`
//                                (GAP_PLOTTYPES #5, only when zones.facet is
//                                set) is one payload per facet-column level
//                                (lib/facet.facetPayloads) — small multiples
//                                for the xy family only in v1.
//   { kind: "box", boxes, … }  — client box-stats (lib/statstage) for the
//                                stat-stage renderer (statRender.ts). `violin`
//                                flags that the user asked for violin — the pure
//                                path can only compute box stats offline, so the
//                                mini-preview shows a box and the real KDE
//                                renders once the spec reaches the live stat
//                                stage (the exact degrade useStatStage uses).
//                                `facets` (GUI_INTERACTION #11, only when
//                                zones.facet is set) is one box set per
//                                facet-column level (lib/facet.facetSlices):
//                                the SAME groupCol/valueCol grouping the flat
//                                `boxes` field runs, re-run per slice — a
//                                level whose slice groups to nothing finite is
//                                dropped, and the field is omitted entirely
//                                when every level drops. The flat fields
//                                always stay computed from ALL rows (fallback
//                                + back-compat for a caller that ignores
//                                facets).
//   { kind: "bar", data, … }   — a lib/barlayout BarChartData (GAP_PLOTTYPES
//                                #4 categorical plots) for the SAME stat-stage
//                                renderer's "bar" mode (statRender.ts). The Y
//                                zone's channels become the clustered series.
//                                `facets` mirrors the box variant's: one
//                                matrix per facet-column level, same drop/
//                                omit rules, flat `data` unaffected.
//   { kind: "message", … }     — nothing to draw yet: tone "hint" = the spec is
//                                incomplete (drop more channels); tone "note" =
//                                the combo can't render (e.g. bar with a
//                                non-categorical X).
//
// SERIALIZATION (serialize / deserialize / validate)
// --------------------------------------------------
// serializePlotSpec → a JSON string; deserializePlotSpec / validatePlotSpec
// round-trip it back to a normalized PlotSpec (or null for anything malformed),
// so a figure / template / macro can persist and replay a built graph. The
// `version` tag is the migration seam: a spec is version 1 (today's exact
// zones+mark shape, byte-stable) unless at least one v2 block (`display`/
// `axes`/`decor`) survives validation with actual content, in which case it
// serializes as version 2 — the block GRAMMAR itself (SeriesDisplay/
// AxesBlock/DecorBlock/the reserved `page` placeholder + their validators/
// pure capture builders) lives in `./plotspec2` (GUI_INTERACTION_PLAN #12,
// Slices 2 + "part C"); this module only owns the top-level version/
// promotion seam.

import { buildBarMatrix, type BarChartData } from "./barlayout";
import { buildErrorSpans, type ErrorSpan } from "./errorbars";
import { inferErrorBindings, type ErrorBinding } from "./errorRoles";
import { facetPayloads, facetSlices, type FacetPanel } from "./facet";
import { channelModelingType, isCategorical } from "./modeling";
import { buildColumns, type PlotPayload } from "./plotdata";
import {
  axesBlockHasContent,
  decorBlockHasContent,
  displayBlockHasContent,
  validateAxesBlock,
  pageBlockHasContent,
  validateDecorBlock,
  validateDisplayBlock,
  validatePageBlock,
  type AxesBlock,
  type DecorBlock,
  type DisplayBlock,
  type PageBlock,
} from "./plotspec2";
import { analysisData } from "./rowstate";
import {
  type BoxStat,
  groupBoxStatsClient,
  resolveGroups,
} from "./statstage";
import type { DataStruct, Dataset, ModelingType, SeriesStyle, StepMode } from "./types";

export type { StepMode } from "./types";

export type {
  AxesBlock,
  AxisSpecV2,
  DecorBlock,
  DisplayBlock,
  PageBlock,
  SeriesDisplay,
} from "./plotspec2";

// ── Types ────────────────────────────────────────────────────────────────────

/** A reference to one channel of one dataset, BY ID (survives .dwk). `channel`
 *  is a value-column index (0-based); a negative index means the x/time column. */
export interface ChannelRef {
  datasetId: string;
  channel: number;
}

/** The mark (glyph) a spec renders with. */
export type PlotMark = "scatter" | "line" | "step" | "box" | "violin" | "bar";

/** The six drop wells. `facet` is typed from day one but inert in v1.
 *  `yErr`/`xErr` (ORIGIN_GAP_PLAN #51 phase 3 — the COLUMN-DESIGNATION
 *  model) are XY-family only: any scatter/line/step mark can carry error
 *  bars, but a categorical mark (box/violin/bar) ignores them entirely — see
 *  `specErrorBindings`'s doc. */
export type ZoneName = "x" | "y" | "group" | "facet" | "yErr" | "xErr";

export interface PlotZones {
  x: ChannelRef | null;
  y: ChannelRef[];
  group: ChannelRef | null;
  facet: ChannelRef | null;
  /** Y error columns, POSITION-paired with `y`: `yErr[i]` describes `y[i]`.
   *  Never longer than `y` after validation (a trailing unpaired entry is
   *  invalid — position-pairing has no way to express "an error for a Y that
   *  isn't there"). Every well drop is symmetric; there is no +/- half here
   *  (see the Inspector's richer Error columns card for that). */
  yErr: ChannelRef[];
  /** X error column (single well, like `x`/`group`/`facet`). */
  xErr: ChannelRef | null;
}

export interface PlotSpec {
  /** 1 = today's zones+mark shape only (byte-stable). 2 = at least one v2
   *  block below carries actual content. Always RECOMPUTED by
   *  `validatePlotSpec`/`serializePlotSpec` from the blocks' presence —
   *  never trust an incoming `version` tag as authoritative on its own. */
  version: 1 | 2;
  zones: PlotZones;
  mark: PlotMark;
  /** Alignment for the "step" mark (GAP_PLOTTYPES). Ignored by every other
   *  mark. Undefined = "post" (see `StepMode`'s doc for why that's the
   *  right default). Part of the byte-stable v1 shape (a sibling of `mark`,
   *  not a v2 "block" — never affects `version`). */
  stepMode?: StepMode;
  /** Origin's "Line + Symbol": overlay point markers on a connected mark.
   *  Applies to "line"/"step" only — "scatter" always shows markers by
   *  definition, so this field is meaningless (and ignored) there. Undefined/
   *  false = today's plain-line behavior. Same byte-stable-v1 sibling-of-
   *  `mark` status as `stepMode`. */
  showMarkers?: boolean;
  /** Per-series style override + explicit display order (Slice 2 schema;
   *  wired by Slice 3/5). Omitted entirely (not even `undefined`-valued) when
   *  empty — see `./plotspec2` for the grammar + validators/builders. */
  display?: DisplayBlock;
  /** Axis label/limits/scale/step/format + plot title (Slice 2 schema; wired
   *  by Slice 5). Same omit-when-empty rule as `display`. */
  axes?: AxesBlock;
  /** Page/panel presentation — stacking, fit mode, physical page model
   *  (ORIGIN_FILE_DECODE_PLAN #54 pass C; reserved-and-stripped before that).
   *  Same omit-when-empty rule as `display`/`axes`. The composition itself is
   *  deliberately not serialized here — see `./plotspec2`'s `PageBlock`. */
  page?: PageBlock;
  /** Annotations/shapes/legend placement (the item's "part C" finish; wired
   *  by `lib/plotspecApply.ts` on an explicit plot action). Same omit-when-empty rule as
   *  `display`/`axes` — see `./plotspec2`'s doc. */
  decor?: DecorBlock;
}

/** Every mark, in declaration order (also the validation allow-list). */
export const PLOT_MARKS: readonly PlotMark[] = ["scatter", "line", "step", "box", "violin", "bar"];

/** Which "shape" a set of zones renders as. `null` = incomplete (no Y). */
export type MarkFamily = "xy" | "categorical";

const XY_MARKS: readonly PlotMark[] = ["scatter", "line", "step"];
const CATEGORICAL_MARKS: readonly PlotMark[] = ["box", "violin", "bar"];

/** The context inferMark needs: a channel-ref → modeling-type lookup plus an
 *  (optional) data-derived hint of whether the X channel is sorted-monotonic.
 *  Passing it explicitly keeps inferMark pure + trivially unit-testable; build
 *  a real one from live datasets with `markContext`. */
export interface MarkContext {
  typeOf: (ref: ChannelRef) => ModelingType;
  /** Whether X's values run monotonically (data-derived). `undefined` = unknown
   *  → the xy family defaults to scatter (never guess a connecting line). */
  xMonotonic?: boolean;
}

// ── Constructors / small helpers ─────────────────────────────────────────────

/** An empty spec: no zones filled, mark defaults to scatter (harmless until a
 *  Y lands and inferMark takes over). */
export function emptySpec(): PlotSpec {
  return {
    version: 1,
    zones: { x: null, y: [], group: null, facet: null, yErr: [], xErr: null },
    mark: "scatter",
  };
}

/** Structural ChannelRef equality (same dataset + channel). */
export function channelRefEq(a: ChannelRef | null, b: ChannelRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.datasetId === b.datasetId && a.channel === b.channel;
}

/** The dataset a spec targets: the id shared by its filled zones (X wins, then
 *  the first Y, then group/facet). null when no zone is filled. v1 is
 *  single-dataset; a mixed-dataset spec resolves to its X/Y[0] dataset. */
export function specDatasetId(spec: PlotSpec): string | null {
  const z = spec.zones;
  return (z.x ?? z.y[0] ?? z.group ?? z.facet)?.datasetId ?? null;
}

/** Is any renderable zone filled (X, a Y, or group)? Facet alone is not
 *  renderable in v1. */
export function specHasContent(spec: PlotSpec): boolean {
  return spec.zones.x !== null || spec.zones.y.length > 0 || spec.zones.group !== null;
}

// ── Zone assignment (pure spec transforms) ───────────────────────────────────

/** Assign `ref` into `zone`. Single-slot zones (x / group / facet) replace;
 *  the y list appends (de-duped by channel). Does NOT recompute the mark — call
 *  `withInferredMark` after, so the caller controls the context. */
export function assignZone(spec: PlotSpec, zone: ZoneName, ref: ChannelRef): PlotSpec {
  const zones = { ...spec.zones };
  if (zone === "y") {
    if (!zones.y.some((r) => channelRefEq(r, ref))) zones.y = [...zones.y, ref];
  } else if (zone === "yErr") {
    if (!zones.yErr.some((r) => channelRefEq(r, ref))) zones.yErr = [...zones.yErr, ref];
  } else {
    zones[zone] = ref;
  }
  return { ...spec, zones };
}

/** Remove `ref` from `zone` (or clear a single-slot zone when `ref` omitted). */
export function clearZone(spec: PlotSpec, zone: ZoneName, ref?: ChannelRef): PlotSpec {
  const zones = { ...spec.zones };
  if (zone === "y") {
    zones.y = ref ? zones.y.filter((r) => !channelRefEq(r, ref)) : [];
  } else if (zone === "yErr") {
    zones.yErr = ref ? zones.yErr.filter((r) => !channelRefEq(r, ref)) : [];
  } else {
    zones[zone] = null;
  }
  return { ...spec, zones };
}

/** Move one Y series by one display-order slot. This changes only the
 * explicit PlotSpec list; it never mutates worksheet columns or source-row
 * acquisition order. Boundary/missing moves preserve object identity. */
export function moveYZone(spec: PlotSpec, ref: ChannelRef, direction: -1 | 1): PlotSpec {
  const index = spec.zones.y.findIndex((candidate) => channelRefEq(candidate, ref));
  const target = index + direction;
  if (index < 0 || target < 0 || target >= spec.zones.y.length) return spec;
  const y = [...spec.zones.y];
  [y[index], y[target]] = [y[target], y[index]];
  return { ...spec, zones: { ...spec.zones, y } };
}

/** The channel indices assigned to a zone (0..n; a single-slot zone yields 0 or
 *  1 entry). Handy for the UI's "assigned chips" rendering. */
export function zoneChannels(spec: PlotSpec, zone: ZoneName): number[] {
  const z = spec.zones;
  if (zone === "y") return z.y.map((r) => r.channel);
  if (zone === "yErr") return z.yErr.map((r) => r.channel);
  const ref = z[zone];
  return ref ? [ref.channel] : [];
}

// ── Mark morphing ────────────────────────────────────────────────────────────

/** Which family the current zones render as, or null when incomplete (no Y).
 *  The X well's modeling type is the switch: categorical X → categorical family,
 *  otherwise (continuous or empty X) → xy family. */
export function markFamily(spec: PlotSpec, ctx: MarkContext): MarkFamily | null {
  if (spec.zones.y.length === 0) return null;
  const x = spec.zones.x;
  if (x && isCategorical(ctx.typeOf(x))) return "categorical";
  return "xy";
}

/** The marks the user may cycle through for the current zones (empty when the
 *  spec is incomplete). */
export function validMarks(spec: PlotSpec, ctx: MarkContext): PlotMark[] {
  const fam = markFamily(spec, ctx);
  if (fam === null) return [];
  return fam === "categorical" ? [...CATEGORICAL_MARKS] : [...XY_MARKS];
}

/** The natural default mark for the current zones: box for a categorical combo;
 *  line for a monotonic-x continuous combo, else scatter. */
export function defaultMark(spec: PlotSpec, ctx: MarkContext): PlotMark {
  const fam = markFamily(spec, ctx);
  if (fam === "categorical") return "box";
  return ctx.xMonotonic === true ? "line" : "scatter";
}

/** The mark to show for the current zones: STICKY within a family (keep the
 *  user's current mark if it is still valid), SNAP across families (fall back to
 *  the family default). Returns the current mark unchanged when the spec is
 *  incomplete (nothing to infer from yet). */
export function inferMark(spec: PlotSpec, ctx: MarkContext): PlotMark {
  const marks = validMarks(spec, ctx);
  if (marks.length === 0) return spec.mark;
  if (marks.includes(spec.mark)) return spec.mark;
  return defaultMark(spec, ctx);
}

/** The next mark in the current family's cycle (box → violin → bar → box;
 *  scatter → line → scatter). No-op (returns the current mark) when the family
 *  offers no alternative. */
export function cycleMark(spec: PlotSpec, ctx: MarkContext): PlotMark {
  const marks = validMarks(spec, ctx);
  if (marks.length === 0) return spec.mark;
  const i = marks.indexOf(spec.mark);
  return marks[(i + 1) % marks.length];
}

/** Re-derive the mark for a spec via inferMark and return the updated spec —
 *  the one-liner every zone edit calls after mutating the zones. */
export function withInferredMark(spec: PlotSpec, ctx: MarkContext): PlotSpec {
  const mark = inferMark(spec, ctx);
  return mark === spec.mark ? spec : { ...spec, mark };
}

/** Translate a spec's `mark` (+ `stepMode`/`showMarkers`) into the per-Y-
 *  channel `SeriesStyle` patch the Stage understands — the Graph Builder
 *  "commit to plot" bridge (GAP_PLOTTYPES). The Stage has no `line: "none"`
 *  field; a ZERO `width` IS "no line" (marker-only), which is exactly the
 *  mechanism the Inspector's own trace toggle already uses (see
 *  `components/Inspector/SeriesStyleCard.tsx`'s `setTrace`):
 *
 *    "scatter"        → { width: 0, marker: true }         (always markers)
 *    "step"           → { step, ...(showMarkers && marker) } (nonzero width)
 *    "line" (default) → { } or { marker: true } when showMarkers
 *
 *  Returns `{}` for a plain line with no markers — the caller should treat
 *  an empty result as "nothing to override" (today's ambient defaults still
 *  apply) rather than skip the call outright; either is safe since
 *  `setSeriesStyle` merges. Pure — no store/React import, unit-testable
 *  standalone like every other function in this module. */
export function markSeriesStyle(spec: PlotSpec): Partial<SeriesStyle> {
  if (spec.mark === "scatter") return { width: 0, marker: true };
  if (spec.mark === "step") {
    return { step: spec.stepMode ?? "post", ...(spec.showMarkers ? { marker: true } : {}) };
  }
  return spec.showMarkers ? { marker: true } : {};
}

// ── Error-column wells (ORIGIN_GAP_PLAN #51 phase 3 — "any XY mark can carry
// error bars", the COLUMN-DESIGNATION model rather than error-bars-as-plot-
// types): `yErr`/`xErr` are POSITION-paired with `y`, not channel-keyed — the
// simple shape the wells UI drags into. Two pure helpers bridge that to the
// canonical `lib/errorRoles.ErrorBinding` contract the interactive Stage
// (`Dataset.errorRoles`), `.dwk`, and publication export already speak. ────

/** Wells -> `ErrorBinding[]`, position-paired: `yErr[i]` describes `y[i]`
 *  (only up to `min(y.length, yErr.length)` pairs — a stale/out-of-sync
 *  wells state never invents a pairing beyond what's actually aligned).
 *  `xErr` binds to the x axis (`target: -1`, the same sentinel
 *  `lib/errorRoles` uses elsewhere). Every binding is symmetric
 *  (`side: "both"`) — the simple wells model has no +/- half, unlike the
 *  Inspector's richer Error columns card. XY-family only by convention: a
 *  categorical mark's `zones.yErr`/`xErr` are validated like any other zone
 *  content but callers never read this for box/violin/bar (see
 *  useGraphBuilder's `commitToPlot` and `specToRender`'s xy branch). */
export function specErrorBindings(spec: PlotSpec): ErrorBinding[] {
  const { y, yErr, xErr } = spec.zones;
  const out: ErrorBinding[] = [];
  const n = Math.min(y.length, yErr.length);
  for (let i = 0; i < n; i++) {
    out.push({ channel: yErr[i].channel, target: y[i].channel, axis: "y", side: "both" });
  }
  if (xErr) out.push({ channel: xErr.channel, target: -1, axis: "x", side: "both" });
  return out;
}

/** Seed `zones.yErr`/`zones.xErr` from the dataset's own name-based inference
 *  (`lib/errorRoles.inferErrorBindings`) — Origin's zero-click experience:
 *  drop a Y with no explicit error assignment and the matching error column
 *  (if any) fills in for free. Only SYMMETRIC inferred bindings project (the
 *  wells have no +/- half). The y-error prefix stops at the first Y channel
 *  with no unambiguous inferred error, since position-pairing has no way to
 *  represent a gap (an errorless Y followed by one that has an error) — this
 *  IS the "only prefill when unambiguous" rule, not a separate check. Pure:
 *  takes the live dataset's data in, never reads the store — the caller
 *  (useGraphBuilder) owns deciding WHEN to call this (never once the user has
 *  touched the error wells themselves). */
export function prefillErrorZones(spec: PlotSpec, data: DataStruct, datasetId: string): PlotSpec {
  const inferred = inferErrorBindings(data).filter((b) => b.side === "both");
  const yErr: ChannelRef[] = [];
  for (const yRef of spec.zones.y) {
    const match = inferred.find((b) => b.axis === "y" && b.target === yRef.channel);
    if (!match) break;
    yErr.push({ datasetId, channel: match.channel });
  }
  const xMatch = inferred.find((b) => b.axis === "x" && b.target === -1);
  return {
    ...spec,
    zones: { ...spec.zones, yErr, xErr: xMatch ? { datasetId, channel: xMatch.channel } : null },
  };
}

// ── Live-context builder (resolves types + monotonicity from real datasets) ──

/** Is a channel's finite values sorted (non-decreasing OR non-increasing) in row
 *  order? A monotonic x is the cue that a connecting line reads honestly. */
export function isMonotonicChannel(data: DataStruct, channel: number): boolean {
  const col = channel < 0 ? data.time : data.values.map((row) => row[channel]);
  let prev = NaN;
  let inc = true;
  let dec = true;
  for (const v of col) {
    if (!Number.isFinite(v)) continue;
    if (Number.isFinite(prev)) {
      if (v < prev) inc = false;
      if (v > prev) dec = false;
    }
    prev = v;
  }
  return inc || dec;
}

/** Build a MarkContext from live datasets for a given spec: modeling types via
 *  lib/modeling, xMonotonic computed from the X channel's data. */
export function markContext(spec: PlotSpec, datasets: readonly Dataset[]): MarkContext {
  const dsById = (id: string): Dataset | undefined => datasets.find((d) => d.id === id);
  const typeOf = (ref: ChannelRef): ModelingType => {
    const ds = dsById(ref.datasetId);
    if (!ds || ref.channel < 0) return "continuous";
    return channelModelingType(ds, ref.channel);
  };
  const x = spec.zones.x;
  let xMonotonic: boolean | undefined;
  if (x) {
    const ds = dsById(x.datasetId);
    if (ds) xMonotonic = isMonotonicChannel(ds.data, x.channel);
  }
  return { typeOf, xMonotonic };
}

// ── Render ───────────────────────────────────────────────────────────────────

export type SpecRender =
  | {
      kind: "xy";
      payload: PlotPayload;
      mark: "scatter" | "line" | "step";
      grouped: boolean;
      /** Mirrors `PlotSpec.showMarkers`/`stepMode`, carried onto the render so
       *  a consumer (the Graph Builder mini-preview) can draw the SAME shape
       *  the Stage commit produces without re-reading the raw spec. Omitted
       *  when false/not-"step" (the ordinary-render case). */
      showMarkers?: boolean;
      stepMode?: StepMode;
      /** Small multiples (GAP_PLOTTYPES #5 faceting), one per facet-column
       *  level — present only when `zones.facet` is set. Absent = the
       *  ordinary single-panel xy render. */
      facets?: FacetPanel[];
      /** Error whiskers for the Graph Builder mini-preview (ORIGIN_GAP_PLAN
       *  #51 phase 3): the SAME pairing `specErrorBindings` derives, keyed
       *  like `lib/errorbars.buildErrorSpans` (uPlot column index — 0 is x,
       *  p+1 is the p-th plotted Y). Present only for the FLAT (non-grouped)
       *  render: a grouped spec's synthetic per-level series already sheds
       *  other per-series detail the same way (see `buildXY`'s doc), so
       *  error whiskers degrade the same way rather than inventing a column
       *  mapping for a split series. */
      errorSpans?: Map<number, ErrorSpan[]>;
    }
  | {
      kind: "box";
      boxes: BoxStat[];
      valueLabel: string;
      groupLabel: string;
      violin: boolean;
      /** Small multiples (GUI_INTERACTION #11), one per facet-column level —
       *  present only when `zones.facet` is set AND at least one level's
       *  slice still groups to a non-empty box set. */
      facets?: { label: string; boxes: BoxStat[] }[];
    }
  | {
      kind: "bar";
      data: BarChartData;
      valueLabel: string;
      groupLabel: string;
      stacked: boolean;
      /** Small multiples (GUI_INTERACTION #11), one per facet-column level —
       *  same presence rule as the box variant's `facets`. */
      facets?: { label: string; data: BarChartData }[];
    }
  | { kind: "message"; message: string; tone: "hint" | "note" };

const hint = (message: string): SpecRender => ({ kind: "message", message, tone: "hint" });
const note = (message: string): SpecRender => ({ kind: "message", message, tone: "note" });

function channelLabel(data: DataStruct, channel: number): string {
  if (channel < 0) return String(data.metadata?.["x_column_name"] ?? "x");
  return data.labels[channel] ?? `col ${channel}`;
}

/** Build the xy payload, splitting into one series per group level when a group
 *  channel is set (a colour split; each series is the Y value where the row's
 *  group matches, null elsewhere, so all series share the one x column). */
function buildXY(
  data: DataStruct,
  xKey: number | null,
  yChannels: number[],
  groupCol: number | null,
): PlotPayload {
  if (groupCol === null) return buildColumns(data, null, xKey, yChannels);
  const xSrc = xKey === null ? data.time : data.values.map((row) => row[xKey]);
  const x = xSrc.map((v) => (Number.isFinite(v) ? v : null));
  const levels = [...new Set(data.values.map((row) => row[groupCol]).filter((v) => Number.isFinite(v)))].sort(
    (a, b) => a - b,
  );
  const cols: (number | null)[][] = [x];
  const series: PlotPayload["series"] = [];
  const gLabel = channelLabel(data, groupCol);
  for (const yc of yChannels) {
    const yLabel = channelLabel(data, yc);
    for (const lvl of levels) {
      cols.push(
        data.values.map((row) =>
          row[groupCol] === lvl && Number.isFinite(row[yc]) ? row[yc] : null,
        ),
      );
      series.push({ label: `${yLabel} (${gLabel}=${lvl})`, unit: data.units[yc] ?? "", axis: 0 });
    }
  }
  return {
    data: cols as PlotPayload["data"],
    series,
    xLabel:
      xKey === null
        ? String(data.metadata?.["x_column_long"] || data.metadata?.["x_column_name"] || "x")
        : (data.labels[xKey] ?? "x"),
    xUnit: xKey === null ? String(data.metadata?.["x_column_unit"] ?? "") : (data.units[xKey] ?? ""),
  };
}

/** Turn a spec + the loaded datasets into a concrete render payload. Reads the
 *  target dataset's ANALYSIS view so exclusion (#50) and filters (#53) hold
 *  (guard #11 — via lib/rowstate.analysisData). Never fetches; box/violin use
 *  the client box-stats fallback (violin's real KDE renders on the live stat
 *  stage). See the module docstring for the full render contract. */
export function specToRender(spec: PlotSpec, datasets: readonly Dataset[]): SpecRender {
  const dsId = specDatasetId(spec);
  if (dsId === null) return hint("Drop a channel into the X and Y wells to build a plot.");
  const ds = datasets.find((d) => d.id === dsId);
  if (!ds) return note("The spec's dataset is not loaded.");
  const data = analysisData(ds);
  if (!data || data.time.length === 0) return hint("No rows to plot (all excluded or filtered out).");
  if (spec.zones.y.length === 0) return hint("Add a Y channel to plot a value.");

  const xKey = spec.zones.x?.channel ?? null;
  const yChannels = spec.zones.y.map((r) => r.channel);

  if (spec.mark === "scatter" || spec.mark === "line" || spec.mark === "step") {
    const groupCol = spec.zones.group?.channel ?? null;
    const facetCol = spec.zones.facet?.channel ?? null;
    // Small multiples (#5): one xy payload per facet-column level, built from
    // the SAME analysis-view data + zones as the single-panel path — facet
    // just partitions the rows first.
    const facets = facetCol !== null ? facetPayloads(data, facetCol, xKey, yChannels) : undefined;
    // Error wells (#51 phase 3): only for the FLAT (non-grouped) render — a
    // grouped spec's synthetic per-level series have no sound 1:1 mapping to
    // the wells' y-index pairing (mirrors plotSpecFigure's own groupCol gate).
    const errBindings = groupCol === null ? specErrorBindings(spec) : [];
    const errorSpans = errBindings.length > 0 ? buildErrorSpans(data, yChannels, errBindings) : undefined;
    return {
      kind: "xy",
      payload: buildXY(data, xKey, yChannels, groupCol),
      mark: spec.mark,
      grouped: groupCol !== null,
      ...(spec.showMarkers ? { showMarkers: true } : {}),
      ...(spec.mark === "step" ? { stepMode: spec.stepMode ?? "post" } : {}),
      ...(facets && facets.length > 0 ? { facets } : {}),
      ...(errorSpans && errorSpans.size > 0 ? { errorSpans } : {}),
    };
  }

  if (spec.mark === "box" || spec.mark === "violin") {
    const x = spec.zones.x;
    const groupCol = x && isCategorical(channelModelingType(ds, x.channel)) ? x.channel : null;
    const valueCol = yChannels[0];
    const groups = resolveGroups(data, groupCol, valueCol, yChannels).filter((g) => g.values.length > 0);
    if (groups.length === 0) return hint("No finite values to group.");
    const facetCol = spec.zones.facet?.channel ?? null;
    const facets =
      facetCol !== null
        ? facetSlices(data, facetCol)
            .map((s) => {
              const sliceGroups = resolveGroups(s.data, groupCol, valueCol, yChannels).filter(
                (g) => g.values.length > 0,
              );
              return sliceGroups.length > 0 ? { label: s.label, boxes: groupBoxStatsClient(sliceGroups) } : null;
            })
            .filter((f): f is { label: string; boxes: BoxStat[] } => f !== null)
        : undefined;
    return {
      kind: "box",
      boxes: groupBoxStatsClient(groups),
      valueLabel: channelLabel(data, valueCol),
      groupLabel: groupCol !== null ? channelLabel(data, groupCol) : "channel",
      violin: spec.mark === "violin",
      ...(facets && facets.length > 0 ? { facets } : {}),
    };
  }

  // mark === "bar" (GAP_PLOTTYPES #4): X must be categorical — it's the
  // group axis; every Y channel becomes a clustered/stacked series within it.
  const x = spec.zones.x;
  const groupCol = x && isCategorical(channelModelingType(ds, x.channel)) ? x.channel : null;
  if (groupCol === null) return note("Bar charts need a categorical X column.");
  const seriesLabels = yChannels.map((c) => channelLabel(data, c));
  const matrix = buildBarMatrix(data, groupCol, yChannels, seriesLabels);
  if (matrix.groups.length === 0) return hint("No finite values to group.");
  const facetCol = spec.zones.facet?.channel ?? null;
  const facets =
    facetCol !== null
      ? facetSlices(data, facetCol)
          .map((s) => {
            const sliceMatrix = buildBarMatrix(s.data, groupCol, yChannels, seriesLabels);
            return sliceMatrix.groups.length > 0 ? { label: s.label, data: sliceMatrix } : null;
          })
          .filter((f): f is { label: string; data: BarChartData } => f !== null)
      : undefined;
  return {
    kind: "bar",
    data: matrix,
    valueLabel: seriesLabels.length > 1 ? "value" : seriesLabels[0],
    groupLabel: channelLabel(data, groupCol),
    stacked: false,
    ...(facets && facets.length > 0 ? { facets } : {}),
  };
}

// ── Serialization ────────────────────────────────────────────────────────────

function isChannelRef(v: unknown): v is ChannelRef {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.datasetId === "string" && typeof o.channel === "number" && Number.isInteger(o.channel);
}

function normRef(v: unknown): ChannelRef | null {
  return isChannelRef(v) ? { datasetId: v.datasetId, channel: v.channel } : null;
}

/** Drop later duplicates (same datasetId+channel) — a positionally-paired
 *  well has no sound meaning for the same error column appearing twice. */
function dedupeRefs(refs: ChannelRef[]): ChannelRef[] {
  const out: ChannelRef[] = [];
  for (const r of refs) {
    if (!out.some((o) => channelRefEq(o, r))) out.push(r);
  }
  return out;
}

function isPlotMark(v: unknown): v is PlotMark {
  return typeof v === "string" && (PLOT_MARKS as readonly string[]).includes(v);
}

const STEP_MODES: readonly StepMode[] = ["pre", "post", "mid"];

function isStepMode(v: unknown): v is StepMode {
  return typeof v === "string" && (STEP_MODES as readonly string[]).includes(v);
}

/** Validate + normalize an arbitrary value into a PlotSpec, or null if it isn't
 *  one. Tolerant of missing/extra fields (a partial persisted spec still loads):
 *  unknown zone refs drop to null / out of the Y list, an unknown mark falls
 *  back to scatter. This is the .dwk / macro replay entry point.
 *
 *  Accepts an incoming `version` of 1 OR 2 (anything else -> null); the
 *  incoming tag is otherwise ADVISORY ONLY — `display`/`axes`/`decor` are
 *  parsed whenever present regardless of what the tag said (a v1-tagged
 *  spec with no such keys naturally yields no blocks), and the RETURNED
 *  `version` is always recomputed from whether a block survived validation
 *  with actual content (see `plotspec2.ts`'s `displayBlockHasContent`/
 *  `axesBlockHasContent`/`decorBlockHasContent`/`pageBlockHasContent`).
 *  `page` is validated like the rest as of #54 pass C — it was
 *  reserved-and-stripped until then. */
export function validatePlotSpec(value: unknown): PlotSpec | null {
  if (value === null || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (o.version !== 1 && o.version !== 2) return null;
  const zin = (o.zones ?? {}) as Record<string, unknown>;
  const y = Array.isArray(zin.y) ? zin.y.map(normRef).filter((r): r is ChannelRef => r !== null) : [];
  // yErr (#51 phase 3): malformed/out-of-range refs drop (normRef), then
  // duplicates drop, then it's truncated to the y list's length — position-
  // pairing has no way to express a trailing entry with no y to describe.
  const yErrRaw = Array.isArray(zin.yErr)
    ? zin.yErr.map(normRef).filter((r): r is ChannelRef => r !== null)
    : [];
  const yErr = dedupeRefs(yErrRaw).slice(0, y.length);
  const zones: PlotZones = {
    x: normRef(zin.x),
    y,
    group: normRef(zin.group),
    facet: normRef(zin.facet),
    yErr,
    xErr: normRef(zin.xErr),
  };
  const mark = isPlotMark(o.mark) ? o.mark : "scatter";
  // Byte-stable v1 siblings of `mark` (never a v2 "block" — see PlotSpec's
  // doc): tolerant per-field validation, omitted entirely when absent/
  // default so a spec that never touched them serializes exactly as before
  // this field existed.
  const stepMode = isStepMode(o.stepMode) ? o.stepMode : undefined;
  const showMarkers = typeof o.showMarkers === "boolean" ? o.showMarkers : undefined;
  const rawDisplay = validateDisplayBlock(o.display);
  const rawAxes = validateAxesBlock(o.axes);
  const rawDecor = validateDecorBlock(o.decor);
  const rawPage = validatePageBlock(o.page);
  const display = displayBlockHasContent(rawDisplay) ? rawDisplay : undefined;
  const axes = axesBlockHasContent(rawAxes) ? rawAxes : undefined;
  const decor = decorBlockHasContent(rawDecor) ? rawDecor : undefined;
  const page = pageBlockHasContent(rawPage) ? rawPage : undefined;
  return {
    version: display || axes || decor || page ? 2 : 1,
    zones,
    mark,
    ...(stepMode ? { stepMode } : {}),
    ...(showMarkers ? { showMarkers } : {}),
    ...(display ? { display } : {}),
    ...(axes ? { axes } : {}),
    ...(page ? { page } : {}),
    ...(decor ? { decor } : {}),
  };
}

/** Serialize a spec to a stable JSON string (for .dwk / macro / template). */
export function serializePlotSpec(spec: PlotSpec): string {
  const norm = validatePlotSpec(spec) ?? emptySpec();
  return JSON.stringify(norm);
}

/** Parse a serialized spec back to a normalized PlotSpec, or null if malformed. */
export function deserializePlotSpec(raw: string): PlotSpec | null {
  try {
    return validatePlotSpec(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ── Saved specs (GUI_INTERACTION_PLAN #11 — "Graph Builder → durable
// artifact") ─────────────────────────────────────────────────────────────
//
// A SavedPlotSpec names + timestamps a PlotSpec so the Graph Builder's output
// survives close/reopen and round-trips through the `.dwk` workspace
// (lib/workspace.ts's `savedPlotSpecs`, additive-optional — a legacy file
// with no such field loads with an empty list). The store slice
// (store/graphBuilder.ts) owns the CRUD; this module only types + validates.

/** A named, saved PlotSpec. `id` is opaque (never shown to the user);
 *  `createdAt`/`modifiedAt` are ISO timestamps, `modifiedAt` bumped on every
 *  Save. */
export interface SavedPlotSpec {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  spec: PlotSpec;
}

function isSavedPlotSpecShape(
  v: unknown,
): v is { id: string; name: string; createdAt: string; modifiedAt: string; spec: unknown } {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.createdAt === "string" &&
    typeof o.modifiedAt === "string"
  );
}

/** Validate persisted saved-spec entries from a .dwk — drops malformed ones,
 *  normalizes each `spec` via validatePlotSpec (never throws on a stale/
 *  hand-edited payload); mirrors lib/report.sanitizeReports' shape. */
export function sanitizeSavedPlotSpecs(v: unknown): SavedPlotSpec[] {
  if (!Array.isArray(v)) return [];
  const out: SavedPlotSpec[] = [];
  for (const e of v) {
    if (!isSavedPlotSpecShape(e)) continue;
    const spec = validatePlotSpec(e.spec);
    if (!spec) continue;
    out.push({ id: e.id, name: e.name, createdAt: e.createdAt, modifiedAt: e.modifiedAt, spec });
  }
  return out;
}

/** Structural equality for the Graph Builder's unsaved-changes indicator:
 *  compares NORMALIZED specs (via the same serializer .dwk uses), so field
 *  order or an undefined-vs-absent zone never false-flags a spec as dirty. */
export function plotSpecsEqual(a: PlotSpec, b: PlotSpec): boolean {
  return serializePlotSpec(a) === serializePlotSpec(b);
}

/** Structural equality restricted to ZONES + MARK, deliberately ignoring the
 *  v2 blocks (display/axes/page/decor). GUI_INTERACTION_PLAN #12 Slice 3:
 *  useGraphBuilder's `dirty` (unsaved-changes indicator) uses THIS, not
 *  `plotSpecsEqual` — the trap `plotSpecsEqual` falls into here is that
 *  Slice 3's save-time block capture (useGraphBuilder's saveActive/saveAs,
 *  via `buildDisplayBlock`/`buildAxesBlock`) computes `display`/`axes`
 *  FRESH from live store state and hands the result straight to
 *  `store/graphBuilder.ts` — the builder's own live `spec` never carries
 *  those captured blocks back. A full-spec comparison would therefore read
 *  "dirty" the instant a save completes (the just-saved payload gained
 *  blocks the live spec doesn't have), and would read "dirty" just as
 *  wrongly the instant a v2 spec is reopened, were `openSpec` ever changed
 *  to strip blocks off the live spec (today it doesn't — blocks simply ride
 *  along unapplied; see openSpec's doc). Block-level dirtiness (an edited
 *  display/axes diverging from what's saved) arrives once the builder can
 *  actually EDIT blocks (Slice 5); until then only zones/mark reflect
 *  user-visible builder state, so only zones/mark should ever flip the dot.
 *  Normalizes each side via `validatePlotSpec` first (same tolerance as
 *  `plotSpecsEqual`), then compares just the `zones`/`mark` slice. */
export function plotSpecCoreEqual(a: PlotSpec, b: PlotSpec): boolean {
  const core = (s: PlotSpec): string => {
    const norm = validatePlotSpec(s) ?? emptySpec();
    // stepMode/showMarkers are user-visible builder state exactly like mark
    // (byte-stable v1 siblings of it, not a v2 block — see PlotSpec's doc),
    // so they belong in the SAME "core" comparison as zones+mark.
    return JSON.stringify({
      zones: norm.zones,
      mark: norm.mark,
      stepMode: norm.stepMode,
      showMarkers: norm.showMarkers,
    });
  };
  return core(a) === core(b);
}
