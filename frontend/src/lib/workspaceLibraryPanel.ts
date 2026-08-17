// LIBRARY_WORKBOOK_UX_PLAN PR E2 — validators for the three Library-panel
// session fields (store/libraryPanel.ts's `librarySelection`/
// `workbookLastChild`/`expandedWorkbookIds`). Split out of lib/workspace.ts
// (that module's own size ratchet) the same way lib/workspaceOrigin.ts
// already holds the Origin-figure validators — workspace.ts stays the thin
// parse/serialize orchestrator; each cohesive validation concern gets its
// own small sibling.

import type { LibrarySelection } from "../store/libraryPanel";

// Deliberately NOT "worksheet" — `LibrarySelection`'s kind union excludes it
// on purpose (a worksheet's "current" IS `selectedIds`, never this field;
// see store/libraryPanel.ts's header and components/Library/libraryOpen.ts's
// `selectLibraryNode`). A hand-edited/corrupt doc naming kind:"worksheet"
// degrades to null like any other unrecognized kind.
const LIBRARY_SELECTION_KINDS: ReadonlySet<LibrarySelection["kind"]> = new Set([
  "folder",
  "workbook",
  "origin-figure",
  "editable-figure",
  "publication-figure",
  "page",
  "report",
]);

/** One live-id set per `LibrarySelection.kind`, so the id gets checked
 *  against the RIGHT collection (a "workbook" selection validated against
 *  folder ids would let a dangling workbook ref through). */
export type LibrarySelectionLiveIds = Record<LibrarySelection["kind"], ReadonlySet<string>>;

/** Build `LibrarySelectionLiveIds` from the same sanitized collections
 *  `parseWorkspace` already computed for the rest of the doc — one place to
 *  extend if a new selectable kind is ever added. `folders` must be the
 *  doc's FINAL, post-workbook-migration set (`migration.folders`, not the
 *  pre-migration one), same as everywhere else a "live folder" is meant. */
export function librarySelectionLiveIds(src: {
  folders: readonly { id: string }[];
  workbooks: readonly { id: string }[];
  originFigures: readonly { id: string }[];
  editableFigures: readonly { id: string }[];
  figureDocs: readonly { id: string }[];
  pages: readonly { id: string }[];
  reports: readonly { id: string }[];
}): LibrarySelectionLiveIds {
  return {
    folder: new Set(src.folders.map((x) => x.id)),
    workbook: new Set(src.workbooks.map((x) => x.id)),
    "origin-figure": new Set(src.originFigures.map((x) => x.id)),
    "editable-figure": new Set(src.editableFigures.map((x) => x.id)),
    "publication-figure": new Set(src.figureDocs.map((x) => x.id)),
    page: new Set(src.pages.map((x) => x.id)),
    report: new Set(src.reports.map((x) => x.id)),
  };
}

/** Validate the persisted Library tree "current" selection. A malformed
 *  kind/id, OR a well-formed id that names no LIVE entity of that kind (a
 *  dangling folder/workbook/figure/page/report ref — e.g. a hand-edited
 *  doc, or one pruned since save), degrades to null rather than throwing —
 *  the same discipline `workbookLastChild`/`expandedWorkbookIds` below and
 *  history.ts's `restorePatch` alive-id checks already use; a dangling id
 *  left in place would otherwise feed straight into import targeting
 *  (`resolveImportTargetFolderId`) or an open action. Also enforces the
 *  L0.25 mutual-exclusion invariant AT PARSE TIME: a restored `selectedIds`
 *  that came back non-empty always wins, mirroring `setLibrarySelection`'s
 *  own runtime chokepoint (store/libraryPanel.ts). */
export function parseLibrarySelection(
  v: unknown,
  selectedIds: readonly string[],
  liveIds: LibrarySelectionLiveIds,
): LibrarySelection | null {
  if (selectedIds.length > 0) return null;
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.kind !== "string" || !LIBRARY_SELECTION_KINDS.has(o.kind as LibrarySelection["kind"])) {
    return null;
  }
  const kind = o.kind as LibrarySelection["kind"];
  if (typeof o.id !== "string" || !o.id || !liveIds[kind].has(o.id)) return null;
  return { kind, id: o.id };
}

/** Validate the persisted L0.6 remembered-child map: workbook id -> the
 *  last-opened child's LibraryNodeKey. Keeps only entries whose KEY names a
 *  workbook that survived load; the VALUE degrades no further than "is it a
 *  string" (workspace.ts's own degrade-never-throw discipline) — a stale
 *  target just fails to reopen anything useful next time, it can't corrupt
 *  the tree. */
export function parseWorkbookLastChild(
  v: unknown,
  workbookIds: ReadonlySet<string>,
): Record<string, string> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<string, string> = {};
  for (const [id, child] of Object.entries(v as Record<string, unknown>)) {
    if (workbookIds.has(id) && typeof child === "string" && child) out[id] = child;
  }
  return out;
}
