// A worksheet restored from the Trash brings its named ranges back (ROW_RANGE_CONTRACT 5.3: a sheet's ranges go with it,
// and `removeDatasetsPatch` drops them; the Trash entry kept them, store/trash.ts). They return under their own ids, so
// the sheet's `rng("Name")` formulas, which hold the id, read them again.
//
// FORMULAS ON OTHER SHEETS. When the sheet went to the Trash its ranges went with it, so a `rng("Name")` formula on
// ANOTHER sheet errored ("named range removed"); it still held the range's id (only an explicit range delete nulls
// the id). Restoring brings the SAME range back under the SAME id, so `refreshRestoredReaders` re-reads exactly the
// formulas still bound to a restored id, in the restore's own transaction. This is not the re-bind the contract
// forbids: ROW_RANGE_CONTRACT 5.3 says a cut formula never re-binds to a LATER range that happens to carry the same
// NAME; here nothing is matched by name, it is the very range (the id is never reused) that came back. A formula the
// user edited meanwhile holds another binding (an edit re-links by name to a range that exists, or drops the call) and
// is not touched; a range whose name was taken meanwhile is not restored at all (below), so its readers stay as they
// are. Fail closed: a range whose name was taken in the meantime is not restored (it would clash, and renaming would
// leave a formula's text naming another range), and the note says so. Lazy, with the rest of the restore rules
// (store/trashRestore.ts).

import { formulaExtension } from "../lib/formulaExt";
import { nameClash, type NamedRange } from "../lib/namedRanges";
import type { Dataset } from "../lib/types";
import type { WorkbookNode } from "../lib/workbooks";

export interface RestoredRanges {
  namedRanges: NamedRange[];
  /** The ids that came back with this restore (empty when none did). */
  restoredIds: ReadonlySet<string>;
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
  if (!captured?.length) return { namedRanges: current as NamedRange[], restoredIds: new Set() };
  const out = [...current];
  const kept: string[] = [];
  const restoredIds = new Set<string>();
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
    restoredIds.add(range.id);
  }
  const parts: string[] = [];
  if (kept.length) parts.push(`restored ${kept.length} named range${kept.length === 1 ? "" : "s"} (${kept.join(", ")})`);
  if (skipped.length) parts.push(`named range ${skipped.join(", ")} not restored: the name is taken`);
  return { namedRanges: out, restoredIds, ...(parts.length ? { note: parts.join("; ") } : {}) };
}

/** `datasets` with every formula still bound to a restored range id re-evaluated against `ranges` (the ranges after the
 *  restore), and how many such formula columns sit on sheets other than `restoredSheetId`. The same array when nothing
 *  reads a restored range. A formula holds an id or not: one the user edited since holds no restored id. */
export function refreshRestoredReaders(
  datasets: Dataset[],
  ranges: readonly NamedRange[],
  restoredIds: ReadonlySet<string>,
  restoredSheetId: string,
): { datasets: Dataset[]; elsewhere: number } {
  if (!restoredIds.size) return { datasets, elsewhere: 0 };
  const elsewhere = datasets.reduce(
    (n, d) => (d.id === restoredSheetId ? n : n + (d.formulas ?? []).filter((f) => f.ranges?.some((b) => b.id !== null && restoredIds.has(b.id))).length),
    0,
  );
  const next = formulaExtension()?.refreshRangeReaders(datasets, ranges, restoredIds) ?? datasets;
  return { datasets: next, elsewhere };
}
