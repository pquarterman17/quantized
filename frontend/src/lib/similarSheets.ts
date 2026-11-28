// "Insert a column into every similar sheet" (plan item 34): which worksheets count as similar to the
// active one, and which similar ones cannot take the column. Pure.
//
// SIMILAR means the same DATA columns by label, in the same order: the base columns, not the
// computed (formula) ones appended after them, so a sheet that already received an earlier inserted
// formula column is still similar. The X column is not compared. A formula typed against one sheet
// reads its columns by letter, and the letters follow that order, so it means the same thing in every
// sheet the rule selects.
//
// A similar sheet that cannot take an edit is listed with its reason, never silently left out: a
// protected sheet, a sheet rebuilt from its source (derived, corrected, a live graph), or one whose
// data is still loading.

import { editRefusalNotice, isRederived } from "./rederived";
import type { Dataset } from "./types";

export const baseLabels = (d: Dataset): string[] => d.data.labels.slice(0, d.data.labels.length - (d.formulas?.length ?? 0));

export interface SimilarSheets {
  /** The sheets that will take the column, the active one first. */
  targets: Dataset[];
  /** Similar sheets that cannot, with why. */
  refused: { ds: Dataset; reason: string }[];
}

export function similarSheets(datasets: readonly Dataset[], active: Dataset): SimilarSheets {
  const layout = baseLabels(active);
  const same = (d: Dataset): boolean => {
    const b = baseLabels(d);
    return b.length === layout.length && b.every((l, i) => l === layout[i]);
  };
  const similar = [active, ...datasets.filter((d) => d.id !== active.id && same(d))];
  const targets: Dataset[] = [];
  const refused: SimilarSheets["refused"] = [];
  for (const d of similar) {
    if (d.pending) refused.push({ ds: d, reason: "its full data is still loading" });
    else if (isRederived(d)) refused.push({ ds: d, reason: editRefusalNotice(d) });
    else targets.push(d);
  }
  return { targets, refused };
}
