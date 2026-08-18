// Pure combine planning helpers (LIBRARY_WORKBOOK_UX_PLAN PR J slice 1 —
// L0.32-L0.34). Combine is a SAME-DOCUMENT reorganization, not a cross-
// project transfer (that's PR I's cross-instance Copy/Paste, and PR M's
// transactional multi-source reimport, L0.33 — this module only records
// provenance, it never re-reads a source file): every id already lives in
// the store, so unlike lib/workspaceMerge.ts's append path there is no id
// remapping to do, only two collision-free namespaces to keep --
// `WorkbookNode.id` (store/workbookIds.ts's session-unique `nextWorkbookId`
// already guarantees this) and the display NAMES of the worksheets landing
// in ONE destination workbook (this module's job, L0.34's "visible collision
// suffixes; never overwrite an existing child silently").
//
// `dedupeWorksheetNames` is scoped to the INCOMING combine batch only, not
// the whole Library -- two unrelated workbooks may legitimately share a
// worksheet display name elsewhere; L0.34 only protects the new workbook's
// own children from colliding with EACH OTHER.
//
// datasetAlgebra's P1.4 `cat_levels` merge contract (mentioned in this PR's
// brief) governs `lib/merge.ts`'s `mergeDatasets` -- MERGING worksheet ROW
// DATA into one worksheet, a different existing feature. Combine never does
// that: L0.34 keeps every combined worksheet a separate child ("each
// imported worksheet retains its source filename as its default display
// name"), so no DataStruct is ever merged here and `cat_levels` never enters
// the picture.

import { dedupeWindowTitle } from "./plotview";
import type { Dataset } from "./types";

export interface CombineSelection {
  /** Whole workbooks selected in the Library -- every one of their member
   *  worksheets is a combine target. */
  workbookIds: readonly string[];
  /** Worksheets selected individually (not necessarily inside a selected
   *  workbook). */
  worksheetIds: readonly string[];
}

/** Resolve a combine selection into the flat, de-duplicated, order-stable
 *  list of worksheet (dataset) ids it names: every live member of a
 *  selected WHOLE workbook (in `datasets` array order), then every
 *  individually selected worksheet not already covered, in selection order.
 *  A worksheet id naming no live dataset is silently dropped (the same
 *  degrade `resolveTemplate`/`downstreamOf` give a stale reference —
 *  never a crash). */
export function resolveCombineTargets(
  selection: CombineSelection,
  datasets: readonly Dataset[],
): string[] {
  const wbSet = new Set(selection.workbookIds);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const d of datasets) {
    if (d.workbookId && wbSet.has(d.workbookId) && !seen.has(d.id)) {
      seen.add(d.id);
      ids.push(d.id);
    }
  }
  const byId = new Map(datasets.map((d) => [d.id, d]));
  for (const id of selection.worksheetIds) {
    if (!seen.has(id) && byId.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

const MIN_SUGGESTABLE_PREFIX = 3;

/** The longest shared basename prefix across `names` (extension stripped),
 *  "when one is clear" per L0.34 -- every name must actually agree on a
 *  non-trivial prefix (>=3 chars; a 1-2 char match is noise, not a suggested
 *  identity) or this returns undefined rather than a misleading guess.
 *  Fewer than two names never has a "shared" anything to suggest FROM. */
export function suggestCombinedWorkbookName(names: readonly string[]): string | undefined {
  const stems = names.map((n) => n.replace(/\.[^./\\]+$/, ""));
  if (stems.length < 2 || stems.some((s) => !s)) return undefined;
  let prefix = stems[0];
  for (const s of stems.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i] === s[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return undefined;
  }
  return prefix.length >= MIN_SUGGESTABLE_PREFIX ? prefix : undefined;
}

/** Assign collision-safe display names to the worksheets landing in ONE
 *  combined workbook (L0.34). Scoped to THIS incoming batch (see module
 *  header) using `lib/plotview.ts`'s `dedupeWindowTitle` "Name", "Name (2)",
 *  … idiom -- the same suffix convention `store/quickPlotTemplates.ts` and
 *  `lib/workspaceMerge.ts` already use for a name collision, so a combined
 *  workbook reads the same way an appended/imported one does. Order-
 *  preserving: the first worksheet to claim a name keeps it bare, and a
 *  later name can never collide with an already-minted suffix either. */
export function dedupeWorksheetNames(names: readonly string[]): string[] {
  const used: string[] = [];
  const out: string[] = [];
  for (const name of names) {
    const deduped = dedupeWindowTitle(name, used);
    used.push(deduped);
    out.push(deduped);
  }
  return out;
}
