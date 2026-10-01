// PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 — the "rename a level" action. The pure
// edit is lib/levelRename.ts; this applies it to a dataset as ONE undo entry.
//
// Imported only by the lazy level-order workshop (LevelNameCell.tsx), never
// from an eager module, so it stays out of the entry bundle — the same rule
// store/levelOrderPanel.ts's header documents for store/levelOrder.ts.
//
// Refused on a RE-DERIVED dataset (lib/rederived.ts), exactly like a level
// reorder: the recalc rebuilds `data` from raw/its source, which still holds
// the old label, so the rename would silently vanish on the next recalc.

import { recomputeWithErrors } from "../lib/formula";
import { asAlreadyComputed } from "../lib/formulaInputs";
import { carryOrderAcrossRename, renameLevelIn } from "../lib/levelRename";
import { isRederived, REDERIVED_EDIT_NOTICE } from "../lib/rederived";
import type { Dataset } from "../lib/types";
import { resolvePendingEdit } from "./pendingEdit";
import { toast } from "./toasts";
import { useApp } from "./useApp";

/** Rename level `code` of `channel` in dataset `datasetId` to `name`
 *  (trimmed). Returns false, with a one-sentence danger toast and no
 *  mutation, on any refusal; true on success or an unchanged name. */
export function renameLevel(datasetId: string, channel: number, code: number, name: string): boolean {
  const app = useApp.getState();
  const ds = app.datasets.find((d) => d.id === datasetId);
  if (!ds) {
    toast("That dataset no longer exists.", "danger");
    return false;
  }
  if (isRederived(ds)) {
    toast(REDERIVED_EDIT_NOTICE, "danger");
    return false;
  }
  if (ds.pending != null) {
    resolvePendingEdit(() => useApp.getState(), ds, "renaming a level", () => renameLevel(datasetId, channel, code, name));
    return true;
  }
  const r = renameLevelIn(ds.data, ds.formulas, channel, code, name);
  if (!r.ok) {
    toast(r.reason, "danger");
    return false;
  }
  if (!r.changed) return true;
  let patch: Partial<Dataset> = { data: r.data };
  if (r.formulas?.length) {
    // `r.data` is the dataset's OWN data (computed columns present), with only
    // a base level label changed — the provenance `asAlreadyComputed` needs.
    const out = recomputeWithErrors(asAlreadyComputed(r.data), r.formulas);
    const baseCount = r.data.labels.length - r.formulas.length;
    patch = {
      formulas: r.formulas,
      data: carryOrderAcrossRename(r.data, out.data, baseCount),
      formulaErrors: Object.keys(out.errors).length ? out.errors : undefined,
    };
  }
  app.recordHistory("rename level");
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === datasetId ? { ...d, ...patch } : d)) }));
  app.touchDataset(datasetId);
  toast(`renamed level "${r.oldLabel}" to "${r.newLabel}"`, "ok");
  return true;
}
