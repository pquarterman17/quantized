// The restore rule for EVERY trash kind — split out of store/trash.ts and
// reached only via a dynamic `import()` from `restoreFromTrash` there.
// trash.ts is EAGER (part of useApp's slice composition, bundle-size
// measured); the per-kind restore rules below are real logic, not panel
// display — but they are ALSO only ever exercised from the already-lazy
// TrashPanel/TrashRow, on an explicit user click, which is exactly
// MAIN_PLAN #29's "anything only needed after a user action can be a
// dynamic import()" case. Moving them here (P3.7) recovered the eager-
// bundle growth this slice would otherwise have cost store/trash.ts
// directly; the `dataset` kind followed once the review-round fixes on the
// stack put the eager total 53 B over the pin (2026-09-03), so the fast path
// no longer lives on the eager side either — one `await import()` for all.

import type { Dataset } from "../lib/types";
import { deriveWorkbooks, type WorkbookNode } from "../lib/workbooks";
import { trashEntryId, type DatasetTrashEntry, type FolderTrashMember, type RestoreResult, type TrashEntry } from "./trash";
import type { AppState } from "./useApp";
import { nextWorkbookId } from "./workbookIds";

/** Shared by the standalone `dataset`-kind restore AND the dependency-aware
 *  restore a bound `editableFigure`/`figureDoc` triggers when ITS dataset is
 *  also in the trash (P3.7) — one self-heal implementation, not two copies
 *  that could drift. Assumes the caller already checked `dataset.id` is not
 *  currently live (the "id came back some other way" guard runs once, at
 *  each call site, before this). */
export function restoreDatasetInto(
  s: AppState,
  dataset: Dataset,
): { dataset: Dataset; datasets: Dataset[]; workbooks: WorkbookNode[]; expandedWorkbookIds: string[] } {
  let restored = dataset;
  let workbooks = s.workbooks;
  let expandedWorkbookIds = s.expandedWorkbookIds;
  const hasLiveWorkbook = restored.workbookId != null && s.workbooks.some((w) => w.id === restored.workbookId);
  if (!hasLiveWorkbook) {
    // P1 fix, carried over unchanged: deleteWorkbook removes the
    // WorkbookNode once every member dataset is trashed, so restoring one
    // of its worksheets here would otherwise carry a workbookId naming
    // nothing. Self-heal the SAME way (deriveWorkbooks), in-store, the
    // instant it comes back — mirrors importDatasets.ts's single-file path.
    const derived = deriveWorkbooks([restored], s.folders, nextWorkbookId);
    workbooks = [...s.workbooks, ...derived.workbooks];
    restored = { ...restored, workbookId: derived.membership[restored.id] };
    // The fresh workbook starts expanded (import-time creation's own rule) —
    // a restored row hidden behind a collapsed disclosure would look like a
    // failed restore.
    expandedWorkbookIds = [...new Set([...s.expandedWorkbookIds, ...derived.workbooks.map((w) => w.id)])];
  }
  return { dataset: restored, datasets: [...s.datasets, restored], workbooks, expandedWorkbookIds };
}

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

/** Every kind's restore rule, as a pure patch on the state the caller's
 *  `set` transaction hands in. `withoutEntry(extra)` is the trash minus the
 *  entry being restored (and any dependency entries it consumed). Pure so
 *  the rules are testable without a store; the transaction, the mid-await
 *  re-validation and the history decision all stay in trash.ts. */
export function computeRestore(
  s: AppState,
  entry: TrashEntry,
  withoutEntry: (extraIds?: readonly string[]) => TrashEntry[],
): { patch: Partial<AppState>; result: RestoreResult } {
  switch (entry.kind) {
    case "dataset": {
      // Guard against an id that came back some other way (a re-import,
      // an undo) while it was sitting in the trash: never create a
      // duplicate, never spend a workbook derivation on it.
      if (s.datasets.some((d) => d.id === entry.dataset.id)) {
        return { patch: { trash: withoutEntry() }, result: { ok: true } };
      }
      const r = restoreDatasetInto(s, entry.dataset);
      return {
        patch: {
          datasets: r.datasets,
          workbooks: r.workbooks,
          expandedWorkbookIds: r.expandedWorkbookIds,
          trash: withoutEntry(),
          activeId: s.activeId ?? entry.dataset.id,
          // L0.25 coherence: a restore that IS an activation (nothing was
          // active) yields the tree selection, like every other activation path.
          ...(s.activeId == null ? { librarySelection: null } : {}),
        },
        result: { ok: true },
      };
    }
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
      const restoredRootId = entry.folders[0].id;
      const childIds = new Set(entry.childFolders.map((c) => c.id));
      const folders = merged.map((f) => {
        if (addedIds.has(f.id) && f.parentId && !mergedIds.has(f.parentId)) return { ...f, parentId: null };
        // "reparent" re-parented these children UP to `dest`; one still
        // sitting exactly there goes back under the restored node. One the
        // user has since moved elsewhere stays where they put it.
        if (childIds.has(f.id) && (f.parentId ?? undefined) === entry.dest) return { ...f, parentId: restoredRootId };
        return f;
      });

      let moved = 0;
      const totalMembers = entry.datasets.length + entry.workbooks.length;
      const reattach = <M extends { id: string; folderId?: string }>(
        live: readonly M[],
        captured: readonly FolderTrashMember[],
      ): M[] =>
        live.map((item) => {
          const capturedMember = captured.find((m) => m.id === item.id);
          if (!capturedMember) return item;
          // Still exactly where the delete SENT it (`entry.dest`: the root
          // for "cascade", the deleted node's parent for "reparent") =
          // re-point back to its captured folder. Anywhere else = the user
          // re-homed it since; leave it where they put it.
          if (item.folderId !== entry.dest) {
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
