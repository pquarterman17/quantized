// The commit half of Append Project (`runAppendWorkspace`,
// store/workspaceHydration.ts), moved verbatim behind the dynamic `import()`
// that already loaded the merge engine (bundle diet slice 30,
// plans/BUNDLE_HEADROOM.md). Append is an explicit File-menu action; the
// action keeps its empty-project refusal and loads this before recording
// history, so a chunk that will not load leaves the project and its undo
// stack untouched, as before.

import { mergeWorkspace } from "../lib/workspaceMerge";
import type { LoadedWorkspace } from "../lib/workspace";
import { recomputeFormulaData } from "./computedColumns";
import { nextDatasetId } from "./idSeq";
import { grownCarry } from "./recipeFidelity";
import { notifyMigrationWarnings, toast } from "./toasts";
import type { AppState } from "./useApp";
import { nextWorkbookId } from "./workbookIds";
import { adoptFitModels } from "./workspaceHydration";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

/** `n` is `ws.datasets.length`, already checked non-zero by the caller. */
export function appendWorkspaceRun(set: SliceSet, get: SliceGet, ws: LoadedWorkspace, n: number): boolean {
  get().recordHistory("append workspace");
  const currentWorkbookIds = new Set(get().workbooks.map((w) => w.id));
  const { datasets: mergedDatasets, renamed, workbooks, analysisResults, droppedSheetRefs } = mergeWorkspace(
    get().datasets,
    ws,
    nextDatasetId,
    currentWorkbookIds,
    nextWorkbookId,
    get().analysisResults,
  );
  const wbNote =
    workbooks.length > 0
      ? ` — ${workbooks.length} workbook${workbooks.length === 1 ? "" : "s"} landed at Library root`
      : "";
  // A sheet("Name", …) link whose worksheet was not in the appended project
  // is cut: re-evaluate those columns so they show the error, and say so.
  const datasets = droppedSheetRefs
    ? mergedDatasets.map((d) => (d.formulas?.some((f) => f.sheets?.some((b) => b.id === null)) ? recomputeFormulaData(d) : d))
    : mergedDatasets;
  const cutNote = droppedSheetRefs
    ? ` — ${droppedSheetRefs} sheet() formula link${droppedSheetRefs === 1 ? "" : "s"} pointed outside the appended project and ${droppedSheetRefs === 1 ? "was" : "were"} cut`
    : "";
  const msg = `appended ${n} dataset${n === 1 ? "" : "s"} (${renamed} renamed)${wbNote}${cutNote}`;
  // P2.7: the appended file's unaccepted fit models JOIN the carry (which
  // un-certifies the Recipe Library, store/recipeFidelity.ts's
  // `recipeSourcesWhole`) in the same set() as its datasets.
  const carry = ws.fitModelCarry ?? [];
  set({
    datasets,
    workbooks: [...get().workbooks, ...workbooks],
    analysisResults: [...get().analysisResults, ...analysisResults],
    status: msg,
    ...(carry.length ? { fitModelCarry: grownCarry(get().fitModelCarry, carry) } : {}),
  });
  toast(msg, droppedSheetRefs ? "danger" : "ok");
  adoptFitModels(ws, set, get);
  // BUG-010: `ws.migrationWarnings` (produced when the appended .dwk was
  // parsed) has no status-line fold here at all — this never routes through
  // loadWorkspace — so the toast is its only surface.
  notifyMigrationWarnings(ws.migrationWarnings);
  return true;
}
