// The durable 2-D map view slice (PRIMARY_SOFTWARE_AUDIT_PLAN P2.8 —
// "Preserve existing H/V/segment slices and link positions" + "Persist color
// limits/scale/map/slices/annotations").
//
// Composed into the ONE `useApp` store instance through `store/rois.ts`'s own
// creator (`createRoisSlice` spreads `createMapViewSlice(set, get)` and
// `RoisSlice extends MapViewSlice`), NOT through a fourth spread of its own in
// `store/useApp.ts`. Two reasons, in order:
//   1. `store/useApp.ts` sits EXACTLY at its store-size pin (2122 lines,
//      architecture.test.ts's STORE_PINS, ratchet-down only) with zero
//      headroom, and that pin is the whole reason `store/rois.ts` exists at
//      all — read its header. A new import line + extends entry + spread line
//      there would have to be funded by an extraction unrelated to this work.
//   2. It is where the reader already looks: `rois.ts` owns `rsmPeaks`
//      ("markers on the 2D map") for the same cohesion reason, and the box /
//      ruler / sector geometry this view's slices sit beside.
// Nesting is a composition detail only — `useApp((s) => s.mapView)` and
// `useApp.getState().setMapColorLimits(...)` work exactly as for any other
// field, because the composed `AppState` is flat.
//
// WHAT THIS MODULE OWNS: the `mapView` field (lib/mapView.ts's `MapViewState`)
// and every writer of it — the colormap, the linear/log colour scale, the
// explicit colour limits, the committed H/V/segment slice definitions, the map
// annotations, and `bindMapView`, the ONE place the preservation rule lives.
//
// UNDO: every writer but `bindMapView` records an undo entry, and `mapView` is
// a named field of `HistorySnapshot` (store/historySnapshot.ts) so Ctrl+Z
// actually restores it — the `savedRois` omission that file's header warns
// about, avoided by wiring both halves in the same commit. `bindMapView`
// records none deliberately: it is not an edit, it is the map reacting to
// which dataset is active (the same class as `setActive`'s own view rebind,
// which is likewise not an undo step of its own).

import {
  DEFAULT_MAP_VIEW,
  sanitizeMapView,
  type MapAnnotation,
  type MapSliceDef,
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
  /** See lib/mapView.ts. One app-wide record, bound to a single dataset id —
   *  the same documented v1 wart `MapStage`'s own header records for the
   *  gridding/contour settings: two simultaneously-open map windows share it. */
  mapView: MapViewState;

  /** Point the map view at `datasetId`, applying P2.8's preservation rule:
   *
   *    re-activating the SAME dataset keeps everything; a GENUINE switch to
   *    another dataset drops the data-dependent state.
   *
   *  This is BUG-012's rule for the authored x-axis break, applied to the map
   *  (`store/windows.ts`'s `focusedRebindPatch` spells the same test as
   *  `s.activeId === id ? {} : …`). "Data-dependent" is exact: the colour
   *  LIMITS are in the old map's z units, the slice positions and annotations
   *  in its x/y units — none of them describe the new map, so all three reset.
   *  The colormap and the linear/log scale are NOT data-dependent (they are
   *  the user's reading preference, meaningful on any map) and survive, which
   *  is also what makes comparing two maps in the same colours possible.
   *
   *  Returns the SAME object identity on the no-op path, so calling it from a
   *  render effect cannot loop, dirty the project, or schedule an autosave. */
  bindMapView: (datasetId: string | null) => void;

  setMapColormap: (colormap: ColormapName) => void;
  /** The colour SCALE: true = log. */
  setMapLogZ: (logZ: boolean) => void;
  /** Explicit [lo, hi]; null restores auto (the payload's own z extent). */
  setMapColorLimits: (colorLimits: [number, number] | null) => void;

  /** Record a committed H/V/segment slice at its linked position. Returns the
   *  new id. The caller passes everything but the id — see `MapSliceDef`. */
  addMapSlice: (def: Omit<MapSliceDef, "id">) => string;
  removeMapSlice: (id: string) => void;

  /** Pin a text label at a map data coordinate, in the axis space the map is
   *  currently showing (null on a plain, non-RSM map). Returns the new id. */
  addMapAnnotation: (x: number, y: number, text: string, space: CutSpace | null) => string;
  removeMapAnnotation: (id: string) => void;
}

export function createMapViewSlice(set: SliceSet, get: SliceGet): MapViewSlice {
  const patch = (fn: (v: MapViewState) => MapViewState) =>
    set((s) => ({ mapView: fn(s.mapView) }));

  return {
    mapView: DEFAULT_MAP_VIEW,

    bindMapView: (datasetId) => {
      const cur = get().mapView;
      if (cur.datasetId === datasetId) return; // re-activation — keep everything
      set({
        mapView: {
          ...DEFAULT_MAP_VIEW,
          datasetId,
          colormap: cur.colormap,
          logZ: cur.logZ,
        },
      });
    },

    setMapColormap: (colormap) => {
      get().recordHistory("change map colormap");
      patch((v) => ({ ...v, colormap }));
    },
    setMapLogZ: (logZ) => {
      get().recordHistory("change map colour scale");
      patch((v) => ({ ...v, logZ }));
    },
    // Unlike `setXLim`/`setYLim` (store/plotViewSettings.ts), which record NO
    // undo entry because a wheel-zoom fires them continuously, the map's
    // colour limits have exactly one entry point — two typed fields committed
    // on blur/Enter (components/Inspector/MapColorLimits.tsx) — so one gesture
    // is one entry and undo stays useful rather than noisy.
    setMapColorLimits: (colorLimits) => {
      get().recordHistory("change map colour limits");
      patch((v) => ({ ...v, colorLimits }));
    },

    addMapSlice: (def) => {
      const id = `mslice-${++_sliceSeq}`;
      get().recordHistory("add map slice");
      patch((v) => ({ ...v, slices: [...v.slices, { ...def, id }] }));
      return id;
    },
    removeMapSlice: (id) => {
      if (!get().mapView.slices.some((s) => s.id === id)) return;
      get().recordHistory("delete map slice");
      patch((v) => ({ ...v, slices: v.slices.filter((s) => s.id !== id) }));
    },

    addMapAnnotation: (x, y, text, space) => {
      const id = `mann-${++_annSeq}`;
      get().recordHistory("add map annotation");
      patch((v) => ({ ...v, annotations: [...v.annotations, { id, x, y, text, space }] }));
      return id;
    },
    removeMapAnnotation: (id) => {
      if (!get().mapView.annotations.some((a) => a.id === id)) return;
      get().recordHistory("delete map annotation");
      patch((v) => ({ ...v, annotations: v.annotations.filter((a) => a.id !== id) }));
    },
  };
}

/** `.dwk` READ hook — `store/useApp.ts`'s `loadWorkspace` restores the map
 *  view through this ONE call (re-exported by `store/rois.ts` so it rides the
 *  import line that module already has there; see this file's header for why
 *  useApp.ts cannot afford a new one).
 *
 *  An absent field (every pre-P2.8 `.dwk`) and a malformed one both give the
 *  default view, so an old project opens exactly as it did before — the
 *  restore MUST be explicit rather than omitted, or `set()`'s partial merge
 *  would silently leave the PREVIOUS project's map view (its colour limits and
 *  slice positions, in another dataset's units) on the newly opened one. That
 *  cross-project leak is the failure `loadWorkspace`'s own `workbooks` comment
 *  calls out. */
export function loadedMapView(raw: unknown, liveDatasetIds?: ReadonlySet<string>): MapViewState {
  return sanitizeMapView(raw, liveDatasetIds);
}

export type { MapAnnotation, MapSliceDef, MapViewState };
