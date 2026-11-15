// Origin gap audit 3 #15: an inset graph layer names a column of ANY dataset
// by index. When that dataset's columns shift, every layer reading it follows
// its column — in the focused plot, a background window and a saved figure —
// and a curve whose column was deleted is shown as missing, never moved onto
// the neighbouring column (fail closed).

import { beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument } from "../lib/figureDocument";
import type { InsetLayer } from "../lib/graphLayers";
import { moveByLabel, remapLinkedCurvesByLabel } from "../lib/linkedCurveReimport";
import { layerSourcesPatch } from "../lib/graphLayerRemap";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { editLayers, layersOf, removeLayer } from "./graphLayerEdit";
import { useApp } from "./useApp";
import { plotWindowView } from "./windowDocuments";
import { deleteColumns, insertColumn } from "./worksheetColumns";

const src = (): Dataset => ({
  id: "src",
  name: "Sample B",
  data: { time: [1, 2, 3], values: [[10, 100], [20, 200], [30, 300]], labels: ["H", "M"], units: ["Oe", "emu"], metadata: {} },
});
const main = (): Dataset => ({
  id: "main",
  name: "Sample A",
  data: { time: [1, 2], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});
const inset = (): InsetLayer => ({
  id: "L1", kind: "inset", at: [0.5, 0.1, 0.3, 0.3], mark: "line",
  curves: [{ datasetId: "src", xKey: 0, yKey: 1, label: "" }],
  x: { lim: null, scale: "linear", label: "", step: null },
  y: { lim: null, scale: "linear", label: "", step: null },
});
const st = () => useApp.getState();
const curve = (layers: unknown) => ((layers as InsetLayer[])[0]).curves[0];

beforeEach(() => {
  const bg: PlotWindow = {
    id: "w2", kind: "plot", title: "B", datasetId: "main", geometry: { x: 0, y: 0, w: 300, h: 200 }, z: 1,
    winState: "normal", view: { ...defaultPlotView(), layers: [inset()] }, bg: "theme", linkGroup: null, pinned: false,
  };
  const fig = createFigureDocument({ id: "f1", name: "F", datasetId: "main", view: { ...defaultPlotView(), layers: [inset()] } });
  useApp.setState({
    datasets: [main(), src()], activeId: "main", layers: [inset()], plotWindows: [bg], focusedWindowId: null,
    editableFigures: [fig], history: [], future: [],
  });
});

describe("layer curves follow their source's columns", () => {
  it("a column inserted before the bound ones: every holder follows", () => {
    insertColumn("src", 0);
    expect(curve(st().layers)).toMatchObject({ xKey: 1, yKey: 2 });
    expect(curve(plotWindowView(st().plotWindows[0]).layers)).toMatchObject({ xKey: 1, yKey: 2 });
    expect(curve(st().editableFigures[0].plot.view.layers)).toMatchObject({ xKey: 1, yKey: 2 });
  });

  it("the bound Y column deleted: missing (-1), never the neighbour", () => {
    deleteColumns("src", [1]);
    expect(curve(st().layers)).toMatchObject({ xKey: 0, yKey: -1 });
    expect(curve(plotWindowView(st().plotWindows[0]).layers)).toMatchObject({ yKey: -1 });
  });

  it("a re-import that reorders columns follows by label; a vanished label is missing", () => {
    const io = { view: plotWindowView, sync: (w: PlotWindow, view: PlotWindow["view"]) => ({ ...w, view }) };
    const holders = { layers: [inset()], plotWindows: [], editableFigures: [] };
    const swapped = layerSourcesPatch(holders, "src", moveByLabel(["H", "M"], ["M", "H"]), io);
    expect(curve(swapped.layers)).toMatchObject({ xKey: 1, yKey: 0 });
    const gone = layerSourcesPatch(holders, "src", moveByLabel(["H", "M"], ["H", "T"]), io);
    expect(curve(gone.layers)).toMatchObject({ xKey: 0, yKey: -1 });
    // A layer reading another dataset is left as it is.
    expect(layerSourcesPatch(holders, "other", () => 5, io).layers).toBeUndefined();
    // The linked-graph rule it shares (lib/linkedCurveReimport.ts) is unchanged.
    const graph: Dataset = { ...main(), id: "g", linkedCurves: [{ datasetId: "src", xKey: 0, yKey: 1, label: "" }] };
    expect(remapLinkedCurvesByLabel([graph], "src", ["H", "M"], ["M", "T"])![0].linkedCurves![0]).toMatchObject({ xKey: -1, yKey: 0 });
  });
});

describe("hostile layer shapes from a hand-edited .dwk (review M4)", () => {
  it("a column insert / delete still works, and real curves still follow", () => {
    const junk = [{ id: "a", kind: "inset", curves: {} }, { id: "b", kind: "inset", curves: "x" }, 5, null, inset()];
    useApp.setState({ layers: junk as never });
    expect(() => insertColumn("src", 0)).not.toThrow();
    expect(st().datasets.find((d) => d.id === "src")!.data.labels[1]).toBe("H");
    expect(((st().layers as unknown[])[4] as InsetLayer).curves[0]).toMatchObject({ xKey: 1, yKey: 2 });
    expect(() => deleteColumns("src", [0])).not.toThrow();
  });
});

describe("layer edits are undoable, on the focused plot or a background window", () => {
  it("edit + undo + redo on the live view", () => {
    editLayers((ls) => ls.map((l) => ({ ...l, at: [0, 0, 0.2, 0.2] as InsetLayer["at"] })), "move inset graph");
    expect(layersOf()[0].at).toEqual([0, 0, 0.2, 0.2]);
    st().undo();
    expect(layersOf()[0].at).toEqual([0.5, 0.1, 0.3, 0.3]);
    st().redo();
    expect(layersOf()[0].at).toEqual([0, 0, 0.2, 0.2]);
  });

  it("removing a background window's layer writes that window, undoably", () => {
    removeLayer("L1", "w2");
    expect(layersOf("w2")).toEqual([]);
    expect(layersOf()).toHaveLength(1); // the focused plot's own are untouched
    st().undo();
    expect(layersOf("w2")).toHaveLength(1);
  });
});
