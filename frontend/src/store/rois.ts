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
// undoable). It now ALSO round-trips through `.dwk` (item 13): `serializeRois`/
// `deserializeRois` below are lib/workspace.ts's ONLY hook into this slice —
// that module extracted `mergeWorkspace` to `lib/workspaceMerge.ts` to fund
// the few lines this hook-in costs (its own pin dropped from 754 accordingly;
// see workspace.test.ts's "workspace saved-ROI persistence" suite for the
// round-trip + back-compat + corrupt-entry coverage). Deliberately NOT
// `mapRoi`/`mapRuler` — those are the WORKING/in-progress box or ruler, the
// ROI analogue of an unsaved Graph Builder spec-in-progress (which also
// doesn't survive a `.dwk`, only a named `savedPlotSpec` does): they carry no
// name/identity to validate against on reload, and restoring one after a
// restart onto whatever dataset happens to be active could show a box drawn
// against a completely different map's axes. Surviving a dataset SWITCH
// within a session (this file's next comment block) is a different, narrower
// guarantee than surviving an app RESTART — only the named, saved definitions
// get the latter.
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
//
// `mapSector` (MAIN_PLAN item 41, folded up from RSM_CUTS_PLAN #25) joins
// mapRoi/mapRuler here for the identical reason: it is the SECTOR tool's
// working geometry (annulus bounds, the center/bounds entry-mode toggle,
// and the profile bins/reduce-mode config) — `workshops/roicuts/
// useRoiCuts.ts` now reads/writes it exactly like it already does `mapRoi`,
// so a value typed into the panel and a drag on `Stage/useMapSectorWedge.ts`'s
// wedge are the SAME store field, in sync for free. It used to be
// component-local `useState` inside `useRoiCuts.ts`, which is why the wedge
// had to mount a SECOND `useRoiCuts()` instance and drive its setters
// directly to reach it — a second, independently-mounted `RoiCutsPanel`
// never saw a live drag from the first. Moving it here is that fix, not a
// new feature. Same non-`.dwk`, non-undo treatment as mapRoi/mapRuler and
// for the same reason: in-progress scratch, not a committed/named edit —
// `serializeRois` below stays `savedRois`-only, and `store/history.ts`'s
// `HistorySnapshot` is an inclusion allowlist `mapSector` is deliberately
// left off, exactly how mapRoi/mapRuler are already excluded from it.
// Unlike mapRoi/mapRuler it is NOT nullable — the Sector card always shows
// values (a full-circle default), so there is no "nothing drawn yet" state
// to represent; `useRoiCuts.ts`'s per-active-dataset effect re-primes it
// from the new dataset's own extents, unchanged from when that reset lived
// in local state.

import type { CutSpace } from "../lib/mapcuts";
import type { RsmPeak } from "../lib/types";
import type { RoiDef, RoiRect, RoiRuler, RoiSector } from "../lib/roi";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

let _roiSeq = 0;
const nextRoiId = (): string => `roi-${Date.now().toString(36)}-${++_roiSeq}`;

/** The Sector card's working fields (MAIN_PLAN item 41) — an annulus in
 *  `phiMin..phiMax` / `secMin..secMax` (the latter is q-magnitude on the
 *  true-polar branch, a secondary axis extent on the pole-figure branch —
 *  see `useRoiCuts.ts::polarBranch`), the center/half-width vs min/max entry
 *  toggle (`phiParam`), and the profile request's bins/reduce mode. Raw
 *  fields only — which of `phiMin/phiMax` vs `phiCenter/phiHalfWidth` is
 *  CANONICAL right now depends on `phiParam`; `useRoiCuts.ts::
 *  effectivePhiBounds` resolves that, same division of labour as this
 *  file's other pure-data-in-here / derivation-in-the-hook slices. */
export interface MapSectorState {
  phiParam: "center" | "bounds";
  phiCenter: number;
  phiHalfWidth: number;
  phiMin: number;
  phiMax: number;
  secMin: number;
  secMax: number;
  sectorBins: number;
  sectorMode: "sum" | "mean";
  /** Internal bookkeeping, not shown by either card: the dataset id
   *  `useRoiCuts.ts`'s per-active-dataset effect last (re-)primed these
   *  fields for. Now that the fields are SHARED (this file's whole point),
   *  that effect fires from every mounted consumer — the wedge AND the
   *  panel, independently — and a naive "reset every mount" would let a
   *  panel opened AFTER a wedge drag silently discard it the instant it
   *  mounts. Matching `primedFor` against the active id lets a second
   *  mount for the SAME dataset no-op instead, while a REAL dataset switch
   *  (the id actually changing) still re-primes exactly as before. */
  primedFor: string | null;
}

/** Full-circle, q-range-yet-to-be-primed defaults — `useRoiCuts.ts`'s
 *  per-active-dataset effect immediately overwrites `secMin`/`secMax`/
 *  `sectorBins` from the dataset's own extents, exactly as it did when
 *  these were local `useState` initializers. */
const DEFAULT_MAP_SECTOR: MapSectorState = {
  phiParam: "bounds",
  phiCenter: 0,
  phiHalfWidth: 180,
  phiMin: 0,
  phiMax: 360,
  secMin: 0,
  secMax: 1,
  sectorBins: 100,
  sectorMode: "sum",
  primedFor: null,
};

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

  /** The live/working sector/annulus — see this file's header. Both the
   *  Sector card's numeric fields (`useRoiCuts.ts`) and the draggable wedge
   *  (`Stage/useMapSectorWedge.ts`) read/write this ONE field, mirroring
   *  `mapRoi`'s "same field = in sync" contract. Never null (see header);
   *  always a MERGE patch, not a whole-value replace — every writer touches
   *  one or two fields at a time, unlike `mapRoi`'s cohesive single rect. */
  mapSector: MapSectorState;
  setMapSector: (patch: Partial<MapSectorState>) => void;

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

    mapSector: DEFAULT_MAP_SECTOR,
    setMapSector: (patch) => set((st) => ({ mapSector: { ...st.mapSector, ...patch } })),

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

// ── `.dwk` persistence (RSM_CUTS_PLAN item 13) ──────────────────────────────
// lib/workspace.ts's ONLY hook into this slice — it calls these two
// functions and never touches RoiDef's shape itself, mirroring how
// lib/plotspec.ts owns `sanitizeSavedPlotSpecs` for `savedPlotSpecs`.

/** Serialize `savedRois` for the .dwk doc. A defensive shallow copy — RoiDef
 *  is already plain JSON-safe data (no dataset references, no undefined-vs-
 *  absent optionals to trim, unlike Dataset's own serialize in workspace.ts). */
export function serializeRois(rois: RoiDef[]): RoiDef[] {
  return rois.map((r) => ({ ...r }));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isCutSpace(v: unknown): v is CutSpace {
  return v === "angular" || v === "q";
}

function isRoiRectShape(v: unknown): v is RoiRect {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isCutSpace(o.space) &&
    isFiniteNumber(o.x0) &&
    isFiniteNumber(o.x1) &&
    isFiniteNumber(o.y0) &&
    isFiniteNumber(o.y1)
  );
}

function isRoiRulerShape(v: unknown): v is RoiRuler {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isCutSpace(o.space) &&
    isFiniteNumber(o.cx) &&
    isFiniteNumber(o.cy) &&
    isFiniteNumber(o.angle) &&
    isFiniteNumber(o.length) &&
    isFiniteNumber(o.width)
  );
}

function isRoiSectorShape(v: unknown): v is RoiSector {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isFiniteNumber(o.qMin) &&
    isFiniteNumber(o.qMax) &&
    isFiniteNumber(o.phiMin) &&
    isFiniteNumber(o.phiMax)
  );
}

/** Validate persisted `savedRois` entries from a .dwk. A hand-edited or
 *  otherwise malformed entry is skipped (named in `warnings`, lib/workspace.ts's
 *  `migrationWarnings`) rather than throwing or poisoning the rest of the
 *  list — mirrors lib/plotspec.sanitizeSavedPlotSpecs' shape. Absent/non-array
 *  input (a pre-item-13 .dwk) degrades to an empty list, no warning. */
export function deserializeRois(v: unknown, warnings: string[]): RoiDef[] {
  if (!Array.isArray(v)) return [];
  const out: RoiDef[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") continue;
    if (o.kind === "rect" && isRoiRectShape(o.rect)) {
      out.push({ id: o.id, name: o.name, kind: "rect", rect: o.rect });
    } else if (o.kind === "ruler" && isRoiRulerShape(o.ruler)) {
      out.push({ id: o.id, name: o.name, kind: "ruler", ruler: o.ruler });
    } else if (o.kind === "sector" && isRoiSectorShape(o.sector)) {
      out.push({ id: o.id, name: o.name, kind: "sector", sector: o.sector });
    } else {
      warnings.push(`skipped saved ROI "${o.name}" with an invalid or unknown shape`);
    }
  }
  return out;
}
