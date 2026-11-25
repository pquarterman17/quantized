// Preferences ▸ Reset (PREFS_AUDIT P1-3): back to the shipped defaults, for one
// tab's fields or for every preference. Settings only: content slots
// (templates, recipes, fit models, history, autosave) are never touched.
// Lazy: only the Preferences dialog imports this.

import { PREF_DEFAULTS } from "../store/prefs";
import { useApp, type PrefKey } from "../store/useApp";
import { allPrefSlots, type PrefSlot } from "./prefSlots";

/** What one reset covers: `qz.prefs` fields, side slots, and any extra step
 *  (a pref with its own writer, e.g. the default graph template). */
export interface ResetSpec {
  prefs?: readonly PrefKey[];
  slots?: readonly PrefSlot<object>[];
  extra?: () => void;
}

export function resetPrefFields(keys: readonly PrefKey[]): void {
  const st = useApp.getState();
  for (const k of keys) {
    if (k === "theme") continue; // derived from themeMode
    if (k === "layoutMode") {
      // its own writer (store/windowLayout.ts); turning windows off keeps the layout
      if (st.layoutMode !== PREF_DEFAULTS.layoutMode) void st.setLayoutMode(PREF_DEFAULTS.layoutMode);
      continue;
    }
    if (st[k] !== PREF_DEFAULTS[k]) st.setPref(k, PREF_DEFAULTS[k] as string | number | boolean);
  }
}

export function resetSpec(spec: ResetSpec): void {
  if (spec.prefs) resetPrefFields(spec.prefs);
  for (const slot of spec.slots ?? []) slot.reset();
  spec.extra?.();
}

/** Every preference: all `qz.prefs` fields (panel widths included), every
 *  declared slot, plus each tab's extra step. */
export function resetAllPrefs(extras: readonly (() => void)[] = []): void {
  resetPrefFields(Object.keys(PREF_DEFAULTS) as PrefKey[]);
  for (const slot of allPrefSlots()) slot.reset();
  for (const x of extras) x();
}
