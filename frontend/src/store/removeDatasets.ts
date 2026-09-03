// The single dataset-removal state patch (PR #139 review): extracted from
// useApp.ts's `removeDatasets` so `deleteWorkbook` (store/workbookActions.ts)
// can compose the SAME removal semantics with its own workbook-list update in
// ONE atomic `set()` under ONE history entry — one user Delete, one Undo —
// instead of delegating to the removeDatasets ACTION and stacking a second
// history snapshot on top. Reference pruning (origin figures/fidelity,
// reports, publication/editable figure bindings, plot windows) is identical
// for both callers by construction. Trash capture stays with the callers
// (`sendToTrash` BEFORE the patch) — this is the pure post-trash state math.

import { pruneEditableFigureRefs } from "./figureLifecycle";
import { pruneOriginFidelityRefs, pruneOriginFigureRefs } from "./originImport";
import type { AppState } from "./useApp";
import { pruneWindowDatasetRefs } from "./windowDocuments";
import { pruneReportRefs } from "../lib/report";

export function removeDatasetsPatch(s: AppState, ids: readonly string[]): Partial<AppState> {
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
 *  user just accepted. Strip `ids` from every retained history AND future
 *  snapshot's `datasets` — `restorePatch` already nulls window bindings and
 *  drops selections that name a dataset absent from a snapshot, so the
 *  scrubbed snapshots restore coherently. */
export function scrubDatasetsFromHistory(
  s: Pick<AppState, "history" | "future">,
  ids: readonly string[],
): Pick<AppState, "history" | "future"> {
  const gone = new Set(ids);
  const scrub = (entries: AppState["history"]): AppState["history"] =>
    entries.map((e) => ({
      ...e,
      snapshot: { ...e.snapshot, datasets: e.snapshot.datasets.filter((d) => !gone.has(d.id)) },
    }));
  return { history: scrub(s.history), future: scrub(s.future) };
}
