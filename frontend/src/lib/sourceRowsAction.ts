// "Go to Source rows" as a dataset context action (ROW_RANGE_CONTRACT section 4): the Library row menu and the
// command palette's active-dataset entries both build from the dataset registry, so one definition serves both. The
// worksheet's own cell and row menus keep their entry (`components/Stage/worksheet/subsetMenu.ts`); the action body
// is the same lazy `goToSourceRows`, which says why it selected nothing (no link, source deleted or loading, every
// linked row deleted).
//
// Hidden unless the worksheet records a row link. Present-but-disabled when the source worksheet is gone, with the
// reason, so a subset of a deleted source is not silently missing the entry.

import { onLoadFailure, runLazy } from "./runLazy";
import { sourceLinkId } from "./sourceRowLink";
import type { ContextAction, DatasetActionTarget } from "./contextActions";
import { useApp } from "../store/useApp";

const sourceOf = (t: DatasetActionTarget) => {
  const id = sourceLinkId(t.dataset.data.metadata);
  return id ? useApp.getState().datasets.find((d) => d.id === id) ?? null : null;
};

export const datasetSourceRowsActions: ContextAction<DatasetActionTarget>[] = [
  {
    id: "dataset.goToSourceRows",
    label: (t) => {
      const source = sourceOf(t);
      return source ? `Go to Source rows (${source.name})` : "Go to Source rows (source deleted)";
    },
    hidden: (t) => sourceLinkId(t.dataset.data.metadata) === null,
    enabled: (t) => sourceOf(t) !== null,
    disabledReason: () => "the worksheet these rows were extracted from no longer exists",
    run: (t) => void runLazy("Opening the source…", () => import("../store/sourceRowLink")).then((m) => m.goToSourceRows(t.dataset.id), onLoadFailure),
  },
];
