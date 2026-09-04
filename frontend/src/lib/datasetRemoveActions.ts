// "Remove" — the dataset context-action registry's delete entries (see
// lib/contextActions.ts's own header for the generic registry engine these
// plug into). Split out to fund P3.7's "Delete permanently…" bypass within
// the .ts 500-line ceiling (architecture.test.ts) — contextActions.ts was
// already at it. A cohesive extraction (one theme: removing a dataset),
// not a workaround.

import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import type { ContextAction, DatasetActionTarget } from "./contextActions";
import { multiSelected } from "./multiSelected";

export const datasetRemoveActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.remove",
    label: "Remove",
    destructive: true,
    confirm: (t) => ({ title: `Remove "${t.dataset.name}"?`, confirmLabel: "Remove" }),
    run: (t) => {
      useApp.getState().removeDataset(t.dataset.id);
      toast(`removed ${t.dataset.name}`);
    },
  },
  {
    id: "dataset.removeSelected",
    label: (t) => `Remove ${t.selectedIds.length} selected`,
    hidden: (t) => !multiSelected(t),
    destructive: true,
    confirm: (t) => ({ title: `Remove ${t.selectedIds.length} datasets?`, confirmLabel: "Remove" }),
    run: (t) => {
      const n = t.selectedIds.length;
      useApp.getState().removeSelected();
      toast(`removed ${n} datasets`);
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
