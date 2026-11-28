// "Insert a column into every similar sheet" (plan item 34): which worksheets count as similar to the
// active one, and which similar ones cannot take the column. Pure.
//
// SIMILAR means the same DATA columns by label, in the same order, AND the same unit and the same
// designation (Set As) on each: the base columns, not the computed (formula) ones appended after
// them, so a sheet that already received an earlier inserted formula column is still similar. The X
// column is not compared. A sheet with the same labels that differs only in units or designations is
// listed as "not similar: units differ" (or designations, or both) and is left out unless the caller
// asks to include it anyway: a formula written against columns in volts means something else on a
// sheet whose columns are in millivolts. A formula typed against one sheet
// reads its columns by letter, and the letters follow that order, so it means the same thing in every
// sheet the rule selects.
//
// A similar sheet that cannot take an edit is listed with its reason, never silently left out: a
// protected sheet, a sheet rebuilt from its source (derived, corrected, a live graph), or one whose
// data is still loading.

import { effectiveDesignations } from "./columnmeta";
import { editRefusalNotice, isRederived } from "./rederived";
import type { Dataset } from "./types";

export const baseLabels = (d: Dataset): string[] => d.data.labels.slice(0, d.data.labels.length - (d.formulas?.length ?? 0));

export interface SimilarSheets {
  /** The sheets that will take the column, the active one first. */
  targets: Dataset[];
  /** Similar sheets that cannot, with why. */
  refused: { ds: Dataset; reason: string }[];
  /** Same labels, but a different unit or designation: left out unless `includeDifferent`, in which case they are
   *  in `targets` (and still listed here, so the dialog can say which ones it widened to). */
  differs: { ds: Dataset; reason: string }[];
}

/** How a sheet with the same labels differs from `active` in its base columns, or null when it does not. */
export function layoutDifference(d: Dataset, active: Dataset): string | null {
  const n = baseLabels(active).length;
  const unit = (x: Dataset, i: number): string => (x.data.units[i] ?? "").trim();
  const desig = (x: Dataset) => effectiveDesignations(x.data, x.columnDesignations).slice(0, n);
  const units = Array.from({ length: n }, (_, i) => unit(d, i) !== unit(active, i)).some(Boolean);
  const da = desig(active);
  const dd = desig(d);
  const designations = da.some((v, i) => v !== dd[i]);
  if (units && designations) return "not similar: units and designations differ";
  if (units) return "not similar: units differ";
  if (designations) return "not similar: designations differ";
  return null;
}

export function similarSheets(datasets: readonly Dataset[], active: Dataset, includeDifferent = false): SimilarSheets {
  const layout = baseLabels(active);
  const same = (d: Dataset): boolean => {
    const b = baseLabels(d);
    return b.length === layout.length && b.every((l, i) => l === layout[i]);
  };
  const similar = [active, ...datasets.filter((d) => d.id !== active.id && same(d))];
  const targets: Dataset[] = [];
  const refused: SimilarSheets["refused"] = [];
  const differs: SimilarSheets["differs"] = [];
  for (const d of similar) {
    if (d.pending) refused.push({ ds: d, reason: "its full data is still loading" });
    else if (isRederived(d)) refused.push({ ds: d, reason: editRefusalNotice(d) });
    else {
      const diff = d.id === active.id ? null : layoutDifference(d, active);
      if (diff) differs.push({ ds: d, reason: diff });
      if (!diff || includeDifferent) targets.push(d);
    }
  }
  return { targets, refused, differs };
}
