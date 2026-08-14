// The region-shades slice (F2.3j — decoded film-stack shades are user-
// editable plot objects, not immutable provenance, owner decision
// 2026-08-13): owns BOTH the `regionShades` array itself (a `PlotView`
// field — see `lib/plotview.ts`, swapped per-window exactly like `shapes`/
// `refLines`) and its create/edit/remove actions, composed into the ONE
// useApp store instance the same way `./shapes.ts` is (read that file's
// header first — same "kept tiny so it doesn't grow useApp.ts past its
// store-size ratchet pin" reasoning; useApp.ts is near its own pin, so this
// feature's actions live here instead of inline in useApp.ts's action list).
//
// Before F2.3j, `regionShades` lived directly on useApp.ts's AppState with
// NO create/edit/remove actions at all — only REPLACED wholesale by
// `applyOriginFigure`'s decode-plan #41 apply flow (`originRegionShades`).
// Those `set({ regionShades: … })` call sites are untouched by this move —
// they read/write the same AppState field, just no longer declared/
// initialized in useApp.ts itself. This slice adds the missing create/edit/
// remove half `Inspector/RegionShadesCard.tsx` needs.

import type { RegionShade } from "../lib/types";
import type { AppState } from "./useApp";

let _shadeSeq = 0;

export interface RegionShadesSlice {
  /** Filled rectangular regions pinned at data coordinates (Origin `Rect*`
   *  bands, decode-plan #41 — see `RegionShade`'s own doc). A `PlotView`
   *  field, swapped per-window like `shapes`/`refLines`; also REPLACED
   *  wholesale by `applyOriginFigure` (see that action's own comments). */
  regionShades: RegionShade[];
  /** Inspector "Region shades" card Add form; returns the new shade's id. */
  addRegionShade: (shade: Omit<RegionShade, "id">) => string;
  /** Commit an edit (coordinate/fill/axis field) to one shade by id. No-op
   *  for an unknown id. */
  updateRegionShade: (id: string, patch: Partial<Omit<RegionShade, "id">>) => void;
  removeRegionShade: (id: string) => void;
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export function createRegionShadesSlice(set: SliceSet, get: SliceGet): RegionShadesSlice {
  return {
    regionShades: [],
    addRegionShade: (shade) => {
      const id = `shade-${++_shadeSeq}`;
      get().recordHistory("add region shade");
      set((s) => ({ regionShades: [...s.regionShades, { ...shade, id }] }));
      return id;
    },
    updateRegionShade: (id, patch) => {
      get().recordHistory("edit region shade");
      set((s) => ({
        regionShades: s.regionShades.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)),
      }));
    },
    removeRegionShade: (id) => {
      get().recordHistory("delete region shade");
      set((s) => ({ regionShades: s.regionShades.filter((sh) => sh.id !== id) }));
    },
  };
}
