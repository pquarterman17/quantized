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
    techniqueViewMemory: {},
    history: [],
    future: [],
    status: "",
  });
});

describe("quickPlotDataset (PR F)", () => {
  it("creates a NEW live editable figure, records ONE history entry, and opens it, returning true", () => {
    const before = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;
    const result = useApp.getState().quickPlotDataset("d1");
    expect(result).toBe(true);

    const { editableFigures, history, plotWindows } = useApp.getState();
    expect(editableFigures).toHaveLength(before + 1);
    const doc = editableFigures[editableFigures.length - 1];
    expect(doc.name).toBe("Quick Plot — d1.dat");
    expect(doc.data.mode).toBe("live");
    expect(doc.bindings.datasetId).toBe("d1");
    // Review fix #4: the WHOLE gesture (window + document + attach + focus)
    // is ONE undo entry -- createWindow's own recordHistory is the only one.
    expect(history.length).toBe(historyBefore + 1);

    // opened: a plot window now shows this exact document.
    const opened = plotWindows.find((w) => w.kind === "plot" && w.document?.id === doc.id);
    expect(opened).toBeDefined();
  });

  // Review fix #4 (red-first): the OLD code called its OWN recordHistory("quick
  // plot") before delegating to openEditableFigure, whose internal createWindow
  // ALSO calls recordHistory -- two stack entries for one gesture. Popping just
  // the top ("create window") left the just-created FigureDocument stranded in
  // editableFigures with no window showing it. ONE undo must remove BOTH.
  it("ONE undo after quickPlotDataset removes the figure document AND the window entirely (fix #4)", () => {
    const windowsBefore = useApp.getState().plotWindows.length;
    const figuresBefore = useApp.getState().editableFigures.length;
    useApp.getState().quickPlotDataset("d1");
    expect(useApp.getState().editableFigures.length).toBe(figuresBefore + 1);
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore + 1);

    useApp.getState().undo();

    expect(useApp.getState().editableFigures.length).toBe(figuresBefore);
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore);
  });

  // Review fix #5: repeated Quick Plots on the same dataset must not mint
  // identical figure names -- dedupe like the window-title convention
  // (lib/plotview.ts's dedupeWindowTitle: "X", "X (2)", "X (3)", ...).
  it("never replaces an existing figure — running it twice yields TWO documents with distinct ids AND distinct names", () => {
    useApp.getState().quickPlotDataset("d1");
    useApp.getState().quickPlotDataset("d1");
    const { editableFigures } = useApp.getState();
    expect(editableFigures).toHaveLength(2);
    expect(editableFigures[0].id).not.toBe(editableFigures[1].id);
    expect(editableFigures.map((d) => d.name)).toEqual([
      "Quick Plot — d1.dat",
      "Quick Plot — d1.dat (2)",
    ]);
    expect(editableFigures.every((doc) => doc.bindings.datasetId === "d1")).toBe(true);
  });

  it("is a fail-closed no-op on an unrecognized (generic) dataset — no document added, no history recorded, returns false", () => {
    useApp.setState({ datasets: [dataset("d1", "generic")] });
    const before = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;
    const result = useApp.getState().quickPlotDataset("d1");
    expect(result).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().history).toHaveLength(historyBefore);
    expect(useApp.getState().status).toContain("Quick Plot unavailable");
  });

  it("is a fail-closed no-op when the dataset id does not exist, returns false", () => {
    const before = useApp.getState().editableFigures.length;
    const result = useApp.getState().quickPlotDataset("does-not-exist");
    expect(result).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(before);
    expect(useApp.getState().status).toContain("Quick Plot unavailable");
  });

  // Review fix #8: a remembered per-technique view (techniqueViewMemory)
  // threads through to the seeded figure's view, just like a silent
  // dataset switch would apply it.
  it("threads the store's techniqueViewMemory into the seeded view (fix #8)", () => {
    useApp.setState({
      techniqueViewMemory: {
        "magnetometry.mvsh": {
          xKey: null,
          yKeys: [1],
          yScale: "log",
          xScale: "linear",
          seriesStyles: {},
          seriesLabels: {},
          seriesOrder: null,
          errKeys: {},
          hiddenChannels: [],
          labels: {},
        },
      },
    });
    useApp.getState().quickPlotDataset("d1");
    const doc = useApp.getState().editableFigures[0];
    expect(doc.plot.view.yScale).toBe("log");
  });
});
