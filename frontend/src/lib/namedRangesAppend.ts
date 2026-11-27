// Append Project's carry of named ranges (ROW_RANGE_CONTRACT 5.3, slice R4a/R4b). Moved verbatim out of lib/namedRanges.ts,
// whose other exports run at startup: only the lazy workspace merge calls this half, so it no longer ships in the
// startup chunk (the eager budget). Imported by path; lib/namedRanges.ts does not re-export it.

import { MAX_NAME_LENGTH, nameClash, newNamedRangeId, type NamedRange, type NamedRangeScope } from "./namedRanges";
import type { Dataset } from "./types";

/** An appended project's ranges, carried through the same id tables as its worksheets and workbooks. A range whose
 *  block or workbook did not come along is dropped and counted. The clash rule: an incoming name that is already taken
 *  within its workbook gets " (2)", " (3)" ... (as an appended worksheet's name does), never replaces or merges with
 *  the existing range, and is counted. `after` is the merged dataset list (final ids and workbook ids). */
export function appendNamedRanges(
  existing: readonly NamedRange[],
  incoming: readonly NamedRange[] | undefined,
  datasetIds: ReadonlyMap<string, string>,
  workbookIds: ReadonlyMap<string, string>,
  after: readonly Pick<Dataset, "id" | "workbookId">[],
): { ranges: NamedRange[]; dropped: number; renamed: number; ids: Map<string, string> } {
  const ranges: NamedRange[] = [];
  const ids = new Map<string, string>(); // incoming id -> its id here (a formula's rng() link follows it)
  const taken = new Set(existing.map((r) => r.id));
  let dropped = 0;
  let renamed = 0;
  for (const r of incoming ?? []) {
    const datasetId = datasetIds.get(r.target.datasetId);
    const scope: NamedRangeScope | null =
      r.scope.kind === "sheet"
        ? (datasetIds.has(r.scope.datasetId) ? { kind: "sheet", datasetId: datasetIds.get(r.scope.datasetId)! } : null)
        : (workbookIds.has(r.scope.workbookId) ? { kind: "workbook", workbookId: workbookIds.get(r.scope.workbookId)! } : null);
    if (!datasetId || !scope) {
      dropped++;
      continue;
    }
    const id = taken.has(r.id) ? newNamedRangeId(taken) : r.id;
    taken.add(id);
    const all = [...existing, ...ranges];
    let name = r.name;
    for (let n = 2; nameClash(all, name, scope, after); n++) name = `${r.name} (${n})`.slice(-MAX_NAME_LENGTH);
    if (name !== r.name) renamed++;
    ranges.push({ ...r, id, name, scope, target: { ...r.target, datasetId } });
    ids.set(r.id, id);
  }
  return { ranges, dropped, renamed, ids };
}
