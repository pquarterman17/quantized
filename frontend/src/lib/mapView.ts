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

/** The whole durable map view. `datasetId` is what makes the preservation
 *  rule expressible: re-activating the SAME dataset keeps every field, a
 *  genuine switch to another dataset drops the data-dependent ones (BUG-012's
 *  rule, applied in `store/mapView.ts`'s `bindMapView`). */
export interface MapViewState {
  datasetId: string | null;
  colormap: ColormapName;
  logZ: boolean;
  /** Explicit [lo, hi] colour limits, or null for "auto" (the payload's own
   *  finite z extent, which is what the canvas used before P2.8). */
  colorLimits: [number, number] | null;
  slices: MapSliceDef[];
  annotations: MapAnnotation[];
}

/** The untouched view. Frozen: it is handed out as the reset value and as the
 *  absent-field default, so a caller mutating it would corrupt every later
 *  reset. */
export const DEFAULT_MAP_VIEW: MapViewState = Object.freeze({
  datasetId: null,
  colormap: "viridis",
  logZ: false,
  colorLimits: null,
  slices: [],
  annotations: [],
}) as MapViewState;

const COLORMAP_NAMES: readonly string[] = ["viridis", "magma", "gray", "rdbu"];

/** True when nothing about the map view has been decided — nobody opened a
 *  map, or everything is still at its default. `lib/workspaceSerialize.ts`
 *  uses this to OMIT the field entirely, so a project that never touched a
 *  map serializes byte-for-byte as it did before P2.8 (BUG-017's rule: an
 *  additive field must cost an ordinary document nothing). */
export function isDefaultMapView(v: MapViewState | undefined | null): boolean {
  if (!v) return true;
  return (
    v.datasetId === null &&
    v.colormap === DEFAULT_MAP_VIEW.colormap &&
    v.logZ === DEFAULT_MAP_VIEW.logZ &&
    v.colorLimits === null &&
    v.slices.length === 0 &&
    v.annotations.length === 0
  );
}

/** Deep copy for the save path — a live store object must never be aliased
 *  into the saved document (the same rule `serializeRois`/`serializePeakTable`
 *  follow). */
export function serializeMapView(v: MapViewState): MapViewState {
  return {
    datasetId: v.datasetId,
    colormap: v.colormap,
    logZ: v.logZ,
    colorLimits: v.colorLimits ? [v.colorLimits[0], v.colorLimits[1]] : null,
    slices: v.slices.map((s) => ({ ...s, a: { ...s.a }, ...(s.b ? { b: { ...s.b } } : {}) })),
    annotations: v.annotations.map((a) => ({ ...a })),
  };
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
  const space = o.space === "q" ? "q" : "angular";
  if (typeof o.id !== "string" || !o.id) return null; // no identity to remove/undo against
  return {
    id: o.id,
    kind,
    a,
    ...(kind === "seg" && b ? { b } : {}),
    width: num(o.width) ?? 0,
    space,
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
    text: o.text,
    // A pre-`space` entry (and any other unknown value) reads as a plain map.
    space: o.space === "q" ? "q" : o.space === "angular" ? "angular" : null,
  };
}

/** Read a `.dwk`'s `mapView` field. Drop-malformed-never-throw, the same
 *  degrade `deserializeRois`/`sanitizeCollections` use: a hand-edited or
 *  half-written entry is skipped, never propagated and never fatal.
 *
 *  `liveDatasetIds`, when given, is the parsed document's surviving dataset
 *  ids — a `mapView` bound to a dataset that did NOT survive the load is
 *  discarded WHOLE rather than rebound, because its colour limits and slice
 *  positions are in that map's units and would silently mis-describe
 *  whatever map opens next (`store/rois.ts` makes the same call for why an
 *  unnamed box is not restored across a restart). */
export function sanitizeMapView(
  raw: unknown,
  liveDatasetIds?: ReadonlySet<string>,
): MapViewState {
  if (typeof raw !== "object" || raw === null) return DEFAULT_MAP_VIEW;
  const o = raw as Record<string, unknown>;
  const datasetId = typeof o.datasetId === "string" ? o.datasetId : null;
  if (datasetId !== null && liveDatasetIds && !liveDatasetIds.has(datasetId)) return DEFAULT_MAP_VIEW;
  const lim = Array.isArray(o.colorLimits) ? o.colorLimits : null;
  const lo = lim ? num(lim[0]) : null;
  const hi = lim ? num(lim[1]) : null;
  return {
    datasetId,
    colormap:
      typeof o.colormap === "string" && COLORMAP_NAMES.includes(o.colormap)
        ? (o.colormap as ColormapName)
        : DEFAULT_MAP_VIEW.colormap,
    logZ: o.logZ === true,
    colorLimits: lo !== null && hi !== null && hi > lo ? [lo, hi] : null,
    slices: Array.isArray(o.slices)
      ? o.slices.map(sliceDef).filter((s): s is MapSliceDef => s !== null)
      : [],
    annotations: Array.isArray(o.annotations)
      ? o.annotations.map(annotation).filter((a): a is MapAnnotation => a !== null)
      : [],
  };
}

/** The [lo, hi] the heatmap should actually paint with: the user's explicit
 *  limits when they set some, the payload's own extent otherwise. Returns
 *  null when neither is usable (an all-null grid), which is the signal the
 *  renderer already had for "nothing to blit".
 *
 *  In log mode `autoLo` is the grid's smallest POSITIVE cell (what
 *  `mapRender.draw` already passed): an explicit non-positive `lo` is raised
 *  to that floor rather than rejected, so switching a map to log never blanks
 *  it just because the linear limits started at or below 0. */
export function effectiveColorLimits(
  colorLimits: [number, number] | null,
  autoLo: number | null,
  autoHi: number | null,
  logZ = false,
): [number, number] | null {
  let lo = colorLimits ? colorLimits[0] : autoLo;
  const hi = colorLimits ? colorLimits[1] : autoHi;
  if (logZ && lo !== null && lo <= 0) lo = autoLo;
  if (lo === null || hi === null || !(hi > lo)) return null;
  return [lo, hi];
}
