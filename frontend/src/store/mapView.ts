// The durable 2-D map view slice (PRIMARY_SOFTWARE_AUDIT_PLAN P2.8 —
// "Preserve existing H/V/segment slices and link positions" + "Persist color
// limits/scale/map/slices/annotations").
//
// Composed into the ONE `useApp` store instance through `store/rois.ts`'s own
// creator (`createRoisSlice` spreads `createMapViewSlice(set, get)` and
// `RoisSlice extends MapViewSlice`), NOT through a fourth spread of its own in
// `store/useApp.ts`. Two reasons, in order:
//   1. `store/useApp.ts` sits EXACTLY at its store-size pin (2012 lines,
//      architecture.test.ts's STORE_PINS, ratchet-down only) with zero
//      headroom, and that pin is the whole reason `store/rois.ts` exists at
//      all — read its header. A new import line + extends entry + spread line
//      there would have to be funded by an extraction unrelated to this work.
//   2. It is where the reader already looks: `rois.ts` owns `rsmPeaks`
//      ("markers on the 2D map") for the same cohesion reason, and the box /
//      ruler / sector geometry this view's slices sit beside.
// Nesting is a composition detail only — `useApp((s) => s.mapViews)` and
// `useApp.getState().setMapColorLimits(id, …)` work exactly as for any other
// field, because the composed `AppState` is flat.
//
// WHAT THIS MODULE OWNS: the `mapViews` field (lib/mapView.ts's `MapViewMap`,
// ONE entry per dataset) and every writer of it — the colormap, the linear/log
// colour scale, the explicit colour limits, the committed H/V/segment slice
// definitions and the map annotations.
//
// EVERY WRITER TAKES A DATASET ID (P2.8 review round 2). `MapStage` is mounted
// in the Stage Map tab AND in every `kind:"map"` document window at once, so a
// single shared record meant the second map destroyed the first one's slices,
// limits and annotations the moment it opened — silently, and outside undo
// because the rebind that did it recorded no history. There is no `bindMapView`
// any more: a map READS `mapViewFor(state.mapViews, itsDatasetId)`, which is a
// pure lookup, so opening a map cannot change anything, cannot dirty the
// project and cannot schedule an autosave.
//
// UNDO: every writer records an undo entry, and `mapViews` is a named field of
// `HistorySnapshot` (store/historySnapshot.ts) so Ctrl+Z actually restores it
// — the `savedRois` omission that file's header warns about, avoided by wiring
// both halves in the same commit. A writer whose value does not actually
// change records NOTHING (no history entry, no new object identity, so no
// dirty flag and no autosave): `removeMapSlice`/`removeMapAnnotation` already
// guarded their no-op, and the view writers now do too.
//
// A dataset REMOVAL drops that dataset's entry — in `store/removeDatasets.ts`,
// the one shared removal patch (so `deleteWorkbook` and the history scrub get
// it for free), not here.

import {
  EMPTY_MAP_VIEWS,
  mapViewFor,
  sameColorLimits,
  sanitizeMapViews,
  type MapAnnotation,
  type MapSliceDef,
  type MapViewMap,
  type MapViewState,
} from "../lib/mapView";
import type { ColormapName } from "../lib/colormap";
import type { CutSpace } from "../lib/mapcuts";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** Slice/annotation id sequences. Module-level (not per-store) so ids stay
 *  unique for the process, the same convention `store/rois.ts`'s `_roiSeq` and
 *  `store/plotViewSettings.ts`'s `_refSeq`/`_annSeq` already use. */
let _sliceSeq = 0;
let _annSeq = 0;

export interface MapViewSlice {
  /** See lib/mapView.ts. ONE entry per dataset id; an absent entry IS
   *  `DEFAULT_MAP_VIEW`, so two simultaneously-open map windows on different
   *  datasets cannot touch each other's state. (The gridding/contour settings
   *  are still app-wide — `MapStage`'s own documented v1 wart — but those are
   *  regrid inputs, not the data-dependent state P2.8 asks to preserve.) */
  mapViews: MapViewMap;

  setMapColormap: (datasetId: string | null, colormap: ColormapName) => void;
  /** The colour SCALE: true = log. */
  setMapLogZ: (datasetId: string | null, logZ: boolean) => void;
  /** Explicit [lo, hi]; null restores auto (the payload's own z extent). */
  setMapColorLimits: (datasetId: string | null, colorLimits: [number, number] | null) => void;

  /** Record a committed H/V/segment slice at its linked position. Returns the
   *  new id, or null when there is no dataset to record it against. The caller
   *  passes everything but the id — see `MapSliceDef`. */
  addMapSlice: (datasetId: string | null, def: Omit<MapSliceDef, "id">) => string | null;
  removeMapSlice: (datasetId: string | null, id: string) => void;

  /** Pin a text label at a map data coordinate, in the axis space the map is
   *  currently showing (null on a plain, non-RSM map). Returns the new id. */
  addMapAnnotation: (
    datasetId: string | null,
    x: number,
    y: number,
    text: string,
    space: CutSpace | null,
  ) => string | null;
  removeMapAnnotation: (datasetId: string | null, id: string) => void;
}

export function createMapViewSlice(set: SliceSet, get: SliceGet): MapViewSlice {
  /** This dataset's entry as it stands (the default when it has none). */
  const at = (datasetId: string): MapViewState => mapViewFor(get().mapViews, datasetId);

  /** Apply `fn` to ONE dataset's entry under ONE history entry. Each caller
   *  checks FIRST that it is really a change: a no-op writer must not consume
   *  an undo step, change the field identity, dirty the project or schedule an
   *  autosave. An entry that edits its way BACK to the default is left in
   *  place — `isDefaultMapViews`/`serializeMapViews` both judge it by value,
   *  so it still costs the saved document nothing. */
  const edit = (datasetId: string, label: string, fn: (v: MapViewState) => MapViewState) => {
    get().recordHistory(label);
    set((s) => ({
      mapViews: { ...s.mapViews, [datasetId]: fn(mapViewFor(s.mapViews, datasetId)) },
    }));
  };

  return {
    mapViews: EMPTY_MAP_VIEWS,

    setMapColormap: (datasetId, colormap) => {
      if (!datasetId || at(datasetId).colormap === colormap) return;
      edit(datasetId, "change map colormap", (v) => ({ ...v, colormap }));
    },
    setMapLogZ: (datasetId, logZ) => {
      if (!datasetId || at(datasetId).logZ === logZ) return;
      edit(datasetId, "change map colour scale", (v) => ({ ...v, logZ }));
    },
    // Unlike `setXLim`/`setYLim` (store/plotViewSettings.ts), which record NO
    // undo entry because a wheel-zoom fires them continuously, the map's
    // colour limits have exactly one entry point — two typed fields committed
    // on blur/Enter (components/Inspector/MapColorLimits.tsx) — so one gesture
    // is one entry and undo stays useful rather than noisy.
    setMapColorLimits: (datasetId, colorLimits) => {
      if (!datasetId || sameColorLimits(at(datasetId).colorLimits, colorLimits)) return;
      edit(datasetId, "change map colour limits", (v) => ({ ...v, colorLimits }));
    },

    addMapSlice: (datasetId, def) => {
      if (!datasetId) return null;
      const id = `mslice-${++_sliceSeq}`;
      edit(datasetId, "add map slice", (v) => ({ ...v, slices: [...v.slices, { ...def, id }] }));
      return id;
    },
    removeMapSlice: (datasetId, id) => {
      if (!datasetId || !at(datasetId).slices.some((s) => s.id === id)) return;
      edit(datasetId, "delete map slice", (v) => ({
        ...v,
        slices: v.slices.filter((s) => s.id !== id),
      }));
    },

    addMapAnnotation: (datasetId, x, y, text, space) => {
      if (!datasetId) return null;
      const id = `mann-${++_annSeq}`;
      edit(datasetId, "add map annotation", (v) => ({
        ...v,
        annotations: [...v.annotations, { id, x, y, text, space }],
      }));
      return id;
    },
    removeMapAnnotation: (datasetId, id) => {
      if (!datasetId || !at(datasetId).annotations.some((a) => a.id === id)) return;
      edit(datasetId, "delete map annotation", (v) => ({
        ...v,
        annotations: v.annotations.filter((a) => a.id !== id),
      }));
    },
  };
}

/** `.dwk` READ hook — `store/useApp.ts`'s `loadWorkspace` restores the map
 *  views through this ONE call (re-exported by `store/rois.ts` so it rides the
 *  import line that module already has there; see this file's header for why
 *  useApp.ts cannot afford a new one).
 *
 *  An absent field (every pre-P2.8 `.dwk`) and a malformed one both give the
 *  empty record, so an old project opens exactly as it did before — the
 *  restore MUST be explicit rather than omitted, or `set()`'s partial merge
 *  would silently leave the PREVIOUS project's map views (their colour limits
 *  and slice positions, in other datasets' units) on the newly opened one.
 *  That cross-project leak is the failure `loadWorkspace`'s own `workbooks`
 *  comment calls out.
 *
 *  `liveDatasetIds` is passed by every caller, `loadWorkspace` included, so a
 *  hand-built `WorkspaceState` cannot install an entry for a dataset this load
 *  does not have. */
export function loadedMapViews(raw: unknown, liveDatasetIds?: ReadonlySet<string>): MapViewMap {
  return sanitizeMapViews(raw, liveDatasetIds);
}

export type { MapAnnotation, MapSliceDef, MapViewMap, MapViewState };
