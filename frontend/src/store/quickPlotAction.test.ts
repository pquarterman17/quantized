import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

function dataset(id: string, technique = "magnetometry.mvsh"): Dataset {
  return {
    id,
    name: `${id}.dat`,
    data: {
      time: [0, 1, 2],
      values: [[1, 10], [2, 20], [3, 30]],
      labels: ["A", "B"],
      units: ["", ""],
      metadata: { technique },
    },
  };
}

beforeEach(() => {
  useApp.setState({
    datasets: [dataset("d1")],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    history: [],
    future: [],
    status: "",
  });
});

describe("quickPlotDataset (PR F)", () => {
  it("creates a NEW live editable figure, records history once, and opens it", () => {
    const before = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;
    useApp.getState().quickPlotDataset("d1");

    const { editableFigures, history, plotWindows } = useApp.getState();
    expect(editableFigures).toHaveLength(before + 1);
    const doc = editableFigures[editableFigures.length - 1];
    expect(doc.name).toBe("Quick Plot — d1.dat");
    expect(doc.data.mode).toBe("live");
    expect(doc.bindings.datasetId).toBe("d1");
    // quickPlotDataset's own body calls recordHistory exactly once ("quick
    // plot"); openEditableFigure's createWindow (store/windows.ts) records
    // its own "create window" entry as it always does when it opens a
    // document into a fresh window -- that is openEditableFigure's existing,
    // independent undo contract, not something Quick Plot suppresses.
    expect(history.length).toBe(historyBefore + 2);
    expect(history.map((h) => h.label)).toEqual(
      expect.arrayContaining(["quick plot", "create window"]),
    );

    // opened: a plot window now shows this exact document.
    const opened = plotWindows.find((w) => w.kind === "plot" && w.document?.id === doc.id);
    expect(opened).toBeDefined();
  });

  it("never replaces an existing figure — running it twice yields TWO documents with distinct ids", () => {
    useApp.getState().quickPlotDataset("d1");
    useApp.getState().quickPlotDataset("d1");
    const { editableFigures } = useApp.getState();
    expect(editableFigures).toHaveLength(2);
    expect(editableFigures[0].id).not.toBe(editableFigures[1].id);
    expect(editableFigures.every((doc) => doc.bindings.datasetId === "d1")).toBe(true);
  });

  it("is a fail-closed no-op on an unrecognized (generic) dataset — no document added, no history recorded", () => {
    useApp.setState({ datasets: [dataset("d1", "generic")] });
    const before = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;
    useApp.getState().quickPlotDataset("d1");
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().history).toHaveLength(historyBefore);
    expect(useApp.getState().status).toContain("Quick Plot unavailable");
  });

  it("is a fail-closed no-op when the dataset id does not exist", () => {
    const before = useApp.getState().editableFigures.length;
    useApp.getState().quickPlotDataset("does-not-exist");
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().status).toContain("Quick Plot unavailable");
  });
});
