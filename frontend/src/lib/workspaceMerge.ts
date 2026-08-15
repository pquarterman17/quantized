// Append a second workspace (Origin's "Append Project") — extracted out of
// lib/workspace.ts (RSM_CUTS_PLAN item 13) to fund that module's pin after
// the named-ROI hook-in: this section was already fully self-contained (one
// external caller, store/workspaceIO.ts, which imports it via
// `export * from "./workspaceMerge"` in workspace.ts so it needn't change),
// making it the natural first thing to move rather than the smaller ROI
// addition itself.
//
// `mergeWorkspace` joins a freshly-PARSED `.dwk` (`LoadedWorkspace`, the
// output of `lib/workspace.ts`'s `parseWorkspace`) into the CURRENTLY loaded
// library — additive, never a replace (that's `loadWorkspace`). The flat
// `datasets[]` list AND the incoming `workbooks[]` are merged in
// (LIBRARY_WORKBOOK_UX_PLAN PR A4 — see the `Dataset.workbookId` row below);
// every OTHER workspace-LEVEL structure on the incoming doc (folders,
// originFigures, smartFolders, reports, macroSteps, figureDocs, plotWindows,
// activeId, selectedIds, expandedFolders, recalcMode, focusedWindowId,
// savedPlotSpecs, savedRois) is still deliberately never read here — the
// store action built on top of this (`useApp.appendWorkspace`) doesn't touch
// the destination folder tree, view state, or window layout either, so
// merging those in would create structures the store then silently ignores.
//
// The reference-field matrix (every place a .dwk can point at a dataset id,
// and how each is handled by an append):
//   - `Dataset.bgRef.datasetId` — a cross-dataset reference WITHIN the same
//     saved workspace (the background-subtraction picker only ever offers
//     datasets from the workspace being saved, so this always targets
//     another entry in `incoming.datasets`). Remapped through the same id
//     table as the owning datasets; dropped (counted in `droppedBgRefs`) if
//     it targets an id outside the incoming batch — a hand-edited or
//     corrupted .dwk, never a legitimately-saved one.
//   - `Dataset.folderId` — points into `WorkspaceState.folders`, which this
//     merge never imports (see above). Every incoming folder membership is
//     therefore unresolvable by construction; dropped (counted in
//     `droppedFolderRefs`) so the dataset lands at the Library root — the
//     same graceful degrade `foldertree.pruneOrphans` already gives a
//     dataset whose folder didn't survive validation.
//   - `Dataset.workbookId` (LIBRARY_WORKBOOK_UX_PLAN PR A4 — supersedes A2's
//     blanket strip) — points into `incoming.workbooks`, which A2 never
//     imported because "real cross-project workbook transfer is PR A4's
//     contract, not this one's". A4 IS that contract: every incoming
//     workbook referenced by >=1 incoming dataset TRANSFERS, under a FRESH
//     id from `genWorkbookId` — never the incoming id, collision or not
//     (the same "pasted/appended content can never share an id with its
//     source" guarantee the plan's L0.23/L0.24 and cross-session transfer
//     requirements ask for cross-instance Copy/Paste, applied here to
//     append too). Freshness is guaranteed by `currentWorkbookIds`, a
//     caller-supplied snapshot of the DESTINATION's existing workbook ids —
//     this module only ever receives `Dataset[]` for `current` (no
//     `WorkbookNode[]`), and a time-seeded generator's output must never be
//     assumed collision-free on its own, so the collision check is explicit
//     here rather than delegated to `genWorkbookId`. A transferred
//     workbook's `folderId` is CLEARED (the destination folder tree is
//     never merged in, so a transferred workbook always lands at the
//     Library ROOT — the plan's sanctioned degrade for PR A4, not a special
//     case) and `order` is left undefined, which `lib/order.ts`'s `byOrder`
//     sinks after any keyed root-level sibling — "appended lands at the
//     end" without this pure function needing the destination's full
//     `WorkbookNode[]` (only its id set). `name`/`source`/`importedAt`/
//     `originBook` carry over unchanged (provenance). Each transferred
//     dataset's `workbookId` is remapped through the resulting old-id ->
//     new-id table. A workbook referenced by ZERO incoming datasets is
//     memberless clutter and is NOT transferred at all. A dataset whose
//     `workbookId` names no incoming workbook (a hand-edited/corrupt `.dwk`
//     — a document that went through `parseWorkspace` always has total
//     membership via `reconcileWorkbookRefs`) is cleared, same as A2, but
//     `droppedWorkbookRefs` now counts ONLY this unresolvable case —
//     NARROWED from A2's "every incoming ref, unconditionally" now that
//     most refs resolve via real transfer. Deliberate contract change, not
//     a weakening: A2's blanket-strip assertions are replaced by the
//     transfer assertions below (see workspaceMerge.test.ts).
//   - `OriginFigureEntry.datasetId`/`.siblingIds`, `ReportEntry.datasetId`,
//     `FigureDoc.datasetId`, `PlotWindow.datasetId`, `WorkspaceState.activeId`/
//     `.selectedIds` — all live in workspace-level structures that are never
//     merged in at all (see above); dropped as whole structures, not
//     field-by-field, alongside the rest of the incoming doc's view state.
//   - `smartFolders`, `macroSteps` (pipeline) — audited and carry NO
//     dataset-id references (a smart folder is a saved TEXT query; a
//     pipeline step replays against "the active dataset" at run time), so
//     there is nothing to reconcile even though they're dropped too.
// Every other per-dataset field (`tags`, `group`, `notes`, `formulas`,
// `channelRoles`, `channelTypes`, `excludedRows`, `filter`, `fitSpec`,
// `order`, `pending`) is self-contained — no id references — and rides
// along untouched onto the merged dataset.

import type { Dataset } from "./types";
import type { LoadedWorkspace } from "./workspace";
import type { WorkbookNode } from "./workbooks";

export interface WorkspaceMergeResult {
  /** `current` followed by the incoming datasets, id/name-deduped. Neither
   *  `current` nor any of its existing `Dataset` objects are mutated or
   *  cloned — this array reuses those SAME references. */
  datasets: Dataset[];
  /** Incoming dataset ids that collided with an id already in `current` (or
   *  with another incoming dataset) and were reassigned a fresh id via
   *  `genId`. Ids are never shown to the user — tracked for completeness/
   *  testing, not the append toast. */
  remapped: number;
  /** Incoming dataset NAMES that collided with a name already in `current`
   *  (or with another incoming dataset) and got an Origin-style " (2)"
   *  suffix (`dedupeWindowTitle`'s convention, see lib/plotview.ts). This is
   *  what the append toast reports as "renamed". */
  renamed: number;
  /** `bgRef` back-references dropped because they targeted an id outside
   *  the incoming batch — see the field matrix above. */
  droppedBgRefs: number;
  /** `folderId` memberships dropped because the destination folder tree is
   *  never merged in — see the field matrix above. */
  droppedFolderRefs: number;
  /** `workbookId` refs that resolved to NO incoming workbook (a
   *  hand-edited/corrupt `.dwk`) — see the field matrix above.
   *  NARROWED as of PR A4: this used to count EVERY incoming `workbookId`
   *  (A2's blanket strip); now it only counts genuinely unresolvable ones,
   *  because a resolvable `workbookId` gets real transfer (see
   *  `workbooks` below), not a strip. */
  droppedWorkbookRefs: number;
  /** Incoming workbooks referenced by >=1 incoming dataset, transferred
   *  with fresh ids (never the incoming id) and landed at the Library root
   *  (`folderId` cleared). A memberless incoming workbook (zero incoming
   *  datasets reference it) is dropped, not transferred. See the field
   *  matrix above for the full transfer contract. */
  workbooks: WorkbookNode[];
}

/** Merge `incoming`'s datasets AND workbooks into `current` (Origin's
 *  "Append Project"). Pure: `genId`/`genWorkbookId` supply fresh ids the
 *  exact same way `foldertree.migrateGroupsToFolders`'s `genId` parameter
 *  does (the store passes its `nextDatasetId`/`nextWorkbookId`), so this
 *  stays testable without a store. `currentWorkbookIds` is the destination's
 *  existing workbook id set — this module never receives the destination's
 *  `WorkbookNode[]` (only `current: Dataset[]`), so freshness for the
 *  transferred workbooks is guaranteed against this explicit set rather than
 *  assumed from `genWorkbookId`'s output.
 *
 *  Three passes — first assign every incoming dataset a collision-free id
 *  (so a `bgRef` that forward-references a LATER incoming dataset still
 *  resolves), then assign every TRANSFERRED workbook a collision-free fresh
 *  id, then build the final dataset objects (dedupe the name, remap/drop
 *  `bgRef`, drop `folderId`, remap/clear `workbookId` through the workbook
 *  id table). See `WorkspaceMergeResult`'s doc for the full reference
 *  matrix this reconciles. */
export function mergeWorkspace(
  current: Dataset[],
  incoming: LoadedWorkspace,
  genId: () => string,
  currentWorkbookIds: ReadonlySet<string>,
  genWorkbookId: () => string,
): WorkspaceMergeResult {
  const usedIds = new Set(current.map((d) => d.id));
  const usedNames = new Set(current.map((d) => d.name));

  // Pass 1: a collision-free final id per incoming dataset, BY INDEX (not a
  // Map keyed by the original id — a hand-edited .dwk could carry duplicate
  // ids, and a Map would silently let the last one win for BOTH entries).
  const finalIds: string[] = [];
  // Original id -> final id, for resolving bgRef targets in pass 2 (last
  // write wins on a duplicate original id — the same degrade as above, never
  // a crash).
  const idMap = new Map<string, string>();
  let remapped = 0;
  for (const d of incoming.datasets) {
    let id = d.id;
    if (usedIds.has(id)) {
      do {
        id = genId();
      } while (usedIds.has(id));
      remapped++;
    }
    usedIds.add(id);
    finalIds.push(id);
    idMap.set(d.id, id);
  }

  // Pass 1b: workbook transfer. Only a workbook with >=1 incoming member
  // transfers (a memberless incoming workbook is dropped as clutter); every
  // transferred workbook gets a FRESH id, unconditionally — see the header's
  // `Dataset.workbookId` row for why this differs from pass 1's
  // collision-only dataset id policy. `usedWorkbookIds` seeds from the
  // caller-supplied `currentWorkbookIds` and grows with every id minted
  // here, so two workbooks transferred in the SAME append can't collide with
  // each other either.
  const referencedWorkbookIds = new Set<string>();
  for (const d of incoming.datasets) {
    if (d.workbookId) referencedWorkbookIds.add(d.workbookId);
  }
  const usedWorkbookIds = new Set(currentWorkbookIds);
  // Incoming workbook id -> fresh id (last write wins on a duplicate
  // incoming id — the same degrade pass 1's idMap gives a duplicated dataset
  // id, never a crash).
  const workbookIdMap = new Map<string, string>();
  const workbooks: WorkbookNode[] = [];
  for (const w of incoming.workbooks) {
    if (!referencedWorkbookIds.has(w.id)) continue; // memberless -> not transferred
    let freshId = genWorkbookId();
    while (usedWorkbookIds.has(freshId)) freshId = genWorkbookId();
    usedWorkbookIds.add(freshId);
    workbookIdMap.set(w.id, freshId);
    const node: WorkbookNode = { id: freshId, name: w.name };
    if (w.source) node.source = w.source;
    if (w.importedAt) node.importedAt = w.importedAt;
    if (w.originBook) node.originBook = w.originBook;
    // folderId and order are intentionally omitted: Library root, sinks
    // after any keyed sibling (see the header's `Dataset.workbookId` row).
    workbooks.push(node);
  }

  // Pass 2: dedupe the name, remap/drop bgRef, drop folderId, remap/clear
  // workbookId through the workbook id table built above.
  let renamed = 0;
  let droppedBgRefs = 0;
  let droppedFolderRefs = 0;
  let droppedWorkbookRefs = 0;
  const merged = incoming.datasets.map((d, i) => {
    const id = finalIds[i];

    let name = d.name;
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name} (${n})`)) n++;
      name = `${name} (${n})`;
      renamed++;
    }
    usedNames.add(name);

    const next: Dataset = { ...d, id, name, folderId: undefined, workbookId: undefined };
    if (d.folderId !== undefined) droppedFolderRefs++;
    if (d.workbookId !== undefined) {
      const newWbId = workbookIdMap.get(d.workbookId);
      if (newWbId) {
        next.workbookId = newWbId;
      } else {
        droppedWorkbookRefs++; // unresolvable — hand-edited/corrupt .dwk
      }
    }
    if (d.bgRef) {
      const target = idMap.get(d.bgRef.datasetId);
      if (target) {
        next.bgRef = { ...d.bgRef, datasetId: target };
      } else {
        next.bgRef = undefined;
        droppedBgRefs++;
      }
    }
    return next;
  });

  return {
    datasets: [...current, ...merged],
    remapped,
    renamed,
    droppedBgRefs,
    droppedFolderRefs,
    droppedWorkbookRefs,
    workbooks,
  };
}
