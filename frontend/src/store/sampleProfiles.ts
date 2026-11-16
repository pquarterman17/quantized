// MAIN_PLAN #42: explicitly saved, named sample profiles. Round-trips through
// `.dwk` (lib/workspace.ts parses with `sanitizeSavedSampleProfiles`; absent
// = none) and is undoable (store/historySnapshot.ts). Every CRUD decision —
// naming, dedupe, delete — lives in the lazy MagTools workshop
// (components/workshops/magtools/useSampleProfiles.ts); this eager slice is
// only the field and one undoable setter, so the workshop's code stays out
// of the entry chunk.
//
// A saved profile is NEVER applied by technique, filename or similarity: its
// only consumer loads one into the form when the user picks it, and even then
// it only fills the form — no dataset's existing normalization is touched.
//
// Gap audit 5 lane J: the Recode workshop's saved mappings ride this slice
// (the same "named saved preset, project-scoped" class; useApp.ts has no room
// for a slice of its own). Same rules: round-trips `.dwk`, undoable, never
// applied automatically (store/recode.ts applies one only when picked).

import type { SavedRecodeMapping } from "../lib/recode";
import type { SavedSampleProfile } from "../lib/sampleGeometry";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

export interface SampleProfilesSlice {
  savedSampleProfiles: SavedSampleProfile[];
  /** Replace the saved list with `update(current)` as ONE undoable step
   *  labelled `label`; returning the same array is a no-op (no history). */
  setSavedSampleProfiles: (update: (list: SavedSampleProfile[]) => SavedSampleProfile[], label: string) => void;
  /** Written only by store/recode.ts (lazy), as one undo step + one set. */
  savedRecodeMappings: SavedRecodeMapping[];
}

export function createSampleProfilesSlice(set: SliceSet, get: SliceGet): SampleProfilesSlice {
  return {
    savedSampleProfiles: [],
    setSavedSampleProfiles: (update, label) => {
      const next = update(get().savedSampleProfiles);
      if (next === get().savedSampleProfiles) return;
      get().recordHistory(label);
      set({ savedSampleProfiles: next });
    },
    savedRecodeMappings: [],
  };
}
