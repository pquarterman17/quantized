// The peak-recipe preset backend (plans/PRESET_BAR_CONTRACT.md section 3):
// the Peaks panel's named presets ARE the peak recipes in `qz.peakRecipes`,
// read and written in the same shape (lib/peakwizard.ts's `PeakRecipe`), so a
// preset saved here still appears in the Peak analyzer and the Recipe Library
// and a recipe saved there appears here. Nothing is migrated.
//
// Fail closed: a record this build cannot read (a newer version, a malformed
// fit section) is listed locked or rejected with its reason, is never applied,
// keeps its name taken, and passes through every write untouched. A save over
// a readable recipe replaces only its `find` and `model` sections, so the
// Peak analyzer's baseline, range, report and model-fit edits survive. A write
// is read back before it is called saved. Name-keyed: the id IS the name, and a
// rename carries the favourites sidecar (lib/recipeIndex.ts).

import type { PresetAdapter, PresetBackend } from "../../../lib/presetAdapter";
import type { PresetEntry, PresetOutcome } from "../../../lib/presets";
import { resolveSettings } from "../../../lib/presets";
import { dropEntry, moveEntry } from "../../../lib/recipeIndex";
import type { RecipeRef } from "../../../lib/recipeLibrary";
import { PEAK_RECIPE_VERSION, upgradePeakRecipe, type PeakRecipe } from "../../../lib/peakwizard";
import { warnStorageRefused } from "../../../lib/storageWarning";
import { candidateFromRecipe, recipeFromSettings, type PeakPresetSettings } from "./peakPresetSettings";

const KEY = "qz.peakRecipes";
const ref = (name: string): RecipeRef => ({ kind: "peak", scope: "global", id: name });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nameOf = (raw: unknown): string | null => (isObject(raw) && typeof raw.name === "string" ? raw.name : null);

type Raw = { ok: true; records: unknown[] } | { ok: false; reason: string };

function readRaw(): Raw {
  let text: string | null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    return { ok: false, reason: "browser storage is blocked" };
  }
  if (!text) return { ok: true, records: [] };
  try {
    const v: unknown = JSON.parse(text);
    if (Array.isArray(v)) return { ok: true, records: v };
  } catch {
    /* fall through */
  }
  return { ok: false, reason: "the stored peak recipes could not be read, so they were left untouched" };
}

function writeRaw(records: unknown[]): string | null {
  const text = JSON.stringify(records);
  try {
    localStorage.setItem(KEY, text);
    if (localStorage.getItem(KEY) === text) return null;
  } catch {
    /* fall through */
  }
  warnStorageRefused("peak recipe");
  return "browser storage refused the write (full or blocked), so the peak recipe was not saved";
}

/** The recipe a stored record is, or why it is not one this build reads. */
function readRecipe(raw: unknown): { recipe: PeakRecipe } | { locked: boolean; reason: string } {
  if (isObject(raw) && typeof raw.version === "number" && raw.version > PEAK_RECIPE_VERSION) return { locked: true, reason: "needs a newer version of Quantized" };
  try {
    return { recipe: upgradePeakRecipe(raw) };
  } catch (e) {
    return { locked: false, reason: e instanceof Error ? e.message : "not a readable peak recipe" };
  }
}

export function peakRecipeBackend(adapter: PresetAdapter<PeakPresetSettings>): PresetBackend<PeakPresetSettings> {
  const nameProblem = (name: string): string | null => {
    const n = name.trim();
    return !n ? "give the preset a name" : n.length > 64 ? "a preset name is at most 64 characters" : null;
  };
  const indexOf = (records: unknown[], name: string): number => records.findIndex((r) => nameOf(r) === name);

  return {
    sameName: (a, b) => a.trim() === b.trim(),
    list() {
      const file = readRaw();
      if (!file.ok) return { entries: [], unreadable: file.reason };
      const entries: PresetEntry<PeakPresetSettings>[] = [];
      for (const raw of file.records) {
        const name = nameOf(raw);
        if (name === null) continue; // not a recipe at all: preserved, never listed
        const base = { id: name, name, updatedAt: "" };
        const r = readRecipe(raw);
        if ("reason" in r) {
          entries.push({ ...base, state: r.locked ? "locked" : "rejected", reason: r.reason });
          continue;
        }
        const s = resolveSettings(adapter, adapter.schema, candidateFromRecipe(r.recipe));
        entries.push(s.state === "ok" ? { ...base, state: "ok", settings: s.settings, dropped: s.dropped } : { ...base, state: s.state, reason: s.reason });
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return { entries, unreadable: null };
    },

    save(name, settings): PresetOutcome {
      const bad = nameProblem(name);
      if (bad) return { ok: false, reason: bad };
      const parsed = adapter.parse(settings);
      if ("error" in parsed) return { ok: false, reason: `these settings cannot be saved: ${parsed.error}` };
      const file = readRaw();
      if (!file.ok) return { ok: false, reason: file.reason };
      const wanted = name.trim();
      const records = [...file.records];
      const at = indexOf(records, wanted);
      let base: PeakRecipe | undefined;
      if (at >= 0) {
        const old = readRecipe(records[at]);
        if ("reason" in old) return { ok: false, reason: `a saved peak recipe named '${wanted}' could not be read (${old.reason}); choose another name` };
        base = old.recipe;
      }
      const record = recipeFromSettings(wanted, parsed, base);
      if (at >= 0) records[at] = record;
      else records.push(record);
      const failed = writeRaw(records);
      return failed ? { ok: false, reason: failed } : { ok: true, id: wanted, updated: at >= 0 };
    },

    rename(id, name): PresetOutcome {
      const bad = nameProblem(name);
      if (bad) return { ok: false, reason: bad };
      const wanted = name.trim();
      const file = readRaw();
      if (!file.ok) return { ok: false, reason: file.reason };
      const records = [...file.records];
      const at = indexOf(records, id);
      if (at < 0) return { ok: false, reason: "that preset no longer exists" };
      if ("reason" in readRecipe(records[at])) return { ok: false, reason: "a peak recipe this version cannot read is not renamed" };
      if (wanted === id) return { ok: true, id, updated: false };
      if (indexOf(records, wanted) >= 0) return { ok: false, reason: `a preset named '${wanted}' already exists` };
      records[at] = { ...(records[at] as Record<string, unknown>), name: wanted };
      const failed = writeRaw(records);
      if (failed) return { ok: false, reason: failed };
      moveEntry(ref(id), ref(wanted));
      return { ok: true, id: wanted, updated: true };
    },

    remove(id): PresetOutcome {
      const file = readRaw();
      if (!file.ok) return { ok: false, reason: file.reason };
      if (indexOf(file.records, id) < 0) return { ok: false, reason: "that preset no longer exists" };
      const failed = writeRaw(file.records.filter((r) => nameOf(r) !== id));
      if (failed) return { ok: false, reason: failed };
      dropEntry(ref(id));
      return { ok: true, id, updated: true };
    },
  };
}
