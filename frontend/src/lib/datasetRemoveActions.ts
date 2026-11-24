// "Remove" — the dataset context-action registry's delete entries (see
// lib/contextActions.ts's own header for the generic registry engine these
// plug into). Split out to fund P3.7's "Delete permanently…" bypass within
// the .ts 500-line ceiling (architecture.test.ts) — contextActions.ts was
// already at it. A cohesive extraction (one theme: removing a dataset),
// not a workaround.

import { toast } from "../store/toasts";
import { toastRemoved } from "./datasetRemoval";
import { removeDatasetsPruningCollapsed } from "../store/collapsedWorkbookActions";
import { useApp } from "../store/useApp";
import type { ContextAction, DatasetActionTarget } from "./contextActions";
import { multiSelected } from "./multiSelected";

export const datasetRemoveActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.remove",
    // M8 (UX menus audit, provisional, owner to confirm): ONE vocabulary across
    // the Library menus. "Move to trash" is the reversible everyday action
    // (File > Project > Trash restores it); "Delete permanently…" is not.
    label: "Move to trash",
    destructive: true,
    confirm: (t) => ({ title: `Move "${t.dataset.name}" to the trash?`, confirmLabel: "Move to trash" }),
    run: (t) => {
      const since = useApp.getState().history.at(-1)?.seq;
      useApp.getState().removeDataset(t.dataset.id);
      toastRemoved(`moved ${t.dataset.name} to the trash`, since);
    },
  },
  {
    id: "dataset.removeSelected",
    label: (t) => `Move ${t.selectedIds.length} datasets to trash`,
    hidden: (t) => !multiSelected(t),
    destructive: true,
    confirm: (t) => ({ title: `Move ${t.selectedIds.length} datasets to the trash?`, confirmLabel: "Move to trash" }),
    run: (t) => {
      const n = t.selectedIds.length;
      const since = useApp.getState().history.at(-1)?.seq;
      const st = useApp.getState();
      const ids = st.selectedIds.length ? st.selectedIds : st.activeId ? [st.activeId] : [];
      removeDatasetsPruningCollapsed(ids); // collapsed single-sheet rows take their workbook with them
      const activeId = useApp.getState().activeId;
      useApp.setState({ selectedIds: activeId ? [activeId] : [] });
      toastRemoved(`moved ${n} datasets to the trash`, since);
    },
  },
  // P3.7: the explicit, warned Trash BYPASS — "Remove" above stays the
  // everyday, recoverable action.
  {
    id: "dataset.deletePermanently",
    label: "Delete permanently…",
    destructive: true,
    confirm: (t) => ({
      title: `Permanently delete "${t.dataset.name}"?`,
      message: "This bypasses the trash — it cannot be undone.",
      confirmLabel: "Delete permanently",
    }),
    run: (t) => {
      useApp.getState().removeDatasets([t.dataset.id], { permanent: true });
      toast(`permanently deleted ${t.dataset.name}`, "danger");
    },
  },
];
