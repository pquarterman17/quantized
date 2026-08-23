// Pure separate planning (LIBRARY_WORKBOOK_UX_PLAN PR J slice 1 — L0.51).
//
// A separated worksheet's dependents never need an explicit "rewrite" step:
// every artifact kind this app has (origin/editable/publication figures,
// pages, reports) resolves its Library placement FRESH from its source
// dataset(s)' CURRENT `Dataset.workbookId` — `lib/libraryHierarchy.ts`'s
// `buildLibraryHierarchy`, the same "derived, never persisted" discipline
// `lib/recalc.ts` documents for the dependency graph. So the entire COMMIT
// mutation is just: mint one new WorkbookNode, and reassign `workbookId` on
// the moving dataset ids. Once that lands, every dependent artifact's
// placement is ALREADY correct on the very next hierarchy build — nothing
// else to touch, nothing that can drift out of sync with a stored "link".
//
// This module's job is therefore the PREVIEW: which datasets are "exclusively
// dependent" on the worksheet(s) being separated (`closeExclusiveDependents`,
// a fixpoint closure over the same bgRef/derivedFrom edges `lib/recalc.ts`'s
// `buildEdges` folds — re-derived here rather than imported because
// `downstreamOf`'s single-path BFS answers a different question: "what's
// reachable from the seed", not "what depends on the seed AND NOTHING ELSE
// outside it", the L0.51 "exclusively dependent" test), and, for every
// figure/page/report, whether the CURRENT-state hierarchy and a HYPOTHETICAL
// post-separate hierarchy place it differently. Building the hypothetical
// hierarchy with the SAME `buildLibraryHierarchy` the commit's result will
// itself be rendered with is what guarantees "commit applies exactly the
// previewed plan" — there is no second, hand-written placement rule that
// could disagree with the real one.

import { buildLibraryHierarchy, type LibraryHierarchyInput, type LibraryNodeKind } from "./libraryHierarchy";
import type { Dataset } from "./types";

/** Does `d` have a LIVE (re-derivable) bgRef edge? Mirrors `lib/recalc.ts`'s
 *  `buildEdges` predicate exactly (`d.bgRef && d.corrections && d.raw`) —
 *  kept in sync by `workbookSeparate.test.ts`'s bgRef-chain cases, since
 *  `lib/recalc.ts` exports no standalone predicate to import here. */
function structuralDeps(d: Dataset): string[] {
  const deps: string[] = [];
  if (d.bgRef && d.corrections && d.raw) deps.push(d.bgRef.datasetId);
  if (d.derivedFrom) deps.push(d.derivedFrom.datasetId);
  return deps;
}

/** Fixpoint closure: start from `seedIds` and repeatedly sweep in any
 *  dataset whose EVERY structural dependency (bgRef consumer, derived
 *  worksheet) already resolves into the growing set — L0.51's "exclusively
 *  dependent" test. A dataset with an ADDITIONAL dependency outside the set
 *  (e.g. a derived worksheet built from two sources, one moving and one not)
 *  never joins; it stays with its other dependency instead. */
export function closeExclusiveDependents(
  datasets: readonly Dataset[],
  seedIds: readonly string[],
): Set<string> {
  const moving = new Set(seedIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of datasets) {
      if (moving.has(d.id)) continue;
      const deps = structuralDeps(d);
      if (deps.length === 0) continue;
      if (deps.every((dep) => moving.has(dep))) {
        moving.add(d.id);
        changed = true;
      }
    }
  }
  return moving;
}

export interface SeparatePlanItem {
  key: string;
  kind: LibraryNodeKind;
  name: string;
  action: "move" | "stay";
  reason: string;
}

export interface SeparatePlan {
  /** The worksheet ids the caller asked to separate, verbatim (before
   *  dropping any that no longer exist). */
  requestedWorksheetIds: string[];
  /** Every dataset id that will be reassigned to the new workbook — the
   *  requested worksheets plus their exclusive-dependency closure. Empty
   *  when nothing requested still exists. */
  movingDatasetIds: string[];
  /** A caller-supplied key identifying "the new workbook" for THIS plan
   *  build — used only structurally, to diff the hypothetical post-separate
   *  hierarchy against the current one (see `computeSeparatePlan`'s doc).
   *  P3 slice-2 fix (2026-08-19): during PREVIEW this is a fixed shared
   *  placeholder (`store/workbookSeparate.ts`'s `PENDING_SEPARATE_WORKBOOK_ID`),
   *  never a freshly minted session-unique id — minting one per preview open
   *  wasted ids for no reason a live-updating preview would only make worse.
   *  `commitSeparateWorksheets` mints the REAL `WorkbookNode.id` itself, once,
   *  at commit time, and never reads this field back. */
  newWorkbookId: string;
  /** Default name for the dialog (the primary/first requested worksheet's
   *  own name for a single-worksheet separate; overridable by the caller). */
  suggestedName: string;
  /** Folder placement the new workbook is built with — the SOURCE worksheet's
   *  own workbook's folder, so a separated worksheet stays visually near its
   *  sibling instead of jumping to the Library root. Undefined = root. */
  newWorkbookFolderId: string | undefined;
  /** Every figure/analysis/derived-worksheet/page that references at least
   *  one moving worksheet (or is itself one), with its move/stay verdict and
   *  a one-line reason — what the preview dialog lists. */
  items: SeparatePlanItem[];
  /** Human-readable notices (e.g. a requested id that no longer exists). */
  warnings: string[];
}

/** Build the affected-item plan for separating `worksheetIds` out of the
 *  Library into a new workbook (`newWorkbookId`, a caller-supplied
 *  structural key — see `SeparatePlan.newWorkbookId`'s doc for why it need
 *  not be the eventual real id). Pure; reads `input` only. */
export function computeSeparatePlan(
  input: LibraryHierarchyInput,
  worksheetIds: readonly string[],
  newWorkbookId: string,
): SeparatePlan {
  const warnings: string[] = [];
  const datasetById = new Map(input.datasets.map((d) => [d.id, d]));
  const validSeeds = worksheetIds.filter((id) => datasetById.has(id));
  for (const id of worksheetIds) {
    if (!datasetById.has(id)) warnings.push(`worksheet "${id}" no longer exists; skipped`);
  }
  if (validSeeds.length === 0) {
    return {
      requestedWorksheetIds: [...worksheetIds],
      movingDatasetIds: [],
      newWorkbookId,
      suggestedName: "",
      newWorkbookFolderId: undefined,
      items: [],
      warnings: warnings.length ? warnings : ["nothing to separate"],
    };
  }

  const moving = closeExclusiveDependents(input.datasets, validSeeds);
  // Stable order: dataset array order, not Set insertion order (insertion
  // interleaves seeds/sweep-ins by discovery pass, not display order).
  const movingDatasetIds = input.datasets.filter((d) => moving.has(d.id)).map((d) => d.id);

  const firstSeed = datasetById.get(validSeeds[0])!;
  const sourceWorkbook = input.workbooks.find((w) => w.id === firstSeed.workbookId);
  const suggestedName = validSeeds.length === 1
    ? firstSeed.name
    : `${sourceWorkbook?.name ?? "Workbook"} (split)`;
  const newWorkbookFolderId = sourceWorkbook?.folderId;

  const before = buildLibraryHierarchy(input);
  const afterDatasets = input.datasets.map((d) => (moving.has(d.id) ? { ...d, workbookId: newWorkbookId } : d));
  const afterWorkbooks = [
    ...input.workbooks,
    { id: newWorkbookId, name: suggestedName, folderId: newWorkbookFolderId },
  ];
  const after = buildLibraryHierarchy({ ...input, datasets: afterDatasets, workbooks: afterWorkbooks });
  const newWorkbookKey = `workbook:${newWorkbookId}`;

  const items: SeparatePlanItem[] = [];
  for (const [key, beforeNode] of before.byKey) {
    if (beforeNode.kind === "folder" || beforeNode.kind === "workbook") continue;
    const isMovingWorksheet = beforeNode.kind === "worksheet" && moving.has(beforeNode.entityId);
    const overlaps = beforeNode.source.datasetIds.some((id) => moving.has(id));
    if (!isMovingWorksheet && !overlaps) continue;

    const afterNode = after.byKey.get(key);
    const nowUnderNew = afterNode?.parentKey === newWorkbookKey;
    const action: "move" | "stay" = isMovingWorksheet || nowUnderNew ? "move" : "stay";

    let reason: string;
    if (isMovingWorksheet) {
      reason = validSeeds.includes(beforeNode.entityId)
        ? "selected for separation"
        : "exclusively depends on a worksheet being separated (correction/derived-worksheet chain)";
    } else if (action === "move") {
      reason = "depends only on worksheet(s) being separated";
    } else {
      const stayingRefs = beforeNode.source.datasetIds.filter((id) => !moving.has(id));
      reason = `also depends on ${stayingRefs.length} worksheet(s) staying behind; kept at the shared location`;
    }
    items.push({ key, kind: beforeNode.kind, name: beforeNode.name, action, reason });
  }

  return {
    requestedWorksheetIds: [...worksheetIds],
    movingDatasetIds,
    newWorkbookId,
    suggestedName,
    newWorkbookFolderId,
    items,
    warnings,
  };
}
