// Named sample profiles (MAIN_PLAN #42) — the CRUD half of the Units tab.
// The list itself lives in the store (store/sampleProfiles.ts) so it
// round-trips through `.dwk` and undo; the decisions live here, in the lazy
// MagTools chunk.
//
// Saving is always explicit (a button with a typed name). Loading is always
// explicit (pick one, press Load) and only fills the form: it never picks a
// normalization basis, never runs Apply, and never edits any dataset — so a
// dataset's existing normalization can never be overwritten by a profile.

import { dedupeWindowTitle } from "../../../lib/plotWindows";
import {
  MAX_SAVED_SAMPLE_PROFILES,
  sanitizeSampleProfile,
  type SampleProfile,
  type SavedSampleProfile,
} from "../../../lib/sampleGeometry";
import { useApp } from "../../../store/useApp";

let seq = 0;
const nextProfileId = (): string => `sprof-${Date.now().toString(36)}-${++seq}`;

export interface SampleProfilesApi {
  saved: SavedSampleProfile[];
  /** Save `profile` under `name` (deduped against existing names, never
   *  replacing one). Refuses a blank name, and a list already at the
   *  `.dwk` cap ({@link MAX_SAVED_SAMPLE_PROFILES}) — a save the next load
   *  would silently truncate is not a save. */
  save: (name: string, profile: SampleProfile) => { ok: true; name: string } | { ok: false; reason: string };
  /** The saved profile, re-sanitized, or null for an unknown id. */
  get: (id: string) => SampleProfile | null;
  remove: (id: string) => void;
}

export function useSampleProfiles(): SampleProfilesApi {
  const saved = useApp((s) => s.savedSampleProfiles);
  const setSaved = useApp((s) => s.setSavedSampleProfiles);
  return {
    saved,
    save: (name, profile) => {
      const clean = sanitizeSampleProfile(profile);
      const base = name.trim().slice(0, 120);
      if (!base || !clean) return { ok: false, reason: "Name the profile before saving it." };
      if (saved.length >= MAX_SAVED_SAMPLE_PROFILES) {
        return { ok: false, reason: `At most ${MAX_SAVED_SAMPLE_PROFILES} sample profiles can be saved; delete one first.` };
      }
      let stored = base;
      setSaved((list) => {
        stored = dedupeWindowTitle(base, list.map((p) => p.name));
        return [...list, { id: nextProfileId(), name: stored, savedAt: new Date().toISOString(), profile: clean }];
      }, "Save sample profile");
      return { ok: true, name: stored };
    },
    get: (id) => sanitizeSampleProfile(saved.find((p) => p.id === id)?.profile),
    remove: (id) => setSaved((list) => (list.some((p) => p.id === id) ? list.filter((p) => p.id !== id) : list), "Delete sample profile"),
  };
}
