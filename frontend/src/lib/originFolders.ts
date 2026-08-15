// Auto-organize a freshly-imported Origin project into folders + workbooks
// (LIBRARY_WORKBOOK_UX_PLAN PR A3, superseding project-organization plan item
// 4's book-surrogate-folder version) — folders mirror Origin's own Project
// Explorer; workbooks implement the confirmed L0.1 hierarchy (folder ->
// workbook -> worksheet).
//
// The reader recovers the project → folder → book → sheet hierarchy: each book
// DataStruct carries `metadata.origin_folder_path` (the Project Explorer folder
// names from the project root down to the book's folder, root-exclusive) plus
// `metadata.origin_book` ("Book4", "Book4@2", … one per book-sheet). But
// `useApp.importFiles` fans a project out into a FLAT list of "<stem>:<book>"
// datasets. This turns that flat list back into folders + workbooks:
//
//   <file stem>                         ← the project root folder
//     <origin_folder_path…>             ← Origin's Project Explorer folders (nested)
//       <sheet datasets>                ← every sheet lands DIRECTLY here — see below
//
//   one WorkbookNode per base book, folderId = that same path folder, for
//   EVERY book including single-sheet ones (L0.2/L0.3: a book is a workbook,
//   always). There is NO per-book folder any more — the pre-A3 version of
//   this module created one for multi-sheet books ("book surrogate"); A3
//   retires that in favor of the real workbook layer. A pre-A3 document that
//   still has such a surrogate folder is CONVERTED on load, not re-created —
//   see lib/workbooks.ts's `applyWorkbookMigration`.
//
// Designed to be GENERAL, not tuned to any sample project: arbitrary nesting
// depth, any folder names (spaces, unicode, punctuation, duplicate names under
// different parents, a folder named like a nested path), books at the root
// (empty path), and books with 0/1/N sheets all work. When a book has no
// `origin_folder_path` (older reader, or a container whose folder tree we
// can't decode), it falls back to sitting directly under the project folder.
//
// Workbook grouping/naming is NOT reimplemented here — it's delegated whole to
// lib/workbooks.ts's `deriveWorkbooks`, the exact same function `parseWorkspace`
// uses to derive/repair workbooks on load. That is what makes the plan's
// consistency acceptance gate (import-time creation and load-time derivation
// must never disagree) true BY CONSTRUCTION rather than by two hand-written
// implementations that could drift apart: this module only resolves FOLDER
// placement and stamps each dataset's `folderId` accordingly, then hands the
// folder-stamped datasets to `deriveWorkbooks` for the workbook layer. (In the
// pathological case where a Project Explorer folder happens to be named
// exactly like the one book that is its sole occupant, `deriveWorkbooks`'s own
// rule-2 surrogate check would treat that FRESH folder as convertible too —
// consistent, if surprising, and never reachable by real Origin project
// layouts.)
//
// Pure: (stem, datasets, genFolderId, genWorkbookId) → a plan the store
// applies. No store import, so it's unit-testable without a backend.

import { deriveWorkbooks, type WorkbookNode } from "./workbooks";
import type { Dataset, FolderNode } from "./types";

export interface OriginImportPlan {
  /** New folder nodes to append (project folder first, then Origin path folders). */
  folders: FolderNode[];
  /** New workbook nodes to append — one per base book, single- or multi-sheet. */
  workbooks: WorkbookNode[];
  /** datasetId → folderId assignments for the imported datasets: each sheet's
   *  Project Explorer path folder (there is no per-book folder any more). */
  folderMembership: Record<string, string>;
  /** datasetId → workbookId assignments for the imported datasets. */
  workbookMembership: Record<string, string>;
  /** Folder ids to reveal expanded (project + every folder it creates). */
  expanded: string[];
}

function meta(d: Dataset): Record<string, unknown> {
  return (d.data.metadata as Record<string, unknown> | undefined) ?? {};
}

/** The Project Explorer folder path (root-exclusive) for a book, or [] if none. */
function folderPath(d: Dataset): string[] {
  const raw = meta(d).origin_folder_path;
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && p !== "") : [];
}

/**
 * Plan folders + workbooks for one imported Origin project.
 *
 * @param stem          the source file stem (e.g. "Moke" from "Moke.opj") —
 *                       the project folder's name (Origin's project root).
 * @param datasets      the project's imported book-sheet datasets, in import
 *                       order. Must not yet carry `folderId`/`workbookId` —
 *                       this plans FRESH placement, it does not read any
 *                       existing assignment.
 * @param genFolderId   supplies fresh folder ids (the store's `nextFolderId`).
 * @param genWorkbookId supplies fresh workbook ids (`store/workbookIds.ts`'s
 *                      `nextWorkbookId`).
 */
export function planOriginImport(
  stem: string,
  datasets: Dataset[],
  genFolderId: () => string,
  genWorkbookId: () => string,
): OriginImportPlan {
  const projectId = genFolderId();
  const folders: FolderNode[] = [{ id: projectId, name: stem || "Project", parentId: null, order: 0 }];
  const folderMembership: Record<string, string> = {};
  const expanded: string[] = [projectId];

  // Next child-order counter per parent folder, so folders append in
  // first-appearance order under each parent.
  const nextOrder = new Map<string, number>([[projectId, 0]]);
  const bump = (parentId: string): number => {
    const n = nextOrder.get(parentId) ?? 0;
    nextOrder.set(parentId, n + 1);
    return n;
  };

  // Resolve a Project Explorer folder path to a folder id, creating (and caching)
  // each intermediate folder under the project root. Keyed on (parentId, name)
  // via JSON.stringify — NOT a joined path string — so it's collision-proof for
  // ANY folder names (spaces, separators, duplicate names under different
  // parents, a folder named the same as a nested path). Handles arbitrary
  // nesting depth. Byte-identical to the pre-A3 version of this helper.
  const pathCache = new Map<string, string>();
  const folderForPath = (path: string[]): string => {
    let parentId = projectId;
    for (const part of path) {
      const key = JSON.stringify([parentId, part]);
      let id = pathCache.get(key);
      if (id === undefined) {
        id = genFolderId();
        folders.push({ id, name: part, parentId, order: bump(parentId) });
        expanded.push(id);
        pathCache.set(key, id);
        nextOrder.set(id, 0);
      }
      parentId = id;
    }
    return parentId;
  };

  // Every sheet lands directly in its Project Explorer path folder — no
  // per-book folder any more (L0.1: the book IS the workbook layer now).
  for (const d of datasets) {
    folderMembership[d.id] = folderForPath(folderPath(d));
  }

  // Workbook layer: hand the folder-stamped datasets to deriveWorkbooks (the
  // SAME function parseWorkspace's migration uses) so grouping/naming/order
  // can never drift from what a reload would derive. `folders` is passed for
  // its rule-2 surrogate check — a no-op here in every real project layout,
  // since these are all FRESH folders this call just created (never named
  // after a book that isn't also its sole occupant — see the header doc).
  const withFolders = datasets.map((d) => ({ ...d, folderId: folderMembership[d.id] }));
  const derived = deriveWorkbooks(withFolders, folders, genWorkbookId);

  return {
    folders,
    workbooks: derived.workbooks,
    folderMembership,
    workbookMembership: derived.membership,
    expanded,
  };
}
