// A worksheet restored from the Trash brings its named ranges back (ROW_RANGE_CONTRACT 5.3: a sheet's ranges go with it,
// and `removeDatasetsPatch` drops them; the Trash entry kept them, store/trash.ts). They return under their own ids, so
// the sheet's `rng("Name")` formulas, which hold the id, read them again; a formula on ANOTHER sheet that was cut when
// the range went stays cut (it never re-binds), as a `sheet()` link to a restored sheet does. Fail closed: a range whose
// name was taken in the meantime is not restored (it would clash, and renaming would leave a formula's text naming
// another range), and the note says so. Lazy, with the rest of the restore rules (store/trashRestore.ts).

import { nameClash, type NamedRange } from "../lib/namedRanges";
import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";

export interface RestoredRanges {
  namedRanges: NamedRange[];
  /** What the restore says about them, or undefined when the sheet had none. */
  note?: string;
}

/** `current` plus the ranges of `captured` that can come back with `restored`. `datasets` and `workbooks` are the state
 *  AFTER the sheet is back (its workbook may be a new one, if the old workbook was deleted with it). */
export function restoreNamedRanges(
  current: readonly NamedRange[],
  captured: readonly NamedRange[] | undefined,
  restored: Pick<Dataset, "id" | "workbookId">,
  datasets: readonly Pick<Dataset, "id" | "workbookId">[],
  workbooks: readonly Pick<WorkbookNode, "id">[],
): RestoredRanges {
  if (!captured?.length) return { namedRanges: current as NamedRange[] };
  const out = [...current];
  const kept: string[] = [];
  const skipped: string[] = [];
  for (const range of captured) {
    if (out.some((r) => r.id === range.id)) continue; // it came back some other way (an undo): never a duplicate
    // A workbook-scoped name stays so only while its workbook is the sheet's; otherwise it belongs to the sheet alone.
    const keepsWorkbook = range.scope.kind === "workbook" && range.scope.workbookId === restored.workbookId && workbooks.some((w) => w.id === (range.scope as { workbookId: string }).workbookId);
    const scope: NamedRange["scope"] = range.scope.kind === "workbook" && !keepsWorkbook ? { kind: "sheet", datasetId: restored.id } : range.scope;
    if (nameClash(out, range.name, scope, datasets)) {
      skipped.push(range.name);
      continue;
    }
    out.push(scope === range.scope ? range : { ...range, scope });
    kept.push(range.name);
  }
  const parts: string[] = [];
  if (kept.length) parts.push(`restored ${kept.length} named range${kept.length === 1 ? "" : "s"} (${kept.join(", ")})`);
  if (skipped.length) parts.push(`named range ${skipped.join(", ")} not restored: the name is taken`);
  return { namedRanges: out, ...(parts.length ? { note: parts.join("; ") } : {}) };
}
