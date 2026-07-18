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
// A spec has four ZONES and one MARK:
//
//   zones.x     : ChannelRef | null   — the horizontal / category axis
//   zones.y     : ChannelRef[]         — the value axis (one or more series)
//   zones.group : ChannelRef | null   — a categorical split into coloured series
//   zones.facet : ChannelRef | null   — small-multiples key (TYPED-BUT-INERT in
//                                        v1; activates with GAP_PLOTTYPES #5)
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
// `version: 1` tag is the migration seam — a future v2 reads v1 and up-converts.

import { buildBarMatrix, type BarChartData } from "./barlayout";
import { facetPayloads, facetSlices, type FacetPanel } from "./facet";
import { channelModelingType, isCategorical } from "./modeling";
import { buildColumns, type PlotPayload } from "./plotdata";
import { analysisData } from "./rowstate";
import {
  type BoxStat,
  groupBoxStatsClient,
  resolveGroups,
} from "./statstage";
import type { DataStruct, Dataset, ModelingType } from "./types";

// ── Types ────────────────────────────────────────────────────────────────────

/** A reference to one channel of one dataset, BY ID (survives .dwk). `channel`
 *  is a value-column index (0-based); a negative index means the x/time column. */
export interface ChannelRef {
  datasetId: string;
  channel: number;
}

/** The mark (glyph) a spec renders with. */
export type PlotMark = "scatter" | "line" | "box" | "violin" | "bar";

/** The four drop wells. `facet` is typed from day one but inert in v1. */
export type ZoneName = "x" | "y" | "group" | "facet";

export interface PlotZones {
  x: ChannelRef | null;
  y: ChannelRef[];
  group: ChannelRef | null;
  facet: ChannelRef | null;
}

export interface PlotSpec {
  version: 1;
  zones: PlotZones;
  mark: PlotMark;
}

/** Every mark, in declaration order (also the validation allow-list). */
export const PLOT_MARKS: readonly PlotMark[] = ["scatter", "line", "box", "violin", "bar"];

/** Which "shape" a set of zones renders as. `null` = incomplete (no Y). */
export type MarkFamily = "xy" | "categorical";

const XY_MARKS: readonly PlotMark[] = ["scatter", "line"];
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
  return { version: 1, zones: { x: null, y: [], group: null, facet: null }, mark: "scatter" };
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
      mark: "scatter" | "line";
      grouped: boolean;
      /** Small multiples (GAP_PLOTTYPES #5 faceting), one per facet-column
       *  level — present only when `zones.facet` is set. Absent = the
       *  ordinary single-panel xy render. */
      facets?: FacetPanel[];
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

  if (spec.mark === "scatter" || spec.mark === "line") {
    const groupCol = spec.zones.group?.channel ?? null;
    const facetCol = spec.zones.facet?.channel ?? null;
    // Small multiples (#5): one xy payload per facet-column level, built from
    // the SAME analysis-view data + zones as the single-panel path — facet
    // just partitions the rows first.
    const facets = facetCol !== null ? facetPayloads(data, facetCol, xKey, yChannels) : undefined;
    return {
      kind: "xy",
      payload: buildXY(data, xKey, yChannels, groupCol),
      mark: spec.mark,
      grouped: groupCol !== null,
      ...(facets && facets.length > 0 ? { facets } : {}),
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

function isPlotMark(v: unknown): v is PlotMark {
  return typeof v === "string" && (PLOT_MARKS as readonly string[]).includes(v);
}

/** Validate + normalize an arbitrary value into a PlotSpec, or null if it isn't
 *  one. Tolerant of missing/extra fields (a partial persisted spec still loads):
 *  unknown zone refs drop to null / out of the Y list, an unknown mark falls
 *  back to scatter. This is the .dwk / macro replay entry point. */
export function validatePlotSpec(value: unknown): PlotSpec | null {
  if (value === null || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (o.version !== 1) return null;
  const zin = (o.zones ?? {}) as Record<string, unknown>;
  const y = Array.isArray(zin.y) ? zin.y.map(normRef).filter((r): r is ChannelRef => r !== null) : [];
  const zones: PlotZones = {
    x: normRef(zin.x),
    y,
    group: normRef(zin.group),
    facet: normRef(zin.facet),
  };
  return { version: 1, zones, mark: isPlotMark(o.mark) ? o.mark : "scatter" };
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
