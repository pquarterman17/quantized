// Recoverable project trash (MAIN_PLAN #32; extended to every deletable
// object type by PRIMARY_SOFTWARE_AUDIT_PLAN P3.7): deleted datasets,
// editable figures, legacy publication figures, figure pages, reports, and
// deleted folders (their subtree + the members that got un-parented) all
// land here instead of straight to nothing.
//
// This is NOT a duplicate of undo. Undo is a session-scoped edit history that
// dies with the tab; trash is the answer to "I deleted that yesterday and only
// noticed today". Different guarantee, different lifetime. `removeReport` and
// `removeFigureDoc` in particular record NO undo entry at all (see their own
// comments) — trash is their ONLY recovery path.
//
// BOUNDED BY CONSTRUCTION, because #32 explicitly wants recovery storage that
// cannot grow forever: capped by entry count, by age, AND by total serialized
// size (P3.7), evicted oldest-first on every send, newest entry always kept
// even alone over the size cap (mirrors `lib/autosaveGenerations.ts`'s
// `capBySize`). The rules are pure functions so the eviction policy is
// testable without a store.
//
// Raw SOURCE FILES are never involved. Trash holds the in-memory records the
// app already had (Dataset / FigureDocument / FigureDoc / PageDocument /
// ReportEntry / FolderNode); nothing on disk is moved, renamed or deleted.
//
// KINDS (discriminated union, P3.7):
//   dataset       — a removed Dataset (unchanged since #32).
//   editableFigure — a deleted canonical FigureDocument (figureLifecycle.ts).
//   figureDoc     — a deleted legacy Publication Preview FigureDoc.
//   page          — a deleted saved Figure Page (PageDocument).
//   report        — a deleted ReportEntry.
//   folder        — a deleted folder. Captures the removed subtree
//     (`deleteFolder(id,"cascade")`: every FolderNode under it; "reparent":
//     just the one node — children survive, re-parented up) PLUS which live
//     dataset/workbook members had their `folderId` cleared, so restore can
//     re-home them. `deleteFolder` deletes no dataset either way — see its
//     own header — so there is nothing to lose there, only placement.
//
// RESTORE (`restoreFromTrash`) is dependency-aware where a dependency can be
// coherently restored, and states the limitation where it can't — see the
// function's own doc for the exact rules per kind.
//
// BOUNDS: `bytes` is computed ONCE at trash time (`byteSize`, a single
// `JSON.stringify(...).length`) and stored on the entry — never recomputed
// per render. The panel's own display-only helpers (`trashSummary`,
// `formatTrashBytes`) live in `lib/trashSummary.ts`, imported ONLY by the
// lazy-loaded `TrashPanel` — this file is EAGER (part of `useApp`'s slice
// composition), so nothing panel-only belongs here.

import type { FigureDocument } from "../lib/figureDocument";
import type { FigureDoc } from "../lib/figuredoc";
import type { FolderNode, Dataset } from "../lib/types";
import type { PageDocument } from "../lib/pageDocument";
import type { ReportEntry } from "../lib/report";
import { deriveWorkbooks, type WorkbookNode } from "../lib/workbooks";
import type { AppState } from "./useApp";
import { nextWorkbookId } from "./workbookIds";

/** One serialized byte count, computed once at the moment an object is
 *  trashed and stored on the entry (`TrashEntryBase.bytes`) — the size cap
 *  (`TRASH_MAX_BYTES`) must never re-stringify on every render. UTF-16 code
 *  units, same convention as `autosaveGenerations.ts`'s `totalSize`. */
export function byteSize(payload: unknown): number {
  return JSON.stringify(payload).length;
}

/** Approximate serialized characters per numeric cell — a JSON float like
 *  `-1234.5678901,` runs 10–16 characters; 14 sits in the middle and errs
 *  slightly high, which is the safe direction for a cap. */
const APPROX_CHARS_PER_NUMBER = 14;

/** Size estimate for a DATASET entry. Datasets are the one kind whose payload
 *  can be huge: P0.4's 1M-row member serializes to ~140 MB, and measured here
 *  (2026-09-02, node 22) `JSON.stringify` of that dataset takes ~1.2 s on the
 *  main thread — a stall added to every DELETE of a big dataset, on a path
 *  that used to be instant. The cap only needs an order-of-magnitude number,
 *  so a dimension-based estimate (20 ms on the same dataset, ~30% under the
 *  exact figure with the constant above) is the honest trade. Every other
 *  kind's payload is small and keeps the exact `byteSize`. */
export function datasetByteEstimate(dataset: Dataset): number {
  const d = dataset.data;
  let cells = d.time.length;
  for (const row of d.values) cells += row.length;
  const text = d.labels.join("").length + d.units.join("").length + dataset.name.length;
  return cells * APPROX_CHARS_PER_NUMBER + text;
}

interface TrashEntryBase {
  /** Epoch ms the entry was trashed. */
  at: number;
  /** `byteSize` of this entry's own payload, computed once at capture time. */
  bytes: number;
}

export interface DatasetTrashEntry extends TrashEntryBase {
  kind: "dataset";
  dataset: Dataset;
}
export interface EditableFigureTrashEntry extends TrashEntryBase {
  kind: "editableFigure";
  document: FigureDocument;
}
export interface FigureDocTrashEntry extends TrashEntryBase {
  kind: "figureDoc";
  doc: FigureDoc;
}
export interface PageTrashEntry extends TrashEntryBase {
  kind: "page";
  page: PageDocument;
}
export interface ReportTrashEntry extends TrashEntryBase {
  kind: "report";
  report: ReportEntry;
}
/** One member (dataset or workbook) that was un-parented by the folder
 *  deletion this entry captures, with the SPECIFIC folder (within the
 *  captured subtree) it was in — richer than a flat id list so a multi-level
 *  subtree restores each member to its own original folder, not just the
 *  subtree's root. */
export interface FolderTrashMember {
  id: string;
  folderId: string;
}
export interface FolderTrashEntry extends TrashEntryBase {
  kind: "folder";
  /** The removed subtree, parent-first (see `store/folderDelete.ts`'s
   *  `captureFolderDeletion`) — `folders[0]` is always the deleted node
   *  itself, for both `deleteFolder` modes. */
  folders: FolderNode[];
  datasets: FolderTrashMember[];
  workbooks: FolderTrashMember[];
  /** Where the delete SENT every member and child: `undefined` (the root)
   *  for "cascade", the deleted node's own parent for "reparent". Restore
   *  treats a member still sitting exactly there as "where the delete left
   *  it" and re-homes it; anything else the user moved since stays put.
   *  Without this, a reparent-deleted nested folder's members (re-parented
   *  UP, not to the root) read as user-moved and were never re-homed. */
  dest?: string;
  /** "reparent" only: the child folders that survived, re-parented up to
   *  `dest` — restore re-parents them back under `folders[0]`. Empty for
   *  "cascade", where children are part of `folders` itself. */
  childFolders: FolderTrashMember[];
}

export type TrashEntry =
  | DatasetTrashEntry
  | EditableFigureTrashEntry
  | FigureDocTrashEntry
  | PageTrashEntry
  | ReportTrashEntry
  | FolderTrashEntry;

/** Stable key for a trash entry: `${kind}:${objectId}` — lets the panel key
 *  rows and `restoreFromTrash`/`purgeTrash` address any kind uniformly. */
export function trashEntryId(entry: TrashEntry): string {
  const objectId =
    entry.kind === "dataset" ? entry.dataset.id
    : entry.kind === "editableFigure" ? entry.document.id
    : entry.kind === "figureDoc" ? entry.doc.id
    : entry.kind === "page" ? entry.page.id
    : entry.kind === "report" ? entry.report.id
    : entry.folders[0].id;
  return `${entry.kind}:${objectId}`;
}

/** Most a user plausibly wants to reach back through. */
export const TRASH_MAX_ENTRIES = 25;
/** Entries older than this are dropped on the next trash operation. */
export const TRASH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Total trash size cap. P0.4 measured (2026-07-26, `be40a69`) a `.dwk` with
 *  a single 1M-row member at 188 MB — ONE such dataset already exceeds this
 *  cap, which is deliberate: `evictTrash` always keeps the newest entry even
 *  when it alone is over budget (below), so a big-data user still gets one
 *  slot of recent-delete recovery rather than trash silently refusing to
 *  hold their data at all. 128 MiB sits comfortably above the ordinary case
 *  (the ~25-entry/~7-day caps bite first for typical datasets) while still
 *  being a real ceiling against an accumulation of many mid-size deletes. */
export const TRASH_MAX_BYTES = 128 * 1024 * 1024;

/** Apply all three caps: drop anything past the age limit, keep the newest N,
 *  then drop the oldest until total `bytes` fits `maxBytes` — ALWAYS keeping
 *  at least the newest entry even when it alone exceeds the byte cap (mirrors
 *  `lib/autosaveGenerations.ts`'s `capBySize`: a user is better served by one
 *  slot that might not fit everything than by trash refusing to hold their
 *  most recent delete at all). Pure — `now` is passed in so tests never
 *  depend on the clock. */
export function evictTrash(
  entries: readonly TrashEntry[],
  now: number,
  maxEntries = TRASH_MAX_ENTRIES,
  maxAgeMs = TRASH_MAX_AGE_MS,
  maxBytes = TRASH_MAX_BYTES,
): TrashEntry[] {
  const byAgeAndCount = entries
    .filter((e) => now - e.at <= maxAgeMs)
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, maxEntries));
  const kept: TrashEntry[] = [];
  let used = 0;
  for (const entry of byAgeAndCount) {
    if (kept.length > 0 && used + entry.bytes > maxBytes) break;
    kept.push(entry);
    used += entry.bytes;
  }
  return kept;
}

export interface TrashSlice {
  /** Trash panel visibility. Lives here rather than on useApp: it is trash's
   *  own UI state, and useApp sits at its size ratchet. */
  trashOpen: boolean;
  setTrashOpen: (trashOpen: boolean) => void;
  /** MAIN #38 project-wide search panel. Shares this slice for the same
   *  reason trashOpen does: it is tool-window UI state and useApp is at its
   *  ratchet. */
  searchOpen: boolean;
  setSearchOpen: (searchOpen: boolean) => void;
  /** Newest first. Session-scoped: deliberately NOT serialized into a `.dwk`,
   *  which is a portable description of a workspace, not a wastebasket. */
  trash: TrashEntry[];
  /** Capture datasets on their way out of the library. Kept as the ORIGINAL
   *  dataset-only signature (P3.7): every existing call site
   *  (`removeDatasets`, `deleteWorkbook`, the Delete key) is untouched. */
  sendToTrash: (datasets: readonly Dataset[], now?: number) => void;
  /** P3.7: capture already-shaped entries of ANY kind — the generalization
   *  `sendToTrash` deliberately does not become, so its own signature never
   *  has to change. */
  sendEntriesToTrash: (entries: readonly TrashEntry[], now?: number) => void;
  /** Put one back, by its `trashEntryId`. Dependency-aware: see the
   *  implementation's own doc for the exact rule per kind. Async: every
   *  kind but `dataset` resolves through a dynamic import (bundle-size —
   *  see trashRestoreOther.ts's header); await it before reading the result. */
  restoreFromTrash: (entryId: string) => Promise<RestoreResult>;
  /** Permanently drop one entry (by `trashEntryId`), or the whole trash when
   *  `entryId` is omitted. */
  purgeTrash: (entryId?: string) => void;
}

export type RestoreResult = { ok: true; note?: string } | { ok: false; reason: string };

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type SliceGet = () => AppState;

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

// The dependency-aware restore rule for a live-mode `editableFigure`/
// `figureDoc` whose bound dataset is gone (restore the dataset too if it's
// ALSO in trash, else null the binding the same way a `.dwk` load clamps a
// dangling ref), plus every OTHER kind's restore rule, live in
// store/trashRestoreOther.ts — reached only via a dynamic `import()` in
// `restoreFromTrash` below (BUNDLE SIZE: this file is eager; everything in
// that one is only ever exercised from the already-lazy TrashPanel, on an
// explicit click — see that file's own header).

export function createTrashSlice(set: SliceSet, get: SliceGet): TrashSlice {
  return {
    trash: [],
    trashOpen: false,
    setTrashOpen: (trashOpen) => set({ trashOpen }),
    searchOpen: false,
    setSearchOpen: (searchOpen) => set({ searchOpen }),

    sendToTrash: (datasets, now = Date.now()) => {
      if (datasets.length === 0) return;
      get().sendEntriesToTrash(
        datasets.map((dataset): TrashEntry => ({ kind: "dataset", at: now, bytes: datasetByteEstimate(dataset), dataset })),
        now,
      );
    },

    sendEntriesToTrash: (entries, now = Date.now()) => {
      if (entries.length === 0) return;
      set((s) => ({ trash: evictTrash([...entries, ...s.trash], now) }));
    },

    restoreFromTrash: async (entryId) => {
      const state = get();
      const entry = state.trash.find((e) => trashEntryId(e) === entryId);
      if (!entry) return { ok: false, reason: "that entry is no longer in the trash" };
      // Deliberately NOT an undo step (review finding, P3.7). `trash` is not
      // part of the history snapshot (store/history.ts's `snapshotOf`), so a
      // restore that recorded history would let Ctrl+Z remove the restored
      // object AGAIN while its trash entry stayed consumed — the one sequence
      // that turns "recoverable" into "gone". Restore is reversed by deleting
      // the object again, which lands it back in the trash.

      if (entry.kind === "dataset") {
        const result: RestoreResult = { ok: true };
        set((s) => {
          const trash = s.trash.filter((e) => trashEntryId(e) !== entryId);
          // Guard against an id that came back some other way (a re-import,
          // an undo) while it was sitting in the trash: never create a
          // duplicate, never spend a workbook derivation on it.
          if (s.datasets.some((d) => d.id === entry.dataset.id)) return { trash };
          const r = restoreDatasetInto(s, entry.dataset);
          return {
            datasets: r.datasets,
            workbooks: r.workbooks,
            expandedWorkbookIds: r.expandedWorkbookIds,
            trash,
            activeId: s.activeId ?? entry.dataset.id,
            // L0.25 coherence: a restore that IS an activation (nothing was
            // active) yields the tree selection, like every other activation path.
            ...(s.activeId == null ? { librarySelection: null } : {}),
          };
        });
        return result;
      }

      // Every other kind's restore rule lives in a dynamically-imported
      // chunk (bundle-size — see trashRestoreOther.ts's header): reached
      // only from the already-lazy TrashPanel, on an explicit click.
      const { computeOtherRestore } = await import("./trashRestoreOther");
      let result: RestoreResult = { ok: true };
      set((s) => {
        const withoutEntry = (extraIds: readonly string[] = []) =>
          s.trash.filter((e) => {
            const id = trashEntryId(e);
            return id !== entryId && !extraIds.includes(id);
          });
        const { patch, result: computed } = computeOtherRestore(s, entry, withoutEntry);
        result = computed;
        return patch;
      });
      return result;
    },

    purgeTrash: (entryId) =>
      set((s) => ({ trash: entryId ? s.trash.filter((e) => trashEntryId(e) !== entryId) : [] })),
  };
}

/** `removeReport`/`removeFigureDoc` (useApp.ts) both record NO undo entry —
 *  Trash is their ONLY recovery path — and are otherwise identical
 *  "capture, then filter it out" shapes. Homed here (not useApp.ts, at its
 *  own size ratchet) since both are pure trash-capture bookkeeping. */
export function removeReportWithTrash(get: SliceGet, set: SliceSet, id: string): void {
  const report = get().reports.find((r) => r.id === id);
  if (report) get().sendEntriesToTrash([{ kind: "report", at: Date.now(), bytes: byteSize(report), report }]);
  set((s) => ({ reports: s.reports.filter((r) => r.id !== id), openReportId: s.openReportId === id ? null : s.openReportId }));
}

export function removeFigureDocWithTrash(get: SliceGet, set: SliceSet, id: string): void {
  const doc = get().figureDocs.find((f) => f.id === id);
  if (doc) get().sendEntriesToTrash([{ kind: "figureDoc", at: Date.now(), bytes: byteSize(doc), doc }]);
  set((s) => ({ figureDocs: s.figureDocs.filter((f) => f.id !== id) }));
}
