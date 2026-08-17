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

/** Validate the persisted Library tree "current" selection. A malformed
 *  kind/id degrades to null rather than throwing. Also enforces the L0.25
 *  mutual-exclusion invariant AT PARSE TIME: a restored `selectedIds` that
 *  came back non-empty always wins, mirroring `setLibrarySelection`'s own
 *  runtime chokepoint (store/libraryPanel.ts). */
export function parseLibrarySelection(
  v: unknown,
  selectedIds: readonly string[],
): LibrarySelection | null {
  if (selectedIds.length > 0) return null;
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.kind !== "string" || !LIBRARY_SELECTION_KINDS.has(o.kind as LibrarySelection["kind"])) {
    return null;
  }
  if (typeof o.id !== "string" || !o.id) return null;
  return { kind: o.kind as LibrarySelection["kind"], id: o.id };
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
