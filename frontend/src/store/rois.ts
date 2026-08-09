// The ROI slice (RSM_CUTS_PLAN item 4): box/ruler/sector state for the
// RSM map's cut tools, extracted out of useApp.ts under the store-size
// ratchet (architecture.test.ts's STORE_PINS) exactly like store/windows.ts
// / store/graphBuilder.ts — useApp.ts sits AT its pin (2868) with ZERO
// headroom, so this slice's own composition lines (import + AppState extends
// member + the `...createRoisSlice(set, get)` spread) are paid for by
// RELOCATING `rsmPeaks`/`setRsmPeaks` out of useApp.ts into this file
// (item 4's explicit instruction — the two are cohesive: both are RSM
// map-overlay state). This is a pure relocation: every existing
// `useApp((s) => s.rsmPeaks)` / `useApp((s) => s.setRsmPeaks)` selector, and
// every `rsmPeaks: null` Partial<AppState> patch elsewhere (windows.ts's
// `focusTransientReset`, useApp.ts's `duplicateDataset`), keeps compiling
// and working unchanged — they only ever reference the FIELD, which still
// exists on the composed `AppState` via this slice's entry in the `extends`
// list, never the file it happens to live in.
//
// `savedRois` (item 8's Saved ROIs card) follows the exact CRUD shape
// `store/graphBuilder.ts`'s `savedPlotSpecs` already established (save /
// duplicate-by-apply / delete, each wrapped in `recordHistory` so it's
// undoable) — deliberately NOT persisted to `.dwk` yet (Tier 3 item 13 is
// blocked on `lib/workspace.ts`'s own zero-slack pin); in-memory only until
// that lands.
//
// WHY mapRoi/mapRuler are NOT in `focusTransientReset` (windows.ts) — this
// is the one deliberate exception every other transient tool/gadget field in
// that list is subject to, so it needs stating once, here, where a future
// reader who notices the asymmetry will look: Resolved decisions says a
// drawn/typed ROI "survives across dataset switches" ON PURPOSE — that IS
// the "repeat this cut on the next dataset" workflow the batch feature
// (item 9) builds on. Clearing it on every focus/dataset switch (like
// `fitOverlay`/`peakOverlay`/the gadget results are) would make a user
// re-draw the same box for every map they compare, defeating the point of
// having a NAMED, sticky selection at all. `rsmPeaks`, by contrast, keeps
// its historical clear-on-switch behavior (still routed through
// `focusTransientReset`) — markers belong to the analysis run that produced
// them, not to a box the user is actively reusing.

import type { RsmPeak } from "../lib/types";
import type { RoiDef, RoiRect, RoiRuler } from "../lib/roi";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

let _roiSeq = 0;
const nextRoiId = (): string => `roi-${Date.now().toString(36)}-${++_roiSeq}`;

export interface RoisSlice {
  // Relocated verbatim from useApp.ts — see this file's header.
  rsmPeaks: { datasetId: string; peaks: RsmPeak[] } | null; // markers on the 2D map
  setRsmPeaks: (rsmPeaks: { datasetId: string; peaks: RsmPeak[] } | null) => void;

  /** The live/working box ROI — drawn on the map (item 6's `useMapRoi`) OR
   *  typed into the panel (item 8's numeric fields); Resolved decisions:
   *  "type exact bounds -> RoiCutsPanel fields -> store.mapRoi (same field
   *  = in sync)", so both entry points read/write this ONE field. Survives
   *  a dataset switch — see this file's header for why. */
  mapRoi: RoiRect | null;
  setMapRoi: (mapRoi: RoiRect | null) => void;
  /** The live/working cut ruler (item 7's radial/transverse tool) — same
   *  survive-a-dataset-switch contract as `mapRoi`. */
  mapRuler: RoiRuler | null;
  setMapRuler: (mapRuler: RoiRuler | null) => void;

  /** Every named saved ROI (item 8's Saved ROIs card): box, ruler, or
   *  sector. In-memory only until item 13 pays `lib/workspace.ts`'s pin for
   *  `.dwk` round-tripping. */
  savedRois: RoiDef[];
  /** Save the CURRENT working ROI under `name` ("" -> "Untitled ROI") —
   *  `mapRoi` wins if both a box and a ruler are somehow set (shouldn't
   *  happen: `applySavedRoi`/the drawing tools keep them mutually
   *  exclusive, but this stays defensive rather than silently dropping a
   *  ruler). Returns the new saved id, or null when NEITHER is set (nothing
   *  to save). */
  saveRoi: (name: string) => string | null;
  /** Load a saved ROI back into the matching working slot (`mapRoi` for
   *  kind:"rect", `mapRuler` for kind:"ruler"), clearing the OTHER slot so
   *  the map never shows a stale box behind a newly-applied ruler (or vice
   *  versa). A kind:"sector" entry has no working-slot counterpart —
   *  item 8's sector card owns its own numeric fields directly — so this is
   *  a no-op for it (the panel reads `savedRois` itself to populate them).
   *  A no-op for an unknown id, matching `applySavedRoi`'s siblings
   *  elsewhere in the store (e.g. `setActivePlotSpecId`'s neighbors). */
  applySavedRoi: (id: string) => void;
  /** Removes the saved entry. A no-op for an unknown id. */
  removeSavedRoi: (id: string) => void;
}

export function createRoisSlice(set: SliceSet, get: SliceGet): RoisSlice {
  return {
    rsmPeaks: null,
    setRsmPeaks: (rsmPeaks) => set({ rsmPeaks }),

    mapRoi: null,
    setMapRoi: (mapRoi) => set({ mapRoi }),
    mapRuler: null,
    setMapRuler: (mapRuler) => set({ mapRuler }),

    savedRois: [],
    saveRoi: (name) => {
      const s = get();
      const nm = name.trim() || "Untitled ROI";
      const def: RoiDef | null = s.mapRoi
        ? { id: nextRoiId(), name: nm, kind: "rect", rect: s.mapRoi }
        : s.mapRuler
          ? { id: nextRoiId(), name: nm, kind: "ruler", ruler: s.mapRuler }
          : null;
      if (!def) return null;
      get().recordHistory("save ROI");
      set((st) => ({ savedRois: [...st.savedRois, def] }));
      return def.id;
    },
    applySavedRoi: (id) => {
      const def = get().savedRois.find((r) => r.id === id);
      if (!def) return;
      if (def.kind === "rect") set({ mapRoi: def.rect, mapRuler: null });
      else if (def.kind === "ruler") set({ mapRuler: def.ruler, mapRoi: null });
      // kind:"sector" — see the field's own doc above; item 8 reads
      // savedRois directly for its sector card, no working-slot hand-off.
    },
    removeSavedRoi: (id) => {
      if (!get().savedRois.some((r) => r.id === id)) return;
      get().recordHistory("remove saved ROI");
      set((st) => ({ savedRois: st.savedRois.filter((r) => r.id !== id) }));
    },
  };
}
