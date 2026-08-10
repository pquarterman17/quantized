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
// library — additive, never a replace (that's `loadWorkspace`). Only the
// flat `datasets[]` list is merged in; every workspace-LEVEL structure on the
// incoming doc (folders, originFigures, smartFolders, reports, macroSteps,
// figureDocs, plotWindows, activeId, selectedIds, expandedFolders,
// recalcMode, focusedWindowId, savedPlotSpecs, savedRois) is deliberately
// never read here — the store action built on top of this
// (`useApp.appendWorkspace`) doesn't touch the destination folder tree, view
// state, or window layout either, so merging those in would create
// structures the store then silently ignores.
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
}

/** Merge `incoming`'s datasets into `current` (Origin's "Append Project").
 *  Pure: `genId` supplies fresh ids the exact same way `foldertree
 *  .migrateGroupsToFolders`'s `genId` parameter does (the store passes its
 *  `nextDatasetId`), so this stays testable without a store. Two passes —
 *  first assign every incoming dataset a collision-free id (so a `bgRef`
 *  that forward-references a LATER incoming dataset still resolves), then
 *  build the final objects (dedupe the name, remap/drop `bgRef`, drop
 *  `folderId`). See `WorkspaceMergeResult`'s doc for the full reference
 *  matrix this reconciles. */
export function mergeWorkspace(
  current: Dataset[],
  incoming: LoadedWorkspace,
  genId: () => string,
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

  // Pass 2: dedupe the name, remap/drop bgRef, drop folderId.
  let renamed = 0;
  let droppedBgRefs = 0;
  let droppedFolderRefs = 0;
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

    const next: Dataset = { ...d, id, name, folderId: undefined };
    if (d.folderId !== undefined) droppedFolderRefs++;
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
  };
}
