// "Last used" settings per tool (plans/PRESET_BAR_CONTRACT.md P3, P4): a
// PREFERENCE slot, `qz.presetLastUsed`, one entry per workshop. It is written
// when a run succeeds (never on Apply or Cancel), offered by the preset bar,
// and applied on its own only when the opt-in "Start tools with their
// last-used settings" is on. Tiny on purpose: Preferences ▸ Reset all and the
// server prefs sync import it so the slot is declared before they list slots.

import type { PresetAdapter } from "./presetAdapter";
import { definePrefSlot } from "./prefSlots";

export interface LastUsedEntry {
  schema: number;
  settings: Record<string, unknown>;
  at: string;
}
export type LastUsed = Record<string, LastUsedEntry>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parse(raw: Record<string, unknown>): LastUsed {
  const out: LastUsed = {};
  for (const [workshop, e] of Object.entries(raw)) {
    if (isObject(e) && typeof e.schema === "number" && Number.isInteger(e.schema) && e.schema >= 1 && isObject(e.settings) && typeof e.at === "string") {
      out[workshop] = { schema: e.schema, settings: e.settings, at: e.at };
    }
  }
  return out;
}

export const lastUsedSlot = definePrefSlot<LastUsed>("qz.presetLastUsed", {}, parse);

export const readLastUsed = (workshop: string): LastUsedEntry | null => lastUsedSlot.load()[workshop] ?? null;

/** Remember `settings` after a successful run. A newer build's entry is never
 *  overwritten (P7), and an identical entry is not rewritten. */
export function recordLastUsed<S extends object>(adapter: Pick<PresetAdapter<S>, "workshop" | "schema">, settings: S): boolean {
  const all = lastUsedSlot.load();
  const prev = all[adapter.workshop];
  if (prev && prev.schema > adapter.schema) return false;
  if (prev && prev.schema === adapter.schema && JSON.stringify(prev.settings) === JSON.stringify(settings)) return false;
  lastUsedSlot.save({ ...all, [adapter.workshop]: { schema: adapter.schema, settings: { ...settings } as Record<string, unknown>, at: new Date().toISOString() } });
  return true;
}
