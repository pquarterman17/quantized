// The Library folder row's context-menu item list — extracted out of
// FolderRow.tsx the same way `datasetRowMenu.ts` was. GUI_INTERACTION #8's
// folder registry (below, on `lib/contextActions.ts`'s engine) owns every
// FIXED item's label/gating/run; this file supplies the target-object plumbing
// (`FolderActionTarget`) plus the one genuinely dynamic block, mirroring
// `datasetRowMenu.ts`'s own per-folder "Move to …" list: the menu-path
// equivalent of dragging this folder's header onto another one
// (GUI_INTERACTION #3 sub-item 4 — folder reorder had no non-mouse path
// before this).

import { buildMenuItems, type ContextAction, type MenuEntry } from "../../lib/contextActions";
import { isSelfOrDescendant } from "../../lib/foldertree";
import { TEMPLATES_KEY } from "../../lib/templateKey";
import type { Dataset, FolderNode } from "../../lib/types";
import { toast } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem } from "../overlays/ContextMenu";

// The folder registry below moved here verbatim from lib/contextActions.ts
// (bundle diet slice 12, plans/BUNDLE_HEADROOM.md). Its consumers — this
// builder and `LibraryTree.tsx`'s Delete-key routing — sit in the lazy
// Library-tree chunk, so it now loads with the tree that renders folder rows
// instead of riding in the entry chunk. The generic engine (`buildMenuItems`,
// `runContextAction`, the `ContextAction` shape) stays in lib/contextActions.ts.

// folderOps (and the pipeline runner + template libs it pulls in) load on
// the click, not at launch: every use is inside a `run` (bundle-size ratchet).
const folderOps = () => import("./folderOps");

/** Whether any analysis template is saved, WITHOUT importing lib/template.ts,
 *  whose parser (and P2.5's transformation-recipe fields) stays in the lazy
 *  chunk. It counts stored records, not readable ones; `runTemplateOnFolder`
 *  re-reads them and does nothing when none parse (bundle-size ratchet).
 *  The key itself comes from lib/templateKey.ts (finding #10), not a
 *  duplicated literal — that module is template.ts's own source for it. */
function hasSavedTemplates(): boolean {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? "[]");
    return Array.isArray(v) && v.length > 0;
  } catch {
    return false;
  }
}

// ── folder registry ─────────────────────────────────────────────────────

export interface FolderActionTarget {
  folder: FolderNode;
  count: number;
  /** Local UI: open this row's own inline rename input / reveal a new child. */
  onRename: () => void;
  onExpand: () => void;
}

function activeDataset(): Dataset | undefined {
  const s = useApp.getState();
  return s.datasets.find((d) => d.id === s.activeId);
}

// GUI_INTERACTION #3 sub-item 4: split into named groups (mirroring the
// dataset registry's own `datasetCoreActions`/`datasetMoveActions`/…) so
// `folderRowMenu.ts` can splice the genuinely-dynamic per-folder "Move to …"
// list (one entry per LIVE folder, same reason the dataset one can't be a
// fixed registry entry) between the core and bulk-ops groups — the same
// slot the drag-onto-another-folder-header gesture's menu equivalent
// belongs in. `folderActions` below is still the flat concatenation (with
// separators) for a caller that wants "every folder action" without caring
// about layout.
export const folderCoreActions: ContextAction<FolderActionTarget>[] = [
  {
    id: "folder.newSubfolder",
    label: "New subfolder",
    run: (t) => {
      useApp.getState().createFolder(t.folder.id, "New Folder");
      t.onExpand();
    },
  },
  { id: "folder.rename", label: "Rename…", run: (t) => t.onRename() },
  { id: "folder.properties", label: "Properties…", run: (t) => void folderOps().then((m) => m.openFolderProperties(t.folder)) },
];

// ── bulk ops over the whole subtree (project-organization plan item 8) ──
export const folderBulkActions: ContextAction<FolderActionTarget>[] = [
  {
    id: "folder.selectAll",
    label: (t) => `Select all in folder (${t.count})`,
    enabled: (t) => t.count > 0,
    run: (t) => void folderOps().then((m) => m.selectFolderContents(t.folder)),
  },
  {
    id: "folder.exportCsv",
    label: "Export folder as consolidated CSV",
    enabled: (t) => t.count > 0,
    run: (t) => void folderOps().then((m) => m.exportFolderCsv(t.folder)),
  },
  {
    id: "folder.applyActiveCorrections",
    label: (t) => `Apply active corrections to folder (${t.count})`,
    hidden: (t) => t.count === 0 || !activeDataset()?.corrections,
    run: (t) => void folderOps().then((m) => m.applyActiveCorrectionsToFolder(t.folder)),
  },
  {
    id: "folder.runTemplate",
    label: "Run analysis template on folder…",
    hidden: (t) => t.count === 0 || !hasSavedTemplates(),
    run: (t) => void folderOps().then((m) => m.runTemplateOnFolder(t.folder)),
  },
];

export const folderDeleteActions: ContextAction<FolderActionTarget>[] = [
  {
    id: "folder.delete",
    label: "Delete folder",
    destructive: true,
    confirm: (t) => ({ title: `Delete folder "${t.folder.name}"?`, confirmLabel: "Delete" }),
    run: (t) => {
      useApp.getState().deleteFolder(t.folder.id); // reparent: contents move up, datasets survive
      toast(`deleted folder "${t.folder.name}"`);
    },
  },
  {
    id: "folder.deleteWithDatasets",
    label: (t) => `Delete folder + ${t.count} dataset(s)`,
    hidden: (t) => t.count === 0,
    destructive: true,
    confirm: (t) => ({
      title: `Delete "${t.folder.name}" and its ${t.count} dataset(s)?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
    }),
    run: (t) => void folderOps().then((m) => m.removeFolderWithDatasets(t.folder)),
  },
];

/** Every folder action, flat — for callers that don't care about layout. */
export const folderActions: MenuEntry<FolderActionTarget>[] = [
  ...folderCoreActions,
  { separator: true },
  ...folderBulkActions,
  { separator: true },
  ...folderDeleteActions,
];

// ── the folder row's menu ──────────────────────────────────────────────

export function buildFolderRowMenu(
  folder: FolderNode,
  count: number,
  onRename: () => void,
  onExpand: () => void,
  onFocus?: () => void,
): ContextMenuItem[] {
  const target: FolderActionTarget = { folder, count, onRename, onExpand };
  const { folders, moveFolder } = useApp.getState();

  // Move this folder under another one, or back to the top level — the
  // click path for the SAME reparent/reposition the folder-onto-folder drag
  // performs (FolderRow's 3-zone onDrop). Excludes the folder itself and any
  // of its own descendants (moveFolder's own cycle guard already rejects
  // those; hiding them here keeps the menu honest about what it actually
  // offers, matching datasetRowMenu's disabled-when-already-there rule).
  const candidates = folders.filter(
    (f) => f.id !== folder.id && !isSelfOrDescendant(folders, folder.id, f.id),
  );
  const moveItems: ContextMenuItem[] = [
    ...candidates.map(
      (f): ContextMenuItem => ({
        label: `Move to "${f.name}"`,
        run: () => moveFolder(folder.id, f.id),
        disabled: folder.parentId === f.id,
      }),
    ),
    ...(folder.parentId !== null
      ? [{ label: "Move to top level", run: () => moveFolder(folder.id, null) } as ContextMenuItem]
      : []),
  ];

  return [
    ...(onFocus ? [{ label: "Focus on this folder", run: onFocus } as ContextMenuItem, { separator: true } as ContextMenuItem] : []),
    ...buildMenuItems(folderCoreActions, target),
    ...(moveItems.length ? [{ separator: true } as ContextMenuItem, ...moveItems] : []),
    { separator: true },
    ...buildMenuItems(folderBulkActions, target),
    { separator: true },
    ...buildMenuItems(folderDeleteActions, target),
  ];
}
