// L0.46 (LIBRARY_WORKBOOK_UX_PLAN PR C): "import a selected batch into the
// currently selected project folder by default... may suggest Create Folder
// for This Import using an obvious shared filename prefix... but NEVER
// creates or reorganizes folders without confirmation." Extracted out of
// store/importDatasets.ts (which sat at its 500-line general ceiling before
// this feature) — a self-contained "where does this batch land" concern,
// the same shape lib/api/http.ts's extraction was for that file's own pin.

import type { AppState } from "./useApp";

type SliceGet = () => AppState;

/** The currently-selected Library folder, or the selected workbook's
 *  folder, else root (undefined) — resolved ONCE per batch by the caller
 *  (librarySelection doesn't change mid-batch) and reused for every file.
 *  An ARTIFACT selection (L0.25 widened the kind union) targets root: an
 *  artifact names no folder of its own, and guessing one through its
 *  bindings would make import placement depend on which figure happened to
 *  be highlighted. */
export function resolveImportTargetFolderId(get: SliceGet): string | undefined {
  const s = get();
  const sel = s.librarySelection;
  if (!sel) return undefined;
  if (sel.kind === "folder") return sel.id;
  if (sel.kind === "workbook") return s.workbooks.find((w) => w.id === sel.id)?.folderId;
  return undefined;
}

/** Longest prefix shared by every string, trimmed of trailing separators. */
export function longestCommonPrefix(names: readonly string[]): string {
  if (names.length === 0) return "";
  let prefix = names[0];
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix.replace(/[-_ .]+$/, "");
}

export interface BatchFolderOffer {
  prefix: string;
  ids: string[];
}

/** After a batch of >=2 PLAIN files (one dataset per file — an Origin
 *  project already organizes itself via planOriginImport, so it never
 *  qualifies) shares an obvious common filename-stem prefix (>=3 chars),
 *  offer — never create without the click — a folder under the import's
 *  target holding the batch. Mutually exclusive with the batch-overlay
 *  offer (PLOT_WORKFLOW_PLAN item 4): the caller only checks this when the
 *  overlay offer didn't qualify, so the two action toasts never stack.
 *
 *  `fileCount` (P2 review fix) is the batch's successfully-imported FILE
 *  count (runImport's own `added` counter, store/importDatasets.ts) — NOT
 *  `createdIds.length`, which counts DATASETS. A single multi-book Origin
 *  file legitimately creates N datasets that share a common `${stem}:`
 *  prefix by construction (every book-derived name is stamped with the
 *  SAME import stem), so `createdIds.length` alone cannot tell "N plain
 *  files" apart from "1 file that fanned out to N books" — the doc comment
 *  above always claimed the fan-out case "never qualifies", but nothing
 *  actually enforced that until this check. `createdIds.length !==
 *  fileCount` now catches it directly; only a batch of PLAIN files (one
 *  dataset per file, by construction) can ever have the two counts equal. */
export function batchFolderOffer(
  get: SliceGet,
  createdIds: readonly string[],
  fileCount: number,
): BatchFolderOffer | null {
  if (fileCount < 2 || createdIds.length !== fileCount) return null;
  const idSet = new Set(createdIds);
  const datasets = get().datasets.filter((d) => idSet.has(d.id));
  if (datasets.length !== createdIds.length) return null; // liveness: one was deleted mid-import
  const stems = datasets.map((d) => d.name.replace(/\.[^.]+$/, ""));
  const prefix = longestCommonPrefix(stems);
  if (prefix.length < 3) return null;
  return { prefix, ids: datasets.map((d) => d.id) };
}

/** Create `name` under `targetFolderId` (or root) and move the batch's
 *  workbooks — moveWorkbookToFolder cascades to member datasets — into it.
 *  Only ever called from the toast action's onClick, never eagerly. */
export function createFolderForBatch(
  get: SliceGet,
  name: string,
  datasetIds: readonly string[],
  targetFolderId: string | undefined,
): void {
  const s = get();
  const newFolderId = s.createFolder(targetFolderId ?? null, name);
  const idSet = new Set(datasetIds);
  const workbookIds = new Set(s.datasets.filter((d) => idSet.has(d.id) && d.workbookId).map((d) => d.workbookId!));
  for (const wbId of workbookIds) get().moveWorkbookToFolder(wbId, newFolderId);
}
