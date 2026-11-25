// Writers for the workflow prefs (lib/workflowPrefs.ts). Kept out of that eager
// module: only Preferences and the lazy import wizard write them.

import { WORKFLOW_DEFAULTS, workflowPrefsSlot, type WorkflowPrefs } from "./workflowPrefs";

/** Merge `patch` into the slot (numbers clamped by `parse` on the next load). */
export function setWorkflowPrefs(patch: Partial<WorkflowPrefs>): void {
  workflowPrefsSlot.save({ ...workflowPrefsSlot.load(), ...patch });
}

/** Preferences ▸ General "Reset tab": every field but the import-wizard ones (Data & files). */
export function resetGeneralPrefs(): void {
  const general: Partial<WorkflowPrefs> = { ...WORKFLOW_DEFAULTS };
  delete general.rememberImportSettings;
  delete general.importMemory;
  setWorkflowPrefs(general);
}
