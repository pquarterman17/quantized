// Explicit workbook SEPARATE (LIBRARY_WORKBOOK_UX_PLAN PR J slice 1 —
// L0.51) — composed into useApp exactly like store/workbookActions.ts /
// store/workbookCombine.ts. Owns exactly one piece of state, `separatePreview`
// (transient dialog state — HISTORY_EXCLUDED, see architecture.test.ts), plus
// the two actions that build and apply it.
//
// Preview-before-commit is a HARD gate here, not just a UI convention:
// `commitSeparateWorksheets` refuses outright when `separatePreview` is null
// (L0.51's "Preview the affected-item plan before commit"), and it applies
// the SAME plan `previewSeparateWorksheets` computed — see
// lib/workbookSeparate.ts's header for why that plan can never drift from
// what the commit's `buildLibraryHierarchy` re-derivation actually produces.
// The one thing that CAN go stale between preview and commit is liveness (a
// previewed worksheet removed by some other gesture before the user
// confirms) — re-checked explicitly below, failing closed with zero
// mutation per this PR's transactional-discipline requirement.
//
// P1 fix (adversarial review, 2026-08-18): folder placement is owned by the
// WORKBOOK (lib/workbooks.ts:52-54 / moveWorkbookToFolder's own pattern in
// workbookActions.ts) — every dataset whose `workbookId` this action
// reassigns (the seed AND every closure-swept dependent, which may have
// drifted to a DIFFERENT `folderId` than the seed, e.g. an older derived
// worksheet created before a since-undone folder move) gets its `folderId`
// re-homed to the new workbook's own `folderId`
// (`SeparatePlan.newWorkbookFolderId`, the source workbook's folder —
// UNCONDITIONALLY, never "only if it already matched"), so Folder view
// (`lib/foldertree.ts`'s `folderDatasets`) and the workbook tree can never
// disagree about where a separated worksheet or its dependents live.

import { computeSeparatePlan, type SeparatePlan } from "../lib/workbookSeparate";
import { nextWorkbookId } from "./workbookIds";
import { toast } from "./toasts";
import type { WorkbookNode } from "../lib/workbooks";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

function hierarchyInput(s: AppState) {
  return {
    folders: s.folders,
    workbooks: s.workbooks,
    datasets: s.datasets,
    originFigures: s.originFigures,
    editableFigures: s.editableFigures,
    publicationFigures: s.figureDocs,
    pages: s.pages,
    reports: s.reports,
  };
}

export interface WorkbookSeparateSlice {
  /** Non-null while the Separate preview dialog is open; the plan the next
   *  `commitSeparateWorksheets()` call applies. Transient — never undoable,
   *  never round-trips (`architecture.test.ts`'s HISTORY_EXCLUDED). */
  separatePreview: SeparatePlan | null;
  /** Compute and open the affected-item preview for separating
   *  `worksheetIds` (usually one, but a multi-select gesture may pass
   *  several — they land in ONE resulting workbook). Pure computation over
   *  live state; makes no mutation of its own. A status message and no
   *  preview open on an empty request. */
  previewSeparateWorksheets: (worksheetIds: readonly string[]) => void;
  /** Discard the open preview without applying it. No-op if none is open. */
  closeSeparatePreview: () => void;
  /** Apply the CURRENTLY OPEN preview atomically (L0.51's "commit applies
   *  exactly the previewed plan"): one `recordHistory` entry, one `set()`.
   *  Refuses (no mutation) when no preview is open, OR when a previewed
   *  worksheet no longer exists (a race since the preview opened) — the
   *  preview then stays open so the caller can re-preview rather than losing
   *  its place. `name` overrides the plan's suggested default (the dialog's
   *  editable name field); blank/omitted falls back to the suggestion. Every
   *  moving dataset's `folderId` is re-homed to the new workbook's own
   *  (`plan.newWorkbookFolderId`, UNCONDITIONALLY — see this file's header P1
   *  note) so Folder view can never disagree with the workbook tree. Returns
   *  the new workbook's id on success, null on refusal. */
  commitSeparateWorksheets: (name?: string) => string | null;
}

export function createWorkbookSeparateSlice(set: SliceSet, get: SliceGet): WorkbookSeparateSlice {
  return {
    separatePreview: null,

    previewSeparateWorksheets: (worksheetIds) => {
      if (worksheetIds.length === 0) {
        get().setStatus("Separate unavailable: nothing selected");
        return;
      }
      // P3 booking (adversarial review, 2026-08-18): `nextWorkbookId()` is
      // minted HERE, once per open, which is safe today (a static preview,
      // opened once per gesture). A slice-2 LIVE-UPDATING preview (e.g.
      // re-running as the user tweaks the selection) must NOT call this on
      // every keystroke/recompute — mint once at commit instead, or memoize
      // the id across recomputes of the same open preview, or a cancelled
      // preview leaks session-unique ids for no reason (harmless individually,
      // but needless churn). Tracked in the plan's PR J slice-2 line.
      const plan = computeSeparatePlan(hierarchyInput(get()), worksheetIds, nextWorkbookId());
      set({ separatePreview: plan });
    },

    closeSeparatePreview: () => set({ separatePreview: null }),

    commitSeparateWorksheets: (name) => {
      const s = get();
      const plan = s.separatePreview;
      if (!plan || plan.movingDatasetIds.length === 0) {
        s.setStatus("Separate unavailable: open a preview first");
        return null;
      }
      const live = new Set(s.datasets.map((d) => d.id));
      if (!plan.movingDatasetIds.every((id) => live.has(id))) {
        s.setStatus("Separate unavailable: the previewed worksheet changed — re-open Separate to refresh the plan");
        return null;
      }

      const trimmedName = (name ?? "").trim() || plan.suggestedName || "New Workbook";
      const movingSet = new Set(plan.movingDatasetIds);
      const newWorkbookId = plan.newWorkbookId;

      get().recordHistory("separate worksheet");
      const newFolderId = plan.newWorkbookFolderId;
      const workbook: WorkbookNode = { id: newWorkbookId, name: trimmedName, folderId: newFolderId };
      set((st) => ({
        workbooks: [...st.workbooks, workbook],
        datasets: st.datasets.map((d) =>
          movingSet.has(d.id) ? { ...d, workbookId: newWorkbookId, folderId: newFolderId } : d,
        ),
        separatePreview: null,
      }));

      toast(`separated into "${trimmedName}"`, "ok");
      get().setStatus(`separated into "${trimmedName}"`);
      return newWorkbookId;
    },
  };
}
