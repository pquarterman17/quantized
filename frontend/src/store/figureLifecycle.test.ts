import { beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import { editableFigureDirty } from "./figureLifecycle";
import { useApp } from "./useApp";

const document = () => createFigureDocument({
  id: "figure-w1",
  name: "Current plot",
  datasetId: "d1",
  view: defaultPlotView(),
  publication: { overrides: { font_size: 10 }, seriesStyles: [{ color: "#123456" }] },
});

const window = (): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "Current plot",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 600, h: 400 },
  z: 1,
  winState: "maximized",
  view: defaultPlotView(),
  document: document(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
});

beforeEach(() => {
  useApp.setState({
    datasets: [{
      id: "d1",
      name: "Data",
      data: { time: [0, 1], values: [[2, 3]], labels: ["Y"], units: [""], metadata: {} },
    }],
    activeId: "d1",
    selectedIds: ["d1"],
    plotWindows: [window()],
    focusedWindowId: "w1",
    editableFigures: [],
    history: [],
    future: [],
    ...defaultPlotView(),
  });
});

describe("editable figure lifecycle", () => {
  it("saves the focused live facade and reports later changes as dirty", () => {
    expect(editableFigureDirty(useApp.getState(), window())).toBe(true);
    expect(useApp.getState().saveFigure("w1")).toBe("figure-w1");
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(editableFigureDirty(useApp.getState(), useApp.getState().plotWindows[0])).toBe(false);

    useApp.setState({ plotTitle: "Changed since save" });
    expect(editableFigureDirty(useApp.getState(), useApp.getState().plotWindows[0])).toBe(true);
    useApp.getState().saveFigure("w1");
    expect(useApp.getState().editableFigures[0].plot.view.plotTitle).toBe("Changed since save");
  });

  it("Save As assigns a new identity and updates the open window", () => {
    const id = useApp.getState().saveFigureAs("w1", "Analysis copy");
    expect(id).not.toBe("figure-w1");
    expect(useApp.getState().editableFigures[0]).toMatchObject({ id, name: "Analysis copy" });
    expect(useApp.getState().plotWindows[0]).toMatchObject({ title: "Analysis copy", document: { id } });
  });

  it("reopens, renames, duplicates, and undo-restores a deleted document", () => {
    useApp.getState().saveFigure("w1");
    useApp.getState().renameEditableFigure("figure-w1", "Renamed");
    const copyId = useApp.getState().duplicateEditableFigure("figure-w1");
    expect(useApp.getState().editableFigures.map((entry) => entry.name)).toEqual(["Renamed", "Renamed copy"]);
    const [source, copy] = useApp.getState().editableFigures;
    expect(copy.publication).toEqual(source.publication);
    expect(copy.publication).not.toBe(source.publication);

    useApp.getState().deleteEditableFigure(copyId!);
    expect(useApp.getState().editableFigures).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().editableFigures).toHaveLength(2);

    useApp.getState().closeWindow("w1"); // last plot is protected, so create an independent reopen target
    useApp.setState({ plotWindows: [], focusedWindowId: null });
    const opened = useApp.getState().openEditableFigure("figure-w1");
    expect(opened).toBeTruthy();
    expect(useApp.getState().plotWindows.find((entry) => entry.id === opened)?.document?.id).toBe("figure-w1");
  });
});
