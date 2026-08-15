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
 *  (librarySelection doesn't change mid-batch) and reused for every file. */
export function resolveImportTargetFolderId(get: SliceGet): string | undefined {
  const s = get();
  const sel = s.librarySelection;
  if (!sel) return undefined;
  if (sel.kind === "folder") return sel.id;
  return s.workbooks.find((w) => w.id === sel.id)?.folderId;
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
 *  overlay offer didn't qualify, so the two action toasts never stack. */
export function batchFolderOffer(get: SliceGet, createdIds: readonly string[]): BatchFolderOffer | null {
  if (createdIds.length < 2) return null;
  const idSet = new Set(createdIds);
  const datasets = get().datasets.filter((d) => idSet.has(d.id));
  if (datasets.length !== createdIds.length) return null; // an Origin book fan-out
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
