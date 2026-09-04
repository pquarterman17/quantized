// The single dataset-removal state patch (PR #139 review): extracted from
// useApp.ts's `removeDatasets` so `deleteWorkbook` (store/workbookActions.ts)
// can compose the SAME removal semantics with its own workbook-list update in
// ONE atomic `set()` under ONE history entry — one user Delete, one Undo —
// instead of delegating to the removeDatasets ACTION and stacking a second
// history snapshot on top. Reference pruning (origin figures/fidelity,
// reports, publication/editable figure bindings, plot windows) is identical
// for both callers by construction. Trash capture stays with the callers
// (`sendToTrash` BEFORE the patch) — `removeDatasetsPatch` is the pure
// post-trash state math; `removeDatasetsWithTrash` is the `removeDatasets`
// ACTION itself (history + trash + patch, or the permanent variant), homed
// here rather than in useApp.ts at its own size ratchet.

import { pruneEditableFigureRefs } from "./figureLifecycle";
import { pruneOriginFidelityRefs, pruneOriginFigureRefs } from "./originImport";
import type { AppState } from "./useApp";
import { pruneWindowDatasetRefs } from "./windowDocuments";
import { pruneReportRefs } from "../lib/report";

/** The slice of state `removeDatasetsPatch` reads and rewrites — every
 *  id-bearing field a dataset removal must prune. A `HistorySnapshot`
 *  carries the same fields, which is what lets `scrubDatasetsFromHistory`
 *  below run each retained snapshot through the SAME pruning. */
export type RemovableState = Pick<
  AppState,
  | "datasets"
  | "activeId"
  | "worksheetId"
  | "selectedIds"
  | "originFigures"
  | "originFidelity"
  | "reports"
  | "figureDocs"
  | "editableFigures"
  | "plotWindows"
>;

export function removeDatasetsPatch(s: RemovableState, ids: readonly string[]): Partial<RemovableState> {
  if (ids.length === 0) return {};
  const drop = new Set(ids);
  const datasets = s.datasets.filter((d) => !drop.has(d.id));
  const activeId = s.activeId && !drop.has(s.activeId) ? s.activeId : (datasets[0]?.id ?? null);
  const worksheetId = s.worksheetId && drop.has(s.worksheetId) ? null : s.worksheetId;
  const selectedIds = s.selectedIds.filter((x) => !drop.has(x));
  const originFigures = pruneOriginFigureRefs(s.originFigures, drop);
  const originFidelity = pruneOriginFidelityRefs(s.originFidelity, drop);
  const reports = pruneReportRefs(s.reports, drop);
  const figureDocs = s.figureDocs.map((f) =>
    f.datasetId && drop.has(f.datasetId) ? { ...f, datasetId: null } : f,
  );
  const editableFigures = pruneEditableFigureRefs(s.editableFigures, drop);
  const plotWindows = pruneWindowDatasetRefs(s.plotWindows, drop);
  return { datasets, activeId, worksheetId, selectedIds, originFigures, originFidelity, reports, figureDocs, editableFigures, plotWindows };
}

/** P3.7 review round: "Delete permanently" must be exactly that. Removing a
 *  dataset while leaving it inside earlier undo snapshots lets Ctrl+Z (or an
 *  undo of any OLDER edit) resurrect it, contradicting the confirmation the
 *  user just accepted. Each retained history AND future snapshot is run
 *  through `removeDatasetsPatch` — the SAME pruning a live removal applies
 *  (self-review on #292: stripping only `datasets` left `activeId`,
 *  `selectedIds`, `worksheetId`, figure bindings and Origin refs naming the
 *  ghost id, so an undo restored a state that violated the live-dataset
 *  selection invariant and handed a phantom id to the next Delete). */
export function scrubDatasetsFromHistory(
  s: Pick<AppState, "history" | "future">,
  ids: readonly string[],
): Pick<AppState, "history" | "future"> {
  const scrub = (entries: AppState["history"]): AppState["history"] =>
    entries.map((e) => ({ ...e, snapshot: { ...e.snapshot, ...removeDatasetsPatch(e.snapshot, ids) } }));
  return { history: scrub(s.history), future: scrub(s.future) };
}

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** P3.7 review round 3: the trash can ALREADY hold a copy of a dataset that
 *  is live again — ordinary delete captured it, Undo restored the history
 *  snapshot, and trash sits outside history on purpose (store/history.ts).
 *  "Delete permanently" on that dataset must drop the older `dataset:<id>`
 *  entry too, or one click of Restore contradicts "cannot be undone".
 *  Only dataset-kind entries whose payload is one of `ids` go; a folder
 *  entry that merely lists the id as a member records placement, not data. */
export function scrubDatasetsFromTrash(
  s: Pick<AppState, "trash">,
  ids: readonly string[],
): Pick<AppState, "trash"> {
  const gone = new Set(ids);
  return { trash: s.trash.filter((e) => !(e.kind === "dataset" && gone.has(e.dataset.id))) };
}

/** The `removeDatasets` action (bulk-remove by explicit id list — item 17's
 *  "manage books" dialog; unlike `removeSelected` it never touches the
 *  transient row selection). `{permanent}` (P3.7, review round) means no
 *  trash entry (not even an older one — `scrubDatasetsFromTrash`), no undo
 *  step, AND no earlier snapshot still holding the dataset — see
 *  `scrubDatasetsFromHistory`. Nothing in this session can bring it back. */
export function removeDatasetsWithTrash(
  get: SliceGet,
  set: SliceSet,
  ids: readonly string[],
  opts?: { permanent?: boolean },
): void {
  if (opts?.permanent) {
    set((s) => ({
      ...removeDatasetsPatch(s, ids),
      ...scrubDatasetsFromHistory(s, ids),
      ...scrubDatasetsFromTrash(s, ids),
    }));
    return;
  }
  get().recordHistory("remove datasets");
  get().sendToTrash(get().datasets.filter((d) => ids.includes(d.id))); // #32 trash
  set((s) => removeDatasetsPatch(s, ids)); // shared with deleteWorkbook (workbookActions.ts)
}
