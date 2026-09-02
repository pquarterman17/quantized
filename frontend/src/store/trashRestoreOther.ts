// The restore logic for every trash kind EXCEPT `dataset` — split out of
// store/trash.ts and reached only via a dynamic `import()` (see
// `restoreFromTrash`'s "dataset" fast path in trash.ts). trash.ts is EAGER
// (part of useApp's slice composition, bundle-size measured); the every-
// kind restore rules below are real logic, not panel display — but they are
// ALSO only ever exercised from the already-lazy TrashPanel/TrashRow, on an
// explicit user click, which is exactly MAIN_PLAN #29's "anything only
// needed after a user action can be a dynamic import()" case. Moving them
// here (P3.7) recovered the eager-bundle growth this slice would otherwise
// have cost store/trash.ts directly.

import type { AppState } from "./useApp";
import {
  restoreDatasetInto,
  trashEntryId,
  type DatasetTrashEntry,
  type FolderTrashMember,
  type RestoreResult,
  type TrashEntry,
} from "./trash";

type OtherEntry = Exclude<TrashEntry, DatasetTrashEntry>;

/** Restoring a live-mode `editableFigure`/`figureDoc` whose bound dataset is
 *  gone: restore the dataset too if IT is also in trash (dependency restore,
 *  coherent, in the SAME transaction), else null the binding the exact same
 *  way a `.dwk` load clamps a dangling ref (`parseEditableFigures`,
 *  `sanitizeFigureDocs` — see `lib/workspace.ts` / `lib/figuredoc.ts`), and
 *  say so. */
function resolveDatasetDependency<T>(
  s: AppState,
  boundDatasetId: string | null,
  // Named `payload`, not `document` — architecture.test.ts's F1 chokepoint
  // guard raw-text-scans for an object-literal `document:` field anywhere in
  // the tree; this generic is unrelated to any PlotWindow.
  payload: T,
  withNulledBinding: (doc: T) => T,
): { restored: T; extraPatch: Partial<AppState>; consumedEntryIds: string[]; note?: string } {
  if (!boundDatasetId || s.datasets.some((d) => d.id === boundDatasetId)) {
    return { restored: payload, extraPatch: {}, consumedEntryIds: [] };
  }
  const dsEntry = s.trash.find(
    (e): e is DatasetTrashEntry => e.kind === "dataset" && e.dataset.id === boundDatasetId,
  );
  if (dsEntry) {
    const r = restoreDatasetInto(s, dsEntry.dataset);
    return {
      restored: payload,
      extraPatch: { datasets: r.datasets, workbooks: r.workbooks, expandedWorkbookIds: r.expandedWorkbookIds },
      consumedEntryIds: [trashEntryId(dsEntry)],
      note: `restored with its dataset "${r.dataset.name}"`,
    };
  }
  return {
    restored: withNulledBinding(payload),
    extraPatch: {},
    consumedEntryIds: [],
    note: "restored; its dataset is gone, so it renders frozen/disabled until relinked",
  };
}

/** Every non-`dataset` restore rule. `withoutEntry` mirrors trash.ts's own
 *  closure (same shape) so both halves of the switch stay one guarantee. */
export function computeOtherRestore(
  s: AppState,
  entry: OtherEntry,
  withoutEntry: (extraIds?: readonly string[]) => TrashEntry[],
): { patch: Partial<AppState>; result: RestoreResult } {
  switch (entry.kind) {
    case "editableFigure": {
      if (s.editableFigures.some((d) => d.id === entry.document.id)) {
        return { patch: { trash: withoutEntry() }, result: { ok: true } };
      }
      const dep = resolveDatasetDependency(
        s,
        entry.document.data.mode === "live" ? entry.document.bindings.datasetId : null,
        entry.document,
        (doc) => ({ ...doc, bindings: { ...doc.bindings, datasetId: null } }),
      );
      return {
        patch: {
          editableFigures: [...s.editableFigures, dep.restored],
          trash: withoutEntry(dep.consumedEntryIds),
          ...dep.extraPatch,
        },
        result: { ok: true, note: dep.note },
      };
    }
    case "figureDoc": {
      if (s.figureDocs.some((d) => d.id === entry.doc.id)) {
        return { patch: { trash: withoutEntry() }, result: { ok: true } };
      }
      const dep = resolveDatasetDependency(
        s,
        entry.doc.live ? entry.doc.datasetId : null,
        entry.doc,
        (doc) => ({ ...doc, datasetId: null }),
      );
      return {
        patch: {
          figureDocs: [...s.figureDocs, dep.restored],
          trash: withoutEntry(dep.consumedEntryIds),
          ...dep.extraPatch,
        },
        result: { ok: true, note: dep.note },
      };
    }
    case "page": {
      if (s.pages.some((p) => p.id === entry.page.id)) {
        return { patch: { trash: withoutEntry() }, result: { ok: true } };
      }
      // A page never binds a dataset directly — its panels reference
      // editableFigures BY ID (lib/pageDocument.ts's header). A panel whose
      // figure isn't live already resolves to {status:"missing"}
      // (`resolvePagePanel`, lib/pageDocumentActions.ts) — the page
      // module's existing fail-closed semantics, reused as-is.
      return { patch: { pages: [...s.pages, entry.page], trash: withoutEntry() }, result: { ok: true } };
    }
    case "report": {
      if (s.reports.some((r) => r.id === entry.report.id)) {
        return { patch: { trash: withoutEntry() }, result: { ok: true } };
      }
      return { patch: { reports: [...s.reports, entry.report], trash: withoutEntry() }, result: { ok: true } };
    }
    case "folder": {
      const liveFolderIds = new Set(s.folders.map((f) => f.id));
      // Skip any captured node whose id is live again (the same "came back
      // some other way" guard the dataset branch uses).
      const toAdd = entry.folders.filter((f) => !liveFolderIds.has(f.id));
      const merged = [...s.folders, ...toAdd];
      const mergedIds = new Set(merged.map((f) => f.id));
      const addedIds = new Set(toAdd.map((f) => f.id));
      // The subtree's OWN parent may itself be gone since — attach at root,
      // the same rule pruneOrphans/parseFolders apply elsewhere
      // (lib/foldertree.ts), reused rather than reimplemented.
      const folders = merged.map((f) =>
        addedIds.has(f.id) && f.parentId && !mergedIds.has(f.parentId) ? { ...f, parentId: null } : f,
      );

      let moved = 0;
      const totalMembers = entry.datasets.length + entry.workbooks.length;
      const reattach = <M extends { id: string; folderId?: string }>(
        live: readonly M[],
        captured: readonly FolderTrashMember[],
      ): M[] =>
        live.map((item) => {
          const capturedMember = captured.find((m) => m.id === item.id);
          if (!capturedMember) return item;
          // Still un-parented (folderId undefined) = re-point back to its
          // captured folder. Already re-homed elsewhere since the delete =
          // leave it where the user put it.
          if (item.folderId !== undefined) {
            moved += 1;
            return item;
          }
          return { ...item, folderId: capturedMember.folderId };
        });
      const datasets = reattach(s.datasets, entry.datasets);
      const workbooks = reattach(s.workbooks, entry.workbooks);

      return {
        patch: { folders, datasets, workbooks, trash: withoutEntry() },
        result: {
          ok: true,
          note:
            moved > 0
              ? `restored folder "${entry.folders[0].name}"; ${moved} of ${totalMembers} members had been moved and were left where they are`
              : undefined,
        },
      };
    }
  }
}
