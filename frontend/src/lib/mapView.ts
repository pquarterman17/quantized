// The DURABLE 2-D map view: what the Map stage shows about a map that is a
// user DECISION rather than a re-derivable render detail — the colour
// limits, the colour scale (linear/log), the colormap, the H/V/segment slice
// definitions with their linked positions, and the free text annotations
// placed on the map (PRIMARY_SOFTWARE_AUDIT_PLAN P2.8's "Preserve existing
// H/V/segment slices and link positions" + "Persist color limits/scale/map/
// slices/annotations").
//
// Pure types + sanitizer only — the zustand slice that owns the live value
// lives in `store/mapView.ts`, exactly the `lib/roi.ts` / `store/rois.ts`
// division this map subsystem already uses, so `lib/workspaceSerialize.ts`
// and `lib/workspace.ts` can reach the (de)serializers without importing a
// store slice's actions.
//
// ONE VIEW PER DATASET (P2.8 review round 2, 2026-09-17). The first cut of
// this module held ONE app-wide record carrying its own `datasetId`, rebound
// by every mounted map through a `bindMapView` action. `MapStage` is mounted
// in the Stage Map tab AND in every `kind:"map"` document window at the same
// time (components/windows/DocumentWindow.tsx), so opening a second map
// silently DESTROYED the first one's slices, colour limits and annotations —
// and the rebind recorded no history, so it could not be undone. The record
// is therefore keyed by dataset id (`MapViewMap`): each map reads its own
// entry, an absent entry IS `DEFAULT_MAP_VIEW`, and merely opening a map
// writes nothing at all. The drop-on-switch rule is gone with it — it was a
// consequence of sharing one record, not a decision. A dataset REMOVAL still
// drops that dataset's entry (store/removeDatasets.ts).
//
// WHAT IS NOT HERE, deliberately:
//   - `mapMethod`/`mapRes`/`contour*` (store/useApp.ts). Those are REGRID
//     inputs: change one and the payload is recomputed from the dataset.
//     They are app-wide render settings with their own HISTORY_EXCLUDED
//     entries ("view setting outside PlotView"), and P2.8's box names the
//     colour/slice/annotation state, not them.
//   - `mapRoi`/`mapRuler`/`mapSector` (store/rois.ts). Those are the
//     in-progress box/ruler/wedge geometry — working scratch that carries no
//     identity, deliberately outside both `.dwk` and undo (see that file's
//     header). A slice def here is the opposite: it is COMMITTED (the user
//     took the cut), it has an id, and its position is the thing P2.8 asks
//     to preserve.
//
// EVERYTHING here is in the map's own DATA coordinates (the displayed x/y
// axes' units), never canvas pixels — a slice must land on the same physical
// place after a regrid to a different resolution, after a colour-limit
// change, and after the dataset is re-activated, and pixels survive none of
// those. `components/Stage/MapSliceOverlay.tsx` projects them through the
// SAME `mapRender.dataToPx` the canvas paints with.

import type { ColormapName } from "./colormap";
import type { CutSpace } from "./mapcuts";

/** Which of the map's two axes a slice is fixed on. `h` holds y and sweeps x,
 *  `v` holds x and sweeps y, `seg` is a free line between two picked points —
 *  the same three the cut toolbar arms (`lib/mapcuts.ts`'s `CutMode` minus
 *  its `"off"` idle state). */
export type MapSliceKind = "h" | "v" | "seg";

/** One committed H/V/segment slice, in map DATA coordinates.
 *
 *  `a` is the LINK POSITION: for `h`/`v` it is the point the user clicked
 *  (both components kept, not just the held one — the unheld component is
 *  what lets the overlay label the slice where it was taken, and what a
 *  future "re-run this cut" reuses verbatim). For `seg` it is the drag's
 *  start and `b` its end.
 *
 *  `width` and `space` are frozen from the cut that produced the slice so the
 *  definition is self-describing: the same line means different things in
 *  angular vs reciprocal space (see MapToolbar's `cutWidthTooltip`). */
export interface MapSliceDef {
  id: string;
  kind: MapSliceKind;
  a: { x: number; y: number };
  /** Segment end point. Absent (and ignored) for `h`/`v`. */
  b?: { x: number; y: number };
  width: number;
  space: CutSpace;
}

/** A text label pinned to a map data coordinate. Same shape as the 1-D
 *  plot's `Annotation` (lib/plotview.ts) minus the plot-only styling — a map
 *  annotation is placed by double-clicking the canvas and carries where, what,
 *  and which axis space it was placed in.
 *
 *  `space` is the same guard `MapSliceDef` carries: an RSM can be shown in
 *  angular (2θ/ω) OR reciprocal (Qx/Qz) axes, and switching between them is
 *  NOT a dataset change, so without it a label typed at 2θ = 32 would be
 *  redrawn at Qx = 32. `null` means "a plain map" (no RSM cut space), which is
 *  what the overlay matches such a map against.
 *
 *  RESIDUAL, recorded rather than papered over: on a plain (`space: null`) map
 *  the x/y CHANNEL PICKS can still be changed from the toolbar without any of
 *  this noticing, so a label placed against one channel pair is redrawn
 *  against the next. The RSM angular⇄Q toggle is the one axis swap the product
 *  actually ships as a toggle, and it is the one this guards. */
export interface MapAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  space: CutSpace | null;
}

/** ONE dataset's durable map view. The dataset id is the KEY in `MapViewMap`,
 *  never a field here: a record that carries its own binding can describe only
 *  one map at a time, which is exactly the defect this replaced. */
export interface MapViewState {
  colormap: ColormapName;
  logZ: boolean;
  /** Explicit [lo, hi] colour limits, or null for "auto" (the payload's own
   *  finite z extent, which is what the canvas used before P2.8). */
  colorLimits: [number, number] | null;
  slices: MapSliceDef[];
  annotations: MapAnnotation[];
}

/** Every dataset's map view, keyed by dataset id. An ABSENT key is not a
 *  missing view — it IS `DEFAULT_MAP_VIEW` (see `mapViewFor`), which is what
 *  makes opening a map a read rather than a write. An entry that is EQUAL to
 *  the default (edited back to it) costs the saved document nothing either:
 *  `isDefaultMapViews` and `serializeMapViews` both judge by value. */
export type MapViewMap = Readonly<Record<string, MapViewState>>;

/** The untouched view. DEEPLY frozen — the arrays too, since `.slices.push(…)`
 *  is exactly the mutation a careless caller would reach for, and this object
 *  is handed out as the reset value, the absent-entry default and the value
 *  every unvisited map reads. */
export const DEFAULT_MAP_VIEW: MapViewState = Object.freeze({
  colormap: "viridis",
  logZ: false,
  colorLimits: null,
  slices: Object.freeze([] as MapSliceDef[]),
  annotations: Object.freeze([] as MapAnnotation[]),
}) as MapViewState;

/** The untouched record: no dataset has a view yet. */
export const EMPTY_MAP_VIEWS: MapViewMap = Object.freeze({});

/** The colormap names a `.dwk` may name. Kept as a string list rather than a
 *  value import of `lib/colormap`'s `COLORMAPS` because this module is EAGER
 *  (lib/workspaceSerialize.ts reaches it) and that import would drag the
 *  colour LUTs into the eager chunk. `lib/mapView.test.ts` pins it equal to
 *  `Object.keys(COLORMAPS)` so a fifth colormap cannot silently start
 *  reverting to viridis on reopen. */
export const COLORMAP_NAMES: readonly string[] = ["viridis", "magma", "gray", "rdbu"];

/** Trust-boundary caps for a hand-edited or third-party `.dwk`. Nothing in the
 *  UI can reach them (a cut is one click and a label one dialog), but
 *  `sanitizeMapViews` is the only thing standing between a crafted document
 *  and the renderer. */
const MAX_SLICES = 200;
const MAX_ANNOTATIONS = 200;
const MAX_LABEL_CHARS = 200;
/** Cap on the number of DATASET ENTRIES a record may carry (P2.8 review round
 *  3, finding 7). The other three caps above are unconditional, but the entry
 *  count used to be bounded only by `liveDatasetIds` — a property of the
 *  CALLERS (both pass it), not of this function. A crafted `.dwk` handed
 *  straight to `sanitizeMapViews` could therefore install an unbounded record.
 *  256 is far above any real project's dataset count and far below a size that
 *  costs anything. */
const MAX_VIEWS = 256;

/** True when this dataset's view records no decision — every field is still at
 *  its default. Deliberately says NOTHING about which dataset it belongs to:
 *  opening a map is not a decision, so binding one must not make a document
 *  dirty (P2.8 review round 2, finding 2). `lib/workspaceSerialize.ts` uses
 *  this to OMIT the field entirely, so a project that never touched a map
 *  serializes byte-for-byte as it did before P2.8 (BUG-017's rule: an additive
 *  field must cost an ordinary document nothing). */
export function isDefaultMapView(v: MapViewState | undefined | null): boolean {
  if (!v) return true;
  return (
    v.colormap === DEFAULT_MAP_VIEW.colormap &&
    v.logZ === DEFAULT_MAP_VIEW.logZ &&
    v.colorLimits === null &&
    v.slices.length === 0 &&
    v.annotations.length === 0
  );
}

/** True when no dataset's view records a decision. */
export function isDefaultMapViews(m: MapViewMap | undefined | null): boolean {
  if (!m) return true;
  return Object.values(m).every(isDefaultMapView);
}

/** The view a map showing `datasetId` reads. An absent entry is the default —
 *  a pure lookup, never a write, which is what makes a second open map
 *  harmless. */
export function mapViewFor(
  m: MapViewMap | undefined | null,
  datasetId: string | null,
): MapViewState {
  if (!m || !datasetId) return DEFAULT_MAP_VIEW;
  return m[datasetId] ?? DEFAULT_MAP_VIEW;
}

/** True when the two [lo, hi] pairs say the same thing. Exported for the
 *  store's no-op guard on `setMapColorLimits` (a fresh array with the same two
 *  numbers is not a change). */
export function sameColorLimits(
  a: [number, number] | null,
  b: [number, number] | null,
): boolean {
  if (a === b) return true;
  return a !== null && b !== null && a[0] === b[0] && a[1] === b[1];
}

/** Deep copy for the save path — a live store object must never be aliased
 *  into the saved document (the same rule `serializeRois`/`serializePeakTable`
 *  follow). Default entries are dropped: they record nothing. */
export function serializeMapViews(m: MapViewMap): Record<string, MapViewState> {
  const out: Record<string, MapViewState> = {};
  for (const [id, v] of Object.entries(m)) {
    if (isDefaultMapView(v)) continue;
    out[id] = {
      colormap: v.colormap,
      logZ: v.logZ,
      colorLimits: v.colorLimits ? [v.colorLimits[0], v.colorLimits[1]] : null,
      slices: v.slices.map((s) => ({ ...s, a: { ...s.a }, ...(s.b ? { b: { ...s.b } } : {}) })),
      annotations: v.annotations.map((a) => ({ ...a })),
    };
  }
  return out;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function point(raw: unknown): { x: number; y: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const x = num(o.x);
  const y = num(o.y);
  return x === null || y === null ? null : { x, y };
}

function sliceDef(raw: unknown): MapSliceDef | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== "h" && kind !== "v" && kind !== "seg") return null;
  const a = point(o.a);
  if (!a) return null;
  const b = point(o.b);
  if (kind === "seg" && !b) return null; // a segment without both ends is not a line
  // An unknown/future space ("hkl", a corrupted value) is DROPPED, not coerced
  // to angular: coercion redraws the slice over the wrong axes, in the wrong
  // place, with no warning. The annotation path below makes the same call.
  if (o.space !== "q" && o.space !== "angular") return null;
  if (typeof o.id !== "string" || !o.id) return null; // no identity to remove/undo against
  // width 0 is legitimate — the toolbar's own default ("single line" in
  // angular, "nearest points only" in Q). A NEGATIVE one is malformed.
  const width = num(o.width) ?? 0;
  if (width < 0) return null;
  return {
    id: o.id,
    kind,
    a,
    ...(kind === "seg" && b ? { b } : {}),
    width,
    space: o.space,
  };
}

function annotation(raw: unknown): MapAnnotation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const x = num(o.x);
  const y = num(o.y);
  if (x === null || y === null || typeof o.text !== "string") return null;
  if (typeof o.id !== "string" || !o.id) return null; // no identity to remove/undo against
  return {
    id: o.id,
    x,
    y,
    text: o.text.slice(0, MAX_LABEL_CHARS),
    // A pre-`space` entry (and any other unknown value) reads as a plain map.
    space: o.space === "q" ? "q" : o.space === "angular" ? "angular" : null,
  };
}

/** Read ONE dataset's stored view. Drop-malformed-never-throw, the same
 *  degrade `deserializeRois`/`sanitizeCollections` use: a hand-edited or
 *  half-written entry is skipped, never propagated and never fatal. */
export function sanitizeMapView(raw: unknown): MapViewState {
  if (typeof raw !== "object" || raw === null) return DEFAULT_MAP_VIEW;
  const o = raw as Record<string, unknown>;
  const lim = Array.isArray(o.colorLimits) ? o.colorLimits : null;
  const lo = lim ? num(lim[0]) : null;
  const hi = lim ? num(lim[1]) : null;
  return {
    colormap:
      typeof o.colormap === "string" && COLORMAP_NAMES.includes(o.colormap)
        ? (o.colormap as ColormapName)
        : DEFAULT_MAP_VIEW.colormap,
    logZ: o.logZ === true,
    colorLimits: lo !== null && hi !== null && hi > lo ? [lo, hi] : null,
    slices: Array.isArray(o.slices)
      ? o.slices
          .map(sliceDef)
          .filter((s): s is MapSliceDef => s !== null)
          .slice(0, MAX_SLICES)
      : [],
    annotations: Array.isArray(o.annotations)
      ? o.annotations
          .map(annotation)
          .filter((a): a is MapAnnotation => a !== null)
          .slice(0, MAX_ANNOTATIONS)
      : [],
  };
}

/** Read a `.dwk`'s map-view field.
 *
 *  Accepts BOTH shapes: the keyed record written from this round on, and the
 *  single `{datasetId, …}` object written by the first P2.8 commit, which is
 *  migrated into `{[datasetId]: view}`. A legacy object with no `datasetId`
 *  described no map and is dropped.
 *
 *  `liveDatasetIds`, when given, is the parsed document's surviving dataset
 *  ids — an entry keyed by a dataset that did NOT survive the load is
 *  discarded, because its colour limits and slice positions are in that map's
 *  units and would silently mis-describe whatever map opens next
 *  (`store/rois.ts` makes the same call for why an unnamed box is not restored
 *  across a restart). */
export function sanitizeMapViews(raw: unknown, liveDatasetIds?: ReadonlySet<string>): MapViewMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return EMPTY_MAP_VIEWS;
  const o = raw as Record<string, unknown>;
  // A top-level `datasetId` STRING is what tells the first cut's single object
  // apart from the keyed record: the first cut always wrote one, and a dataset
  // id is generated (`ds-<t36>-<n>`), so it can never be that string.
  // The type test is load-bearing (P2.8 review round 3, finding 4): a bare
  // `"datasetId" in o` also fired for a KEYED record that happens to hold a
  // dataset whose id is literally "datasetId" — whose value is a view OBJECT,
  // not a string — and then discarded every OTHER dataset's entry with it,
  // contradicting this module's own "drop the malformed one, keep the rest"
  // contract. With the string test that record takes the keyed branch, where
  // its entries (that one included) are sanitized normally; a legacy object
  // with a non-string `datasetId` described no dataset and falls through to
  // the same branch, whose `typeof id !== "string"` guard drops it.
  const entries =
    typeof o.datasetId === "string" ? [[o.datasetId, o] as const] : Object.entries(o);
  const out: Record<string, MapViewState> = {};
  for (const [id, entry] of entries) {
    if (typeof id !== "string" || !id) continue;
    if (liveDatasetIds && !liveDatasetIds.has(id)) continue;
    const v = sanitizeMapView(entry);
    if (!isDefaultMapView(v)) out[id] = v;
    if (Object.keys(out).length >= MAX_VIEWS) break;
  }
  return out;
}
