// UX8-A in the store: the first plot is picked once at import
// (`withFirstPlot` -> `metadata.first_plot`), reaches the view through
// `datasetViewDefaults` (import, rebind), and the import toast says what it
// chose with a one-click way back (`presentFirstPlot`).
import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView } from "../lib/plotview";
import { captureTechniqueView } from "../lib/techniqueViewMemory";
import type { Dataset, DataStruct } from "../lib/types";
import { presentFirstPlot, withFirstPlot } from "./firstPlotNotice";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";
import { datasetViewDefaults } from "./windowDefaults";

const N = 120;
const field = Array.from({ length: N }, (_, i) => 70000 - (140000 * i) / (N - 1));
function data(cols: { name: string; unit: string; v: (i: number) => number }[], x = field, xName = "Field", xUnit = "Oe"): DataStruct {
  return {
    time: x,
    values: x.map((_, r) => cols.map((c) => c.v(r))),
    labels: cols.map((c) => c.name),
    units: cols.map((c) => c.unit),
    metadata: { x_column_name: xName, x_column_unit: xUnit, technique: "generic" },
  };
}
const VSM: Dataset = withFirstPlot({
  id: "mh",
  name: "MH_300K.txt",
  data: data([
    { name: "Moment", unit: "emu", v: (i) => 1.3e-3 * Math.tanh(field[i] / 2000) },
    { name: "Temperature", unit: "K", v: (i) => 300 + 0.05 * Math.sin(i) },
  ]),
});
const q = Array.from({ length: N }, (_, i) => 0.01 + (0.29 * i) / (N - 1));
const XRR: Dataset = withFirstPlot({ id: "xrr", name: "XRR.dat", data: data([{ name: "R", unit: "", v: (i) => Math.min(1, 2e-8 / q[i] ** 4) }], q, "Qz", "1/A") });
const xs: number[] = [];
const ys: number[] = [];
for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) [xs[xs.length], ys[ys.length]] = [i, j];
const MAP: Dataset = withFirstPlot({
  id: "map",
  name: "map_xyz.csv",
  data: data([{ name: "y", unit: "mm", v: (k) => ys[k] }, { name: "signal", unit: "V", v: (k) => Math.sin(xs[k]) + ys[k] }], xs, "x", "mm"),
});

beforeEach(() => {
  useApp.setState({
    datasets: [], activeId: null, plotWindows: [], focusedWindowId: null, history: [], future: [],
    hiddenChannels: [], errKeys: {}, yKeys: null, y2Keys: null, yScale: "linear", stageTab: "plot", techniqueViewMemory: {},
  });
  useToasts.setState({ toasts: [] });
});

describe("datasetViewDefaults applies the first plot", () => {
  it("M(H): Moment only, Temperature left off", () => {
    expect(datasetViewDefaults(VSM)).toMatchObject({ yKeys: [0], y2Keys: null });
  });

  it("log Y follows the pick both ways; a manual log on unpicked data survives a switch", () => {
    expect(datasetViewDefaults(XRR).yScale).toBe("log");
    expect(datasetViewDefaults(XRR, VSM).yScale).toBe("log"); // generic -> generic too
    expect(datasetViewDefaults(VSM, XRR).yScale).toBe("linear"); // leaving a picked log
    const plain: Dataset = { ...VSM, data: { ...VSM.data, metadata: {} } };
    expect(datasetViewDefaults(plain, plain).yScale).toBeUndefined(); // the scale is kept
  });

  it("the window an untouched switch left is not 'user-edited' (viewHasUserEdits' plain view agrees)", () => {
    const plain = datasetViewDefaults(XRR);
    expect(datasetViewDefaults(XRR, VSM)).toMatchObject({ yScale: plain.yScale, yKeys: plain.yKeys, y2Keys: plain.y2Keys });
  });

  it("a pick made for other columns is ignored (a column edit, a derived dataset)", () => {
    const edited: Dataset = { ...VSM, data: { ...VSM.data, labels: ["New", "Moment"], units: ["", "emu"] } };
    expect(datasetViewDefaults(edited).yKeys).toBeNull();
  });

  it("withFirstPlot stores only what changes", () => {
    expect(VSM.data.metadata.first_plot).toEqual({ of: ["Moment", "Temperature"], y: [0] });
    expect(XRR.data.metadata.first_plot).toEqual({ of: ["R"], log: expect.any(Number) });
  });

  it("an Origin book gets the heuristics too, capped so a wide worksheet never plots every column", () => {
    const cols = Array.from({ length: 24 }, (_, c) => ({ name: `C${c}`, unit: "", v: (i: number) => (c + 1) * Math.sin(i / 7 + c) }));
    const md = { origin_book: "Book1" };
    const wide = data(cols, field, "Field", "Oe");
    const book = withFirstPlot({ id: "ob", name: "Book1", data: { ...wide, metadata: { ...wide.metadata, ...md } } });
    expect(book.data.metadata.first_plot).toEqual({ of: wide.labels, y: [0, 1, 2, 3, 4, 5, 6, 7] });
    expect(datasetViewDefaults(book).yKeys).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // ...and monitor columns are left off like any import.
    const vsm = withFirstPlot({ ...VSM, data: { ...VSM.data, metadata: { ...VSM.data.metadata, ...md } } });
    expect(datasetViewDefaults(vsm).yKeys).toEqual([0]);
    // A non-Origin file of the same width is not capped.
    const plain = withFirstPlot({ id: "p", name: "p.csv", data: wide });
    expect(plain.data.metadata.first_plot).toBeUndefined();
  });

  it("a copy with the same labels whose Y went <= 0 does not inherit log Y", () => {
    const subtracted: Dataset = { ...XRR, data: { ...XRR.data, values: XRR.data.values.map((r) => r.map((v) => v - 1e-3)) } };
    expect(datasetViewDefaults(XRR).yScale).toBe("log");
    expect(datasetViewDefaults(subtracted).yScale).not.toBe("log");
  });

  it("a malformed or out-of-range stored pick (a hand-edited .dwk) is ignored", () => {
    const of = VSM.data.labels;
    const bad = (fp: unknown): Dataset => ({ ...VSM, data: { ...VSM.data, metadata: { ...VSM.data.metadata, first_plot: fp } } });
    expect(datasetViewDefaults(bad({ of, y: [5] })).yKeys).toBeNull();
    expect(datasetViewDefaults(bad({ of, y: [-1] })).yKeys).toBeNull();
    expect(datasetViewDefaults(bad({ of, y: [] })).yKeys).toBeNull();
    expect(datasetViewDefaults(bad({ of, y: "0", y2: [0.5] })).y2Keys).toBeNull();
    expect(datasetViewDefaults(bad({ y: [0] })).yKeys).toBeNull(); // no labels: not trusted
  });

  it("technique memory wins over the first plot", () => {
    const mag: Dataset = { ...VSM, data: { ...VSM.data, metadata: { ...VSM.data.metadata, technique: "magnetometry.mvsh" } } };
    const memory = captureTechniqueView(mag, { ...defaultPlotView(), yKeys: [0, 1] }, {});
    expect(datasetViewDefaults(mag, undefined, memory).yKeys).toEqual([0, 1]);
  });

  it("an import (addDataset) shows it: the live view carries the picks", () => {
    useApp.getState().addDataset(XRR);
    expect(useApp.getState().yScale).toBe("log");
    useApp.getState().addDataset(VSM);
    expect(useApp.getState()).toMatchObject({ yKeys: [0], yScale: "linear" });
  });
});

describe("presentFirstPlot (the import toast)", () => {
  const last = () => useToasts.getState().toasts.at(-1)!;

  it("says Temperature was left off; Plot all puts it on the right Y axis", async () => {
    useApp.getState().addDataset(VSM);
    expect(await presentFirstPlot(useApp.getState, "imported 1 file", "mh")).toBe(true);
    expect(last().msg).toBe("imported 1 file — Temperature not plotted");
    last().actions!.find((a) => a.label === "Plot all")!.onClick();
    expect(useApp.getState()).toMatchObject({ yKeys: null, y2Keys: [1] });
  });

  it("says log Y and offers Linear Y", async () => {
    useApp.getState().addDataset(XRR);
    await presentFirstPlot(useApp.getState, "imported 1 file", "xrr");
    expect(last().msg).toMatch(/^imported 1 file — log Y \(data spans 5\.\d decades\)$/);
    last().actions!.find((a) => a.label === "Linear Y")!.onClick();
    expect(useApp.getState().yScale).toBe("linear");
  });

  it("opens a gridded x, y, z table as a map, with Line plot one click away", async () => {
    useApp.getState().addDataset(MAP);
    await presentFirstPlot(useApp.getState, "imported 1 file", "map");
    expect(useApp.getState().stageTab).toBe("map");
    expect(last().msg).toBe("imported 1 file — opened as a map");
    last().actions!.find((a) => a.label === "Line plot")!.onClick();
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("nothing to say once the user changed the view, or for a plain file", async () => {
    useApp.getState().addDataset(VSM);
    useApp.getState().setYKeys([0, 1]);
    expect(await presentFirstPlot(useApp.getState, "imported 1 file", "mh")).toBe(false);
    const plain: Dataset = { id: "p", name: "p.csv", data: data([{ name: "Moment", unit: "emu", v: (i) => field[i] * 1e-8 }]) };
    useApp.getState().addDataset(plain);
    expect(await presentFirstPlot(useApp.getState, "imported 1 file", "p")).toBe(false);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("Plot all never crams two left-off units onto one Y2: they join Y1", async () => {
    const wide = withFirstPlot({
      id: "w",
      name: "w.dat",
      data: data([
        { name: "Moment", unit: "emu", v: (i) => 1e-3 * Math.tanh(field[i] / 2000) },
        { name: "Temperature", unit: "K", v: (i) => 300 + 0.01 * i },
        { name: "Chamber", unit: "Torr", v: (i) => 5 + 0.01 * i },
      ]),
    });
    useApp.getState().addDataset(wide);
    await presentFirstPlot(useApp.getState, "imported 1 file", "w");
    expect(last().msg).toBe("imported 1 file — Temperature, Chamber not plotted");
    last().actions!.find((a) => a.label === "Plot all")!.onClick();
    expect(useApp.getState()).toMatchObject({ yKeys: null, y2Keys: null });
  });

  it("a technique-tagged grid (M at fixed H and T setpoints) is not opened as a map", async () => {
    const tagged: Dataset = { ...MAP, id: "t", data: { ...MAP.data, metadata: { ...MAP.data.metadata, technique: "magnetometry.mvsh" } } };
    useApp.getState().addDataset(tagged);
    await presentFirstPlot(useApp.getState, "imported 1 file", "t");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("a unitless table with a repeating third column is not a map (empty units are not a shared unit)", async () => {
    const hx = Array.from({ length: 120 }, (_, i) => (i % 40) * 10);
    const ds: Dataset = withFirstPlot({
      id: "ua",
      name: "HMT.csv",
      data: data([{ name: "M", unit: "", v: (i) => Math.sin(i % 40) }, { name: "T", unit: "", v: (i) => 100 * (1 + Math.floor(i / 40)) }], hx, "H", ""),
    });
    useApp.getState().addDataset(ds);
    await presentFirstPlot(useApp.getState, "imported 1 file", "ua");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("x and y1 must tile themselves: a jittered same-unit readback beside a gridded Y2 is not a map", async () => {
    const hx = Array.from({ length: 120 }, (_, i) => (i % 40) * 10);
    const ds: Dataset = withFirstPlot({
      id: "ub",
      name: "HHT.csv",
      data: data(
        [{ name: "Field_meas", unit: "Oe", v: (i) => (i % 40) * 10 + 0.001 * i * i }, { name: "Temperature", unit: "K", v: (i) => 100 * (1 + Math.floor(i / 40)) }],
        hx, "Field", "Oe",
      ),
    });
    useApp.getState().addDataset(ds);
    await presentFirstPlot(useApp.getState, "imported 1 file", "ub");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("never moves a user off the Worksheet tab", async () => {
    useApp.getState().addDataset(MAP);
    useApp.setState({ stageTab: "worksheet" });
    await presentFirstPlot(useApp.getState, "imported 1 file", "map");
    expect(useApp.getState().stageTab).toBe("worksheet");
  });
});
