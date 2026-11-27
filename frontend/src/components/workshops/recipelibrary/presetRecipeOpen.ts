// "Open in tool" for a preset row (item 40 slice P6; contract P8): validate the
// preset through its tool's adapter, open that tool, and hand it the preset so
// the tool's own preset bar loads the DRAFT (store/pendingPreset.ts). Nothing
// here runs a tool, creates a result or touches data. Fail closed: a locked or
// rejected preset, an unknown tool, or a tool that cannot open (Resample with
// no dataset) opens nothing and says why.

import { resolveSettings } from "../../../lib/presets";
import { PRESET_WORKSHOPS } from "../../../lib/presetWorkshops";
import type { RecipeRef } from "../../../lib/recipeLibrary";
import { PRESET_OPENERS } from "../../../store/presetOpeners";
import { usePendingPreset } from "../../../store/pendingPreset";
import { recordRecipeUse } from "../../../store/recordRecipeUse";
import { loadPresetAdapters } from "../presets/presetRegistry";
import { presetRecordFor } from "./presetRecipeOps";
import type { ActionResult } from "./recipeActions";

export async function openPresetInTool(ref: RecipeRef): Promise<ActionResult> {
  const rec = presetRecordFor(ref);
  if (!rec) return { ok: false, reason: "that preset no longer exists" };
  const info = PRESET_WORKSHOPS[rec.workshop];
  const open = PRESET_OPENERS[rec.workshop];
  if (!info || !open) return { ok: false, reason: `'${rec.workshop}' is not a tool this version of Quantized knows` };
  const adapter = (await loadPresetAdapters([rec.workshop])).get(rec.workshop);
  if (!adapter) return { ok: false, reason: `'${rec.workshop}' is not a tool this version of Quantized knows` };
  const r = resolveSettings(adapter, rec.schema, rec.settings);
  if (r.state !== "ok") return { ok: false, reason: `preset '${rec.name}' cannot be opened: ${r.reason}` };
  const why = await open();
  if (why) return { ok: false, reason: why };
  usePendingPreset.getState().hand(rec.workshop, rec.id);
  recordRecipeUse(ref);
  return { ok: true, message: `opened ${info.label} with preset '${rec.name}' loaded as its draft: press ${info.runLabel} to run it` };
}
