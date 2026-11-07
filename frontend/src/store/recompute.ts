// Moved verbatim out of store/useApp.ts (MAIN_PLAN #42, to fund the
// sample-profiles slice under that module's size pin). useApp.ts re-exports
// it, so `import { recompute } from "./useApp"` keeps working everywhere.
import { recomputeWithErrors } from "../lib/formula";
import { asAlreadyComputed } from "../lib/formulaInputs";
import type { Dataset } from "../lib/types";

/** Recompute a dataset's computed columns from its current base (no-op without
 *  formulas). Routed through after any base-data mutation (cell edit, corrections).
 *  Exported for store/corrections.ts (nextDatasetId/split.ts precedent) — the
 *  corrections slice re-derives computed columns after every apply/reset from
 *  the SAME formula-recompute logic every other base-data mutation here uses.
 *  LIBRARY_WORKBOOK_UX_PLAN PR K (K5b): also refreshes `formulaErrors` in the
 *  same pass, so a base-data edit that fixes (or breaks) a formula's
 *  evaluation keeps the visible error state in sync everywhere `recompute`
 *  is the chokepoint — not just at the store/computedColumns.ts authoring
 *  sites. `asAlreadyComputed` (SILENT_STATE_CORRUPTION_PLAN #2) is sound
 *  HERE ONLY because `d.data` is a Dataset's OWN table — by construction it
 *  already carries `d.formulas`' stale columns. A caller with base-only data
 *  must NOT route through `recompute` — see derivedWorksheets.ts's
 *  `recomputeFromBase` (the #4 fix). */
export const recompute = (d: Dataset): Dataset => {
  if (!d.formulas?.length) return d;
  const { data, errors } = recomputeWithErrors(asAlreadyComputed(d.data), d.formulas);
  return { ...d, data, formulaErrors: Object.keys(errors).length ? errors : undefined };
};
