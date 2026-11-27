// Library row actions for the preset kind (item 40 slice P6) that need no tool:
// rename and delete go straight to the generic store (lib/presets.ts), which
// already refuses a locked preset's rename and read-modify-writes the raw file.
// "Open in tool" is in presetRecipeOpen.ts (lazy: it loads adapters).

import { asRecord, deletePreset, readPresetsFile, renamePreset } from "../../../lib/presets";
import { PRESET_WORKSHOPS } from "../../../lib/presetWorkshops";
import type { RecipeRef } from "../../../lib/recipeLibrary";
import type { ActionResult } from "./recipeActions";

/** The preset record behind a ref (null when deleted since the list was drawn, or the file is unreadable). */
export function presetRecordFor(ref: RecipeRef) {
  const file = readPresetsFile();
  return file.ok ? (file.records.map(asRecord).find((r) => r?.id === ref.id) ?? null) : null;
}

export function renamePresetRecipe(ref: RecipeRef, name: string): ActionResult {
  const rec = presetRecordFor(ref);
  if (!rec) return { ok: false, reason: "that preset no longer exists" };
  // An unknown tool's schema is treated as unreadable (newer): never edited.
  const schema = PRESET_WORKSHOPS[rec.workshop]?.schema ?? 0;
  const out = renamePreset({ workshop: rec.workshop, schema }, rec.id, name);
  return out.ok ? { ok: true, message: "renamed", ref } : { ok: false, reason: out.reason };
}

export function deletePresetRecipe(ref: RecipeRef): ActionResult {
  const rec = presetRecordFor(ref);
  if (!rec) return { ok: false, reason: "that preset no longer exists" };
  const out = deletePreset({ workshop: rec.workshop }, rec.id);
  return out.ok ? { ok: true, message: "deleted" } : { ok: false, reason: out.reason };
}
