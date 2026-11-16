// UX-C: Undo on a removal toast really restores — everything the removal
// pruned (selection, figure bindings, plot windows), not just the dataset row —
// and refuses once another edit has been recorded since.

import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import type { Dataset } from "./types";
import { requestDatasetRemoval } from "./datasetRemoval";
import { datasetRemoveActions } from "./datasetRemoveActions";

const mk = (id: string): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: [""], metadata: {} },
});

// The removal toast loads lazily: wait on the toast STATE appearing.
async function undoToast() {
  await waitFor(() => expect(useToasts.getState().toasts.some((x) => x.action?.label === "Undo")).toBe(true));
  return useToasts.getState().toasts.find((x) => x.action?.label === "Undo")!;
}

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [mk("a"), mk("b")], activeId: "a", selectedIds: ["a"], worksheetId: null,
    history: [], future: [], trash: [], confirmRemove: false,
    figureDocs: [{ id: "f1", name: "Fig", datasetId: "a" } as never],
  });
});

describe("Undo toast after removing a dataset", () => {
  it("restores the dataset, the selection and the figure binding it had", async () => {
    requestDatasetRemoval(["a"]);
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["b"]);
    expect(useApp.getState().figureDocs[0].datasetId).toBeNull(); // pruned by the removal
    (await undoToast()).action!.onClick();
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["a", "b"]);
    expect(s.activeId).toBe("a");
    expect(s.selectedIds).toEqual(["a"]);
    expect(s.figureDocs[0].datasetId).toBe("a");
    expect(s.status).toBe("Undid remove datasets");
  });

  it("the context-menu Remove offers the same Undo", async () => {
    const remove = datasetRemoveActions.find((a) => a.id === "dataset.remove")!;
    remove.run({ dataset: mk("a") } as never);
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["b"]);
    (await undoToast()).action!.onClick();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("refuses, and reverts nothing, once another edit was recorded since", async () => {
    requestDatasetRemoval(["a"]);
    const toast = await undoToast();
    useApp.getState().renameDataset("b", "renamed");
    toast.action!.onClick();
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["b"]); // removal NOT undone
    expect(s.datasets[0].name).toBe("renamed"); // and the newer rename NOT reverted
    expect(useToasts.getState().toasts.some((t) => /Can't undo/.test(t.msg))).toBe(true);
  });

  it("Remove all (clearAll) can be undone from its toast", async () => {
    useApp.getState().clearAll();
    expect(useApp.getState().datasets).toHaveLength(0);
    const { toastWithUndo, historyTop } = await import("./undoToast");
    toastWithUndo("removed all datasets", "ok", historyTop());
    (await undoToast()).action!.onClick();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["a", "b"]);
  });
});
