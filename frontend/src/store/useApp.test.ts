import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyCorrections as applyCorrectionsApi,
  fetchBookData,
  guessImportSettings,
  parseImportText,
  uploadFile,
} from "../lib/api";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { defaultErrKeys } from "../lib/errorbars";
import { saveBlob } from "../lib/download";
import { effectiveChannels } from "../lib/plotdata";
import type { FrozenPlotBundle } from "../lib/plotsnapshot";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset, DataStruct } from "../lib/types";
import type { LoadedWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
}));

vi.mock("../lib/download", () => ({ saveBlob: vi.fn() }));

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [],
    activeId: null,
    worksheetId: null, // item 15 — no lingering override from an earlier test
    status: "",
    originFigures: [],
    originFidelity: [],
    folders: [],
    expandedFolders: [],
    originBookClickOpens: "worksheet", // item 15 — reset the pref between tests
  });
});

describe("useApp plot tool default (MAIN #18)", () => {
  it("defaults to 'pointer' — the new default, not the old 'zoom'", () => {
    expect(useApp.getState().plotTool).toBe("pointer");
  });

  it("setPlotTool still round-trips to any other tool", () => {
    useApp.getState().setPlotTool("zoom");
    expect(useApp.getState().plotTool).toBe("zoom");
    useApp.getState().setPlotTool("pointer");
    expect(useApp.getState().plotTool).toBe("pointer");
  });
});

describe("useApp reflectivity seed (SLD→reflectivity hook)", () => {
  beforeEach(() => useApp.setState({ reflectivitySeed: null, reflectivityOpen: false }));

  it("seedReflectivityLayer stores the seed and opens the workshop", () => {
    useApp.getState().seedReflectivityLayer({ sld: 3.47e-6, label: "SiO2 neutron" });
    expect(useApp.getState().reflectivitySeed).toEqual({ sld: 3.47e-6, label: "SiO2 neutron" });
    expect(useApp.getState().reflectivityOpen).toBe(true);
  });

  it("clearReflectivitySeed removes the pending seed", () => {
    useApp.getState().seedReflectivityLayer({ sld: 1e-6 });
    useApp.getState().clearReflectivitySeed();
    expect(useApp.getState().reflectivitySeed).toBeNull();
  });
});

describe("useApp graph-builder seed (MAIN_PLAN #4 — worksheet handoff)", () => {
  beforeEach(() => useApp.setState({ graphBuilderSeed: null, graphBuilderOpen: false }));

  const spec = {
    version: 1 as const,
    zones: { x: null, y: [{ datasetId: "d1", channel: 0 }], group: null, facet: null },
    mark: "scatter" as const,
  };

  it("openGraphBuilderSeeded stores the one-shot spec and opens the panel", () => {
    useApp.getState().openGraphBuilderSeeded(spec);
    expect(useApp.getState().graphBuilderSeed).toEqual(spec);
    expect(useApp.getState().graphBuilderOpen).toBe(true);
  });

  it("clearGraphBuilderSeed drops the seed once consumed (the panel stays open)", () => {
    useApp.getState().openGraphBuilderSeeded(spec);
    useApp.getState().clearGraphBuilderSeed();
    expect(useApp.getState().graphBuilderSeed).toBeNull();
    expect(useApp.getState().graphBuilderOpen).toBe(true);
  });
});

describe("clearAll (File ▸ Remove all)", () => {
  it("wipes datasets, folders, figures, selection, and active", () => {
    useApp.setState({
      datasets: [
        { id: "a", name: "a", data: raw, folderId: "f1" },
        { id: "b", name: "b", data: raw },
      ],
      folders: [{ id: "f1", name: "Proj", parentId: null, order: 0 }],
      expandedFolders: ["f1"],
      originFigures: [
        {
          id: "g1",
          stem: "Proj",
          datasetId: "a",
          siblingIds: ["a"],
          figure: {
            name: "G",
            x_from: 0,
            x_to: 1,
            x_log: false,
            y_from: 0,
            y_to: 1,
            y_log: false,
            n_curves: 1,
            annotations: [],
          },
        },
      ],
      activeId: "a",
      selectedIds: ["a", "b"],
    });
    useApp.getState().clearAll();
    const s = useApp.getState();
    expect(s.datasets).toEqual([]);
    expect(s.folders).toEqual([]);
    expect(s.expandedFolders).toEqual([]);
    expect(s.originFigures).toEqual([]);
    expect(s.activeId).toBeNull();
    expect(s.selectedIds).toEqual([]);
    expect(s.status).toMatch(/removed all/i);
  });
});

describe("Origin error-bar defaults on activation", () => {
  // Reflectometry-shaped book: value cols R++, dR++, R--, dR-- (A=X extracted).
  const reflBook = (): Dataset => ({
    id: "refl",
    name: "PNR",
    data: {
      time: [0, 1],
      values: [
        [1, 0.1, 2, 0.2],
        [1, 0.1, 2, 0.2],
      ],
      labels: ["R++", "dR++", "R--", "dR--"],
      units: ["", "", "", ""],
      metadata: {
        origin_column_names: ["C", "D", "E", "F"],
        column_designations: { A: "X", C: "Y", D: "Y-error", E: "Y", F: "Y-error" },
      },
    },
  });

  it("addDataset pairs Origin Y-error columns into errKeys and hides them", () => {
    useApp.getState().addDataset(reflBook());
    expect(useApp.getState().errKeys).toEqual({ 0: 1, 2: 3 });
    expect(useApp.getState().hiddenChannels).toEqual([1, 3]); // dR++/dR-- hidden as lines
  });

  it("setActive re-derives errKeys for the activated Origin dataset", () => {
    useApp.setState({ datasets: [reflBook()], activeId: null, errKeys: {} });
    useApp.getState().setActive("refl");
    expect(useApp.getState().errKeys).toEqual({ 0: 1, 2: 3 });
  });

  it("leaves errKeys empty for non-Origin data", () => {
    useApp.getState().addDataset({ id: "plain", name: "p", data: raw });
    expect(useApp.getState().errKeys).toEqual({});
  });
});

describe("activateFromLibrary (WORKSHEET_PLAN item 15 — origin book click opens…)", () => {
  // A dataset shaped like one book of an imported Origin project.
  const book = (id: string, name = `XRD:${id}`): Dataset => ({
    id,
    name,
    data: { time: [0, 1], values: [[1], [2]], labels: ["A"], units: [""], metadata: { origin_book: id } },
  });
  const plain: Dataset = { id: "csv", name: "scan.dat", data: raw };
  // A single, deterministic focused window bound to "csv" — so "does the
  // plot rebind" assertions don't depend on whatever earlier tests in this
  // file left `plotWindows` holding.
  const focusedWin: PlotWindow = {
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "csv",
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    bg: "theme",
    linkGroup: null,
    pinned: false,
    view: defaultPlotView(),
  };

  beforeEach(() => {
    useApp.setState({
      datasets: [book("b1"), plain],
      activeId: "csv",
      worksheetId: null,
      selectedIds: ["csv"],
      stageTab: "plot",
      xKey: 0, // a non-default view value, so we can prove it's untouched
      originBookClickOpens: "worksheet",
      plotWindows: [focusedWin],
      focusedWindowId: "w1",
    });
  });

  it("an Origin book (default pref) opens the Worksheet WITHOUT touching activeId/plotWindows/view", () => {
    const before = useApp.getState().plotWindows;
    useApp.getState().activateFromLibrary("b1");
    const s = useApp.getState();
    expect(s.worksheetId).toBe("b1");
    expect(s.stageTab).toBe("worksheet");
    expect(s.selectedIds).toEqual(["b1"]); // the clicked row still highlights (selected)
    // The plot itself never moved: still "csv", axis view untouched.
    expect(s.activeId).toBe("csv");
    expect(s.xKey).toBe(0);
    expect(s.plotWindows).toBe(before); // same reference — no window rebind at all
    expect(s.plotWindows[0].datasetId).toBe("csv");
  });

  it("a non-Origin dataset behaves exactly like setActive (plot-intent, unaffected by item 15)", () => {
    useApp.getState().activateFromLibrary("csv");
    const s = useApp.getState();
    expect(s.activeId).toBe("csv");
    expect(s.worksheetId).toBeNull();
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("csv");
  });

  it("the pref set to 'plot' restores the pre-item-15 behavior for an Origin book too", () => {
    useApp.setState({ originBookClickOpens: "plot" });
    useApp.getState().activateFromLibrary("b1");
    const s = useApp.getState();
    expect(s.activeId).toBe("b1"); // rebound, unlike the worksheet-intent case above
    expect(s.worksheetId).toBeNull();
    expect(s.xKey).toBeNull(); // setActive's usual view reset ran
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("b1"); // window DID rebind
  });

  it("setActive (the explicit plot-intent primitive) clears a prior worksheetId override", () => {
    useApp.getState().activateFromLibrary("b1"); // sets worksheetId = "b1"
    expect(useApp.getState().worksheetId).toBe("b1");
    useApp.getState().setActive("csv");
    expect(useApp.getState().worksheetId).toBeNull();
  });

  it("kicks ensureBookData for a still-pending Origin book on the worksheet-intent path", () => {
    const pendingBook: Dataset = { ...book("b2"), pending: { kind: "path", path: "/x.opj", bookId: "b2", rows: 10, cols: 1 } };
    useApp.setState({ datasets: [pendingBook, plain] });
    const spy = vi.spyOn(useApp.getState(), "ensureBookData").mockImplementation(() => {});
    try {
      useApp.getState().activateFromLibrary("b2");
      expect(spy).toHaveBeenCalledWith("b2");
    } finally {
      // Restore explicitly — vi.clearAllMocks() (the module beforeEach) only
      // clears call history, not a spied-on store METHOD's replacement
      // implementation, which would otherwise leak into every later test in
      // this file (they all share the one `useApp` store instance).
      spy.mockRestore();
    }
  });

  it("falls back to setActive for an unknown id (never found in datasets)", () => {
    useApp.getState().activateFromLibrary("nope");
    expect(useApp.getState().activeId).toBe("nope"); // same as calling setActive("nope") directly
    expect(useApp.getState().worksheetId).toBeNull();
  });

  it("removeDataset drops a worksheetId override pointing at the removed dataset", () => {
    useApp.getState().activateFromLibrary("b1");
    useApp.getState().removeDataset("b1");
    expect(useApp.getState().worksheetId).toBeNull();
  });

  it("removeSelected drops a worksheetId override among the removed ids", () => {
    useApp.getState().activateFromLibrary("b1");
    useApp.setState({ selectedIds: ["b1"] });
    useApp.getState().removeSelected();
    expect(useApp.getState().worksheetId).toBeNull();
  });

  it("removeDatasets drops a worksheetId override among the removed ids", () => {
    useApp.getState().activateFromLibrary("b1");
    useApp.getState().removeDatasets(["b1"]);
    expect(useApp.getState().worksheetId).toBeNull();
  });
});

describe("useApp corrections", () => {
  it("applies params to raw and replaces displayed data", async () => {
    const corrected: DataStruct = { ...raw, values: [[5], [15], [25]] };
    vi.mocked(applyCorrectionsApi).mockResolvedValue(corrected);
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });

    await useApp.getState().applyCorrections("d1", { yOff: 5 });

    expect(applyCorrectionsApi).toHaveBeenCalledWith({ dataset: raw, params: { yOff: 5 } });
    const ds = useApp.getState().datasets[0];
    expect(ds.data).toEqual(corrected);
    expect(ds.raw).toEqual(raw); // pristine preserved
    expect(ds.corrections).toEqual({ yOff: 5 });
  });

  it("re-applies against raw, never the already-corrected data", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, values: [[5], [15], [25]] });
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    await useApp.getState().applyCorrections("d1", { yOff: 5 });

    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, values: [[1], [2], [3]] });
    await useApp.getState().applyCorrections("d1", { xOff: 1 });

    expect(applyCorrectionsApi).toHaveBeenLastCalledWith({ dataset: raw, params: { xOff: 1 } });
  });

  it("reset restores the raw data", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, values: [[5], [15], [25]] });
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    await useApp.getState().applyCorrections("d1", { yOff: 5 });

    useApp.getState().resetCorrections("d1");

    const ds = useApp.getState().datasets[0];
    expect(ds.data).toEqual(raw);
    expect(ds.raw).toBeUndefined();
    expect(ds.corrections).toBeUndefined();
  });

  it("on API failure leaves data unchanged and reports status", async () => {
    vi.mocked(applyCorrectionsApi).mockRejectedValue(new Error("boom"));
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });

    await useApp.getState().applyCorrections("d1", { yOff: 5 });

    const ds = useApp.getState().datasets[0];
    expect(ds.data).toEqual(raw); // untouched
    expect(useApp.getState().status).toContain("corrections failed");
  });

  it("clears stale excludedRows when a correction changes the row count (xTrim)", async () => {
    // excludedRows are raw row INDICES; an xTrim shrinks the rows so a stale
    // index would exclude the wrong row (or nothing). It must be dropped.
    const trimmed: DataStruct = { ...raw, time: [2, 3], values: [[20], [30]] };
    vi.mocked(applyCorrectionsApi).mockResolvedValue(trimmed);
    useApp.setState({
      datasets: [{ id: "d1", name: "x", data: raw, excludedRows: [2] }],
      activeId: "d1",
    });

    await useApp.getState().applyCorrections("d1", { xTrimMin: 1.5 });

    const ds = useApp.getState().datasets[0];
    expect(ds.data.time).toEqual([2, 3]);
    expect(ds.excludedRows).toBeUndefined();
    expect(useApp.getState().status).toContain("Row exclusions cleared");
  });

  it("keeps excludedRows when the correction preserves the row count", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, values: [[5], [15], [25]] });
    useApp.setState({
      datasets: [{ id: "d1", name: "x", data: raw, excludedRows: [1] }],
      activeId: "d1",
    });

    await useApp.getState().applyCorrections("d1", { yOff: 5 });

    expect(useApp.getState().datasets[0].excludedRows).toEqual([1]);
  });

  it("forwards a reference-background dataset + interp and records bgRef", async () => {
    const bg: DataStruct = { ...raw, values: [[1], [1], [1]] };
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, values: [[9], [19], [29]] });
    useApp.setState({
      datasets: [
        { id: "d1", name: "x", data: raw },
        { id: "bg1", name: "bg", data: bg },
      ],
      activeId: "d1",
    });

    await useApp.getState().applyCorrections("d1", { yOff: 0 }, { datasetId: "bg1", interp: "pchip" });

    // The picked dataset's CURRENT data is the reference background (taken as-is).
    expect(applyCorrectionsApi).toHaveBeenCalledWith({
      dataset: raw,
      params: { yOff: 0 },
      bg_dataset: bg,
      bg_interp: "pchip",
    });
    expect(useApp.getState().datasets[0].bgRef).toEqual({ datasetId: "bg1", interp: "pchip" });
  });

  it("omits bg when the picked id is the active dataset or does not exist", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue(raw);
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });

    await useApp.getState().applyCorrections("d1", {}, { datasetId: "d1", interp: "linear" });
    expect(applyCorrectionsApi).toHaveBeenLastCalledWith({ dataset: raw, params: {} });

    await useApp.getState().applyCorrections("d1", {}, { datasetId: "ghost", interp: "linear" });
    expect(applyCorrectionsApi).toHaveBeenLastCalledWith({ dataset: raw, params: {} });
    expect(useApp.getState().datasets[0].bgRef).toBeUndefined();
  });

  it("reset clears a recorded bgRef along with the corrections", async () => {
    const bg: DataStruct = { ...raw, values: [[1], [1], [1]] };
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, values: [[9], [19], [29]] });
    useApp.setState({
      datasets: [
        { id: "d1", name: "x", data: raw },
        { id: "bg1", name: "bg", data: bg },
      ],
      activeId: "d1",
    });
    await useApp.getState().applyCorrections("d1", { yOff: 0 }, { datasetId: "bg1", interp: "linear" });
    expect(useApp.getState().datasets[0].bgRef).toBeDefined();

    useApp.getState().resetCorrections("d1");
    expect(useApp.getState().datasets[0].bgRef).toBeUndefined();
  });
});

describe("useApp applyCorrectionsToMany", () => {
  const b: DataStruct = { ...raw, values: [[1], [2], [3]] };
  const c: DataStruct = { ...raw, values: [[4], [5], [6]] };

  it("copies the source's corrections onto every other target (re-derived from raw)", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, values: [[0], [0], [0]] });
    useApp.setState({
      datasets: [
        { id: "d1", name: "src", data: raw, raw, corrections: { yOff: 5 } },
        { id: "d2", name: "b", data: b },
        { id: "d3", name: "c", data: c },
      ],
      activeId: "d1",
    });

    await useApp.getState().applyCorrectionsToMany("d1", ["d1", "d2", "d3"]);

    // Source skipped; both targets get d1's params applied to their own raw (=data).
    expect(applyCorrectionsApi).toHaveBeenCalledTimes(2);
    expect(applyCorrectionsApi).toHaveBeenCalledWith({ dataset: b, params: { yOff: 5 } });
    expect(applyCorrectionsApi).toHaveBeenCalledWith({ dataset: c, params: { yOff: 5 } });
    expect(useApp.getState().status).toContain("applied");
  });

  it("is a no-op (with a status) when the source has no corrections", async () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "src", data: raw },
        { id: "d2", name: "b", data: b },
      ],
      activeId: "d1",
    });
    await useApp.getState().applyCorrectionsToMany("d1", ["d2"]);
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
    expect(useApp.getState().status).toContain("no corrections");
  });
});

describe("useApp duplicateDataset", () => {
  it("inserts an independent copy right after the source and activates it", async () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "first.dat", data: raw },
        { id: "d2", name: "second.dat", data: raw },
      ],
      activeId: "d2",
    });

    await useApp.getState().duplicateDataset("d1");

    const ds = useApp.getState().datasets;
    expect(ds.map((d) => d.name)).toEqual(["first.dat", "first.dat (copy)", "second.dat"]);
    const copy = ds[1];
    expect(copy.id).not.toBe("d1");
    expect(useApp.getState().activeId).toBe(copy.id); // copy becomes active
    // Deep copy: the clone's arrays are independent of the source.
    expect(copy.data).toEqual(raw);
    expect(copy.data.values).not.toBe(raw.values);
  });

  it("carries raw / corrections / bgRef onto the copy", async () => {
    const corrected = { ...raw, values: [[5], [15], [25]] };
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "x",
          data: corrected,
          raw,
          corrections: { yOff: 5 },
          bgRef: { datasetId: "bg", interp: "pchip" },
        },
      ],
      activeId: "d1",
    });

    await useApp.getState().duplicateDataset("d1");
    const copy = useApp.getState().datasets[1];
    expect(copy.raw).toEqual(raw);
    expect(copy.corrections).toEqual({ yOff: 5 });
    expect(copy.bgRef).toEqual({ datasetId: "bg", interp: "pchip" });
    expect(copy.corrections).not.toBe(useApp.getState().datasets[0].corrections); // independent
  });

  it("is a no-op for an unknown id", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    await useApp.getState().duplicateDataset("ghost");
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("resolves a still-pending source before cloning, so the copy isn't stuck on the preview", async () => {
    const full: DataStruct = { time: [1, 2, 3, 4], values: [[1], [2], [3], [4]], labels: ["m"], units: ["emu"], metadata: {} };
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "book.opj",
          data: { time: [1, 2], values: [[1], [2]], labels: ["m"], units: ["emu"], metadata: {} },
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 4, cols: 1 },
        },
      ],
      activeId: "d1",
    });
    vi.mocked(fetchBookData).mockResolvedValue(full);

    await useApp.getState().duplicateDataset("d1");

    const copy = useApp.getState().datasets[1];
    expect(copy.data.time).toEqual(full.time);
    expect(copy.pending).toBeUndefined();
    expect(useApp.getState().datasets[0].pending).toBeUndefined(); // the source resolved too
  });
});

describe("useApp moveDataset", () => {
  const three = () => [
    { id: "d1", name: "a", data: raw },
    { id: "d2", name: "b", data: raw },
    { id: "d3", name: "c", data: raw },
  ];

  it("swaps a dataset up and down with its neighbor", () => {
    useApp.setState({ datasets: three(), activeId: "d2" });
    useApp.getState().moveDataset("d2", -1); // up
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d2", "d1", "d3"]);
    useApp.getState().moveDataset("d2", 1); // back down
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("does not change the active selection", () => {
    useApp.setState({ datasets: three(), activeId: "d3" });
    useApp.getState().moveDataset("d1", 1);
    expect(useApp.getState().activeId).toBe("d3");
  });

  it("is a no-op at the ends and for an unknown id", () => {
    useApp.setState({ datasets: three(), activeId: "d1" });
    useApp.getState().moveDataset("d1", -1); // already first
    useApp.getState().moveDataset("d3", 1); // already last
    useApp.getState().moveDataset("ghost", 1);
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
  });
});

describe("useApp multi-select + removeSelected", () => {
  const three = () => [
    { id: "d1", name: "a", data: raw },
    { id: "d2", name: "b", data: raw },
    { id: "d3", name: "c", data: raw },
  ];

  it("a plain setActive collapses the selection to one row", () => {
    useApp.setState({ datasets: three(), activeId: "d1", selectedIds: ["d1", "d2", "d3"] });
    useApp.getState().setActive("d2");
    expect(useApp.getState().selectedIds).toEqual(["d2"]);
    expect(useApp.getState().activeId).toBe("d2");
  });

  it("toggleSelected adds/removes without changing the active dataset", () => {
    useApp.setState({ datasets: three(), activeId: "d1", selectedIds: ["d1"] });
    useApp.getState().toggleSelected("d3");
    expect(useApp.getState().selectedIds).toEqual(["d1", "d3"]);
    expect(useApp.getState().activeId).toBe("d1"); // plot unaffected
    useApp.getState().toggleSelected("d3");
    expect(useApp.getState().selectedIds).toEqual(["d1"]);
  });

  it("selectRange selects the contiguous range from the anchor (activeId)", () => {
    useApp.setState({ datasets: three(), activeId: "d1", selectedIds: ["d1"] });
    useApp.getState().selectRange("d3");
    expect(useApp.getState().selectedIds).toEqual(["d1", "d2", "d3"]);
    expect(useApp.getState().activeId).toBe("d1"); // anchor stays active
  });

  it("selectRange works regardless of click direction", () => {
    useApp.setState({ datasets: three(), activeId: "d3", selectedIds: ["d3"] });
    useApp.getState().selectRange("d1");
    expect(useApp.getState().selectedIds).toEqual(["d1", "d2", "d3"]);
  });

  it("removeSelected removes every selected dataset and reselects a survivor", () => {
    useApp.setState({ datasets: three(), activeId: "d1", selectedIds: ["d1", "d2"] });
    useApp.getState().removeSelected();
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["d3"]);
    expect(s.activeId).toBe("d3");
    expect(s.selectedIds).toEqual(["d3"]);
  });

  it("removeSelected falls back to the active dataset when nothing is multi-selected", () => {
    useApp.setState({ datasets: three(), activeId: "d2", selectedIds: [] });
    useApp.getState().removeSelected();
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d1", "d3"]);
  });

  it("removeSelected keeps the active dataset if it was not in the selection", () => {
    useApp.setState({ datasets: three(), activeId: "d3", selectedIds: ["d1"] });
    useApp.getState().removeSelected();
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["d2", "d3"]);
    expect(s.activeId).toBe("d3"); // survived → stays active
  });

  it("removeDataset prunes the id from the selection too", () => {
    useApp.setState({ datasets: three(), activeId: "d1", selectedIds: ["d1", "d2", "d3"] });
    useApp.getState().removeDataset("d2");
    expect(useApp.getState().selectedIds).toEqual(["d1", "d3"]);
  });

  it("selectIds replaces the selection without moving the active dataset (item 8)", () => {
    useApp.setState({ datasets: three(), activeId: "d1", selectedIds: ["d1"] });
    useApp.getState().selectIds(["d2", "d3"]);
    expect(useApp.getState().selectedIds).toEqual(["d2", "d3"]);
    expect(useApp.getState().activeId).toBe("d1"); // plot unaffected
  });

  it("selectIds de-duplicates and drops ids that aren't loaded", () => {
    useApp.setState({ datasets: three(), activeId: "d1", selectedIds: [] });
    useApp.getState().selectIds(["d2", "d2", "ghost", "d1"]);
    expect(useApp.getState().selectedIds).toEqual(["d2", "d1"]);
  });
});

describe("useApp renameDataset", () => {
  it("renames by id and ignores a blank name", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "old.dat", data: raw }], activeId: "d1" });
    useApp.getState().renameDataset("d1", "  5K loop  ");
    expect(useApp.getState().datasets[0].name).toBe("5K loop"); // trimmed
    useApp.getState().renameDataset("d1", "   ");
    expect(useApp.getState().datasets[0].name).toBe("5K loop"); // blank → unchanged
  });
});

describe("useApp setDatasetNotes", () => {
  it("attaches notes by id and clears them on a blank value", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    useApp.getState().setDatasetNotes("d1", "annealed at 600C");
    expect(useApp.getState().datasets[0].notes).toBe("annealed at 600C");
    useApp.getState().setDatasetNotes("d1", "   ");
    expect(useApp.getState().datasets[0].notes).toBeUndefined();
  });
});

describe("useApp x-axis channel", () => {
  it("resets xKey to .time when switching or adding a dataset", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
      xKey: 1,
    });
    useApp.getState().setActive("d2");
    expect(useApp.getState().xKey).toBeNull();

    useApp.setState({ xKey: 2 });
    useApp.getState().addDataset({ id: "d3", name: "c", data: raw });
    expect(useApp.getState().xKey).toBeNull();
  });

  it("loadWorkspace resets the x-axis channel", () => {
    useApp.setState({ datasets: [{ id: "old", name: "x", data: raw }], activeId: "old", xKey: 3 });
    useApp.getState().loadWorkspace({ datasets: [{ id: "w1", name: "n", data: raw }] });
    expect(useApp.getState().xKey).toBeNull();
  });
});

describe("useApp error-bar pairings", () => {
  it("sets and clears a channel's error pairing", () => {
    useApp.setState({ errKeys: {} });
    useApp.getState().setErrKey(0, 1);
    expect(useApp.getState().errKeys).toEqual({ 0: 1 });
    useApp.getState().setErrKey(0, null);
    expect(useApp.getState().errKeys).toEqual({});
  });

  it("resets error pairings when switching or adding a dataset", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
      errKeys: { 0: 1 },
    });
    useApp.getState().setActive("d2");
    expect(useApp.getState().errKeys).toEqual({});

    useApp.setState({ errKeys: { 0: 1 } });
    useApp.getState().addDataset({ id: "d3", name: "c", data: raw });
    expect(useApp.getState().errKeys).toEqual({});
  });
});

describe("useApp column roles (label/ignore) — per dataset", () => {
  it("sets and clears a role on the active dataset", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "a", data: raw }], activeId: "d1" });
    useApp.getState().setChannelRole(1, "label");
    expect(useApp.getState().datasets[0].channelRoles).toEqual({ 1: "label" });
    useApp.getState().setChannelRole(1, "ignore");
    expect(useApp.getState().datasets[0].channelRoles).toEqual({ 1: "ignore" });
    useApp.getState().setChannelRole(1, null);
    expect(useApp.getState().datasets[0].channelRoles).toBeUndefined(); // empties to undefined
  });

  it("roles are per-dataset and persist across a switch (not reset)", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
    });
    useApp.getState().setChannelRole(0, "ignore"); // role on d1
    useApp.getState().setActive("d2");
    expect(useApp.getState().datasets[1].channelRoles).toBeUndefined(); // d2 has its own (none)
    useApp.getState().setActive("d1");
    expect(useApp.getState().datasets[0].channelRoles).toEqual({ 0: "ignore" }); // d1 kept it
  });

  it("is a no-op with no active dataset", () => {
    useApp.setState({ datasets: [], activeId: null });
    useApp.getState().setChannelRole(0, "label");
    expect(useApp.getState().datasets).toEqual([]);
  });
});

describe("useApp series draw order", () => {
  it("sets and clears an explicit draw order", () => {
    useApp.setState({ seriesOrder: null });
    useApp.getState().setSeriesOrder([2, 0, 1]);
    expect(useApp.getState().seriesOrder).toEqual([2, 0, 1]);
    useApp.getState().setSeriesOrder(null);
    expect(useApp.getState().seriesOrder).toBeNull();
  });

  it("resets the draw order when switching or adding a dataset", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
      seriesOrder: [1, 0],
    });
    useApp.getState().setActive("d2");
    expect(useApp.getState().seriesOrder).toBeNull();

    useApp.setState({ seriesOrder: [1, 0] });
    useApp.getState().addDataset({ id: "d3", name: "c", data: raw });
    expect(useApp.getState().seriesOrder).toBeNull();
  });
});

describe("useApp interactive legend (hidden channels)", () => {
  it("toggles a channel's hidden state", () => {
    useApp.setState({ hiddenChannels: [] });
    useApp.getState().toggleHidden(2);
    expect(useApp.getState().hiddenChannels).toEqual([2]);
    useApp.getState().toggleHidden(2);
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });

  it("resets hidden channels when switching or adding a dataset", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
      hiddenChannels: [0, 1],
    });
    useApp.getState().setActive("d2");
    expect(useApp.getState().hiddenChannels).toEqual([]);

    useApp.setState({ hiddenChannels: [1] });
    useApp.getState().addDataset({ id: "d3", name: "c", data: raw });
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });
});

describe("useApp axis limits", () => {
  it("clears explicit limits when switching the active dataset", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
      xLim: [0, 5],
      yLim: [-1, 1],
    });
    useApp.getState().setActive("d2");
    expect(useApp.getState().xLim).toBeNull();
    expect(useApp.getState().yLim).toBeNull();
  });

  it("autoscales (clears limits) when a new dataset is added", () => {
    useApp.setState({ datasets: [], activeId: null, xLim: [0, 5], yLim: [0, 9] });
    useApp.getState().addDataset({ id: "n1", name: "new", data: raw });
    expect(useApp.getState().xLim).toBeNull();
    expect(useApp.getState().yLim).toBeNull();
  });
});

describe("useApp reference lines", () => {
  it("adds X/Y reference lines with unique ids and removes by id", () => {
    useApp.setState({ refLines: [] });
    useApp.getState().addRefLine("x", 100);
    useApp.getState().addRefLine("y", -2.5);
    const lines = useApp.getState().refLines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ axis: "x", value: 100 });
    expect(lines[1]).toMatchObject({ axis: "y", value: -2.5 });
    expect(lines[0].id).not.toEqual(lines[1].id);

    useApp.getState().removeRefLine(lines[0].id);
    const after = useApp.getState().refLines;
    expect(after).toHaveLength(1);
    expect(after[0].axis).toBe("y");
  });

  it("updates a reference line's value by id (drag commit) and ignores unknown ids", () => {
    useApp.setState({ refLines: [] });
    useApp.getState().addRefLine("x", 10);
    const id = useApp.getState().refLines[0].id;
    useApp.getState().updateRefLine(id, 42);
    expect(useApp.getState().refLines[0].value).toBe(42);
    useApp.getState().updateRefLine("ghost", 99); // no-op
    expect(useApp.getState().refLines).toHaveLength(1);
    expect(useApp.getState().refLines[0].value).toBe(42);
  });
});

describe("useApp tick format", () => {
  it("defaults both axes to auto and updates per axis", () => {
    useApp.setState({ xFmt: { mode: "auto", digits: 2 }, yFmt: { mode: "auto", digits: 2 } });
    expect(useApp.getState().xFmt).toEqual({ mode: "auto", digits: 2 });
    useApp.getState().setXFmt({ mode: "sci", digits: 3 });
    useApp.getState().setYFmt({ mode: "fixed", digits: 1 });
    expect(useApp.getState().xFmt).toEqual({ mode: "sci", digits: 3 });
    expect(useApp.getState().yFmt).toEqual({ mode: "fixed", digits: 1 });
  });
});

describe("useApp annotations", () => {
  it("adds annotations with unique ids and removes by id", () => {
    useApp.setState({ annotations: [] });
    useApp.getState().addAnnotation(1.5, 2.5, "peak");
    useApp.getState().addAnnotation(3, 4, "edge");
    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(2);
    expect(anns[0]).toMatchObject({ x: 1.5, y: 2.5, text: "peak" });
    expect(anns[1]).toMatchObject({ x: 3, y: 4, text: "edge" });
    expect(anns[0].id).not.toEqual(anns[1].id);

    useApp.getState().removeAnnotation(anns[0].id);
    const after = useApp.getState().annotations;
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe("edge");
  });
});

describe("useApp series styles", () => {
  it("merges successive style patches per channel", () => {
    useApp.setState({ seriesStyles: {} });
    useApp.getState().setSeriesStyle(1, { color: "#ff0000" });
    useApp.getState().setSeriesStyle(1, { width: 3 });
    expect(useApp.getState().seriesStyles[1]).toEqual({ color: "#ff0000", width: 3 });
  });

  it("resets a single channel without touching the others", () => {
    useApp.setState({ seriesStyles: { 0: { width: 2 }, 1: { color: "#0f0" } } });
    useApp.getState().resetSeriesStyle(0);
    expect(useApp.getState().seriesStyles[0]).toBeUndefined();
    expect(useApp.getState().seriesStyles[1]).toEqual({ color: "#0f0" });
  });

  it("clears all styles when the dataset changes (indices are per-dataset)", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
      seriesStyles: { 0: { width: 4 } },
    });
    useApp.getState().setActive("d2");
    expect(useApp.getState().seriesStyles).toEqual({});

    useApp.setState({ seriesStyles: { 0: { width: 4 } } });
    useApp.getState().addDataset({ id: "d3", name: "c", data: raw });
    expect(useApp.getState().seriesStyles).toEqual({});
  });
});

describe("useApp series labels (legend rename)", () => {
  it("sets a per-channel label override", () => {
    useApp.setState({ seriesLabels: {} });
    useApp.getState().setSeriesLabel(1, "Moment");
    expect(useApp.getState().seriesLabels[1]).toBe("Moment");
  });

  it("trims, and clears the override on a blank label", () => {
    useApp.setState({ seriesLabels: {} });
    useApp.getState().setSeriesLabel(2, "  Field  ");
    expect(useApp.getState().seriesLabels[2]).toBe("Field");
    useApp.getState().setSeriesLabel(2, "   ");
    expect(useApp.getState().seriesLabels[2]).toBeUndefined();
  });

  it("clears all renames when the dataset changes (indices are per-dataset)", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
      seriesLabels: { 0: "renamed" },
    });
    useApp.getState().setActive("d2");
    expect(useApp.getState().seriesLabels).toEqual({});
  });
});

describe("useApp appearance prefs", () => {
  it("setTheme applies to <html> and persists to localStorage", () => {
    useApp.getState().setTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    const saved = JSON.parse(localStorage.getItem("qz.prefs") ?? "{}");
    expect(saved.theme).toBe("light");
    useApp.getState().setTheme("dark"); // restore
  });

  it("applied the persisted appearance attributes on load", () => {
    // The module-level apply ran on import, so the attributes exist.
    expect(document.documentElement.dataset.accent).toBeTruthy();
    expect(document.documentElement.dataset.density).toBeTruthy();
  });
});

describe("useApp importFiles", () => {
  const fakeFile = (name: string) => new File(["x"], name);

  it("uploads each file and adds it to the library", async () => {
    vi.mocked(uploadFile).mockResolvedValue(raw);
    await useApp.getState().importFiles([fakeFile("a.dat"), fakeFile("b.dat")]);

    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    expect(ds.map((d) => d.name)).toEqual(["a.dat", "b.dat"]);
    expect(ds[0].id).not.toEqual(ds[1].id); // unique ids
    expect(useApp.getState().status).toContain("imported 2 files");
  });

  it("fans an Origin project out into one dataset per workbook + a project folder", async () => {
    const book = (short: string, long?: string) => ({
      ...raw,
      metadata: { origin_book: short, ...(long ? { origin_book_long: long } : {}) },
    });
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [book("Book1", "30 nm MnN"), book("Book2")],
    });
    await useApp.getState().importFiles([fakeFile("Moke.opj")]);

    const st = useApp.getState();
    expect(st.datasets).toHaveLength(2);
    expect(st.datasets.map((d) => d.name)).toEqual(["Moke:Book1 — 30 nm MnN", "Moke:Book2"]);
    expect(st.datasets[0].data.metadata.origin_book).toBe("Book1");
    // item 4: a "Moke" project folder holding both books (no folder path → flat).
    expect(st.folders.map((f) => f.name)).toEqual(["Moke"]);
    const moke = st.folders[0].id;
    expect(st.datasets.every((d) => d.folderId === moke)).toBe(true);
    expect(st.expandedFolders).toContain(moke);
  });

  it("mirrors the Origin Project Explorer folder tree on import (item 4)", async () => {
    const book = (short: string, path: string[]) => ({
      ...raw,
      metadata: { origin_book: short, origin_folder_path: path },
    });
    // Moke.opj's real shape: two PE folders; Book4 is a 3-sheet workbook.
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [
        book("Book1", ["Raw normalized"]),
        book("Book4", ["Sub subtraction"]),
        book("Book4@2", ["Sub subtraction"]),
        book("Book4@3", ["Sub subtraction"]),
      ],
    });
    await useApp.getState().importFiles([fakeFile("Moke.opj")]);

    const st = useApp.getState();
    const byName = new Map(st.folders.map((f) => [f.name, f]));
    // Moke → {Raw normalized, Sub subtraction → Book4}
    expect(st.folders.map((f) => f.name).sort()).toEqual(
      ["Book4", "Moke", "Raw normalized", "Sub subtraction"].sort(),
    );
    expect(byName.get("Raw normalized")!.parentId).toBe(byName.get("Moke")!.id);
    expect(byName.get("Book4")!.parentId).toBe(byName.get("Sub subtraction")!.id);
    const at = (name: string) => st.datasets.find((d) => d.name === name)!.folderId;
    expect(at("Moke:Book1")).toBe(byName.get("Raw normalized")!.id);
    expect(at("Moke:Book4")).toBe(byName.get("Book4")!.id); // sheet nested in its workbook folder
    expect(at("Moke:Book4@2")).toBe(byName.get("Book4")!.id);
  });

  it("continues past a bad file and reports the failure", async () => {
    vi.mocked(uploadFile)
      .mockRejectedValueOnce(new Error("unknown format"))
      .mockResolvedValueOnce(raw);
    await useApp.getState().importFiles([fakeFile("bad.zzz"), fakeFile("good.dat")]);

    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().datasets[0].name).toBe("good.dat");
    expect(useApp.getState().status).toContain("failed bad.zzz");
    // #40: a parse failure points at the wizard's manual guess/preview/parse path.
    expect(useApp.getState().status).toContain("Import wizard");
  });

  it("stores Origin figures from the import, resolved against the new books (item 18)", async () => {
    const book = (short: string) => ({ ...raw, metadata: { origin_book: short } });
    const originFigure = {
      name: "Graph1",
      x_from: 18,
      x_to: 100,
      x_log: false,
      y_from: 1,
      y_to: 1e6,
      y_log: true,
      n_curves: 3,
      annotations: [] as string[],
      source_hint: "Book2",
    };
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [book("Book1"), book("Book2")],
      figures: [originFigure],
      origin_fidelity: {
        version: 1,
        container: "opj",
        status: "best_effort",
        graph_records_total: 2,
        graph_records_actionable: 1,
        graph_records_filtered: 1,
        omissions: ["graphic_objects"],
        filtered_figures: [
          { index: 1, name: "SYSTEM", layer: null, reason: "no bound curves" },
        ],
      },
    });
    await useApp.getState().importFiles([fakeFile("XRD.opj")]);

    const s = useApp.getState();
    expect(s.originFigures).toHaveLength(1);
    expect(s.originFigures[0].stem).toBe("XRD");
    const book2 = s.datasets.find((d) => d.name === "XRD:Book2");
    expect(s.originFigures[0].datasetId).toBe(book2?.id);
    expect(s.originFidelity).toHaveLength(1);
    expect(s.originFidelity[0].stem).toBe("XRD");
    expect(s.originFidelity[0].manifest.graph_records_filtered).toBe(1);
    expect(s.originFidelity[0].siblingIds).toEqual(s.datasets.map((d) => d.id));
    // figures never leak into the DataStruct payload itself (data contract).
    expect(s.datasets.every((d) => !("figures" in d.data))).toBe(true);
    expect(s.datasets.every((d) => !("origin_fidelity" in d.data))).toBe(true);
  });

  it("disables a figure whose loose source hint matches no imported book", async () => {
    const book = (short: string) => ({ ...raw, metadata: { origin_book: short } });
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [book("Book1"), book("Book2")],
      figures: [
        {
          name: "Graph9",
          x_from: 0,
          x_to: 1,
          x_log: false,
          y_from: 0,
          y_to: 1,
          y_log: false,
          n_curves: 1,
          annotations: [],
          source_hint: "NoSuchBook",
        },
      ],
    });
    await useApp.getState().importFiles([fakeFile("XRD.opj")]);
    expect(useApp.getState().originFigures[0].datasetId).toBeNull();
  });
});

describe("useApp lazy per-book import (ORIGIN_FILE_DECODE_PLAN #38)", () => {
  const fakeFile = (name: string) => new File(["x"], name);

  const primaryMarker = {
    lazy: false as const,
    primary: true as const,
    id: "Book1",
    labels: ["m"],
    units: ["emu"],
    metadata: { origin_book: "Book1" },
    rows: 3,
    cols: 1,
  };
  const lazyEntry = {
    lazy: true as const,
    id: "Book2",
    labels: ["m"],
    units: ["emu"],
    metadata: { origin_book: "Book2" },
    rows: 5000,
    cols: 1,
    preview: { time: [1, 2], values: [[10], [20]] },
  };
  // A pending dataset's `data` in the store, matching what importFiles builds
  // for a lazy entry: a real (small) DataStruct, metadata included.
  const previewData: DataStruct = {
    time: [1, 2],
    values: [[10], [20]],
    labels: ["m"],
    units: ["emu"],
    metadata: { origin_book: "Book2" },
  };

  it("builds the primary dataset from the top-level payload, not pending", async () => {
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [primaryMarker, lazyEntry],
      book_source: { kind: "path", path: "/data/PNR.opj" },
    });
    await useApp.getState().importFiles([fakeFile("PNR.opj")]);

    const st = useApp.getState();
    const primary = st.datasets.find((d) => d.name === "PNR:Book1")!;
    expect(primary.pending).toBeUndefined();
    expect(primary.data.time).toEqual(raw.time); // the top-level (full) payload
    expect(primary.data.values).toEqual(raw.values);
  });

  it("builds a pending dataset from a lazy entry's preview + book_source", async () => {
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [primaryMarker, lazyEntry],
      book_source: { kind: "path", path: "/data/PNR.opj" },
    });
    await useApp.getState().importFiles([fakeFile("PNR.opj")]);

    const st = useApp.getState();
    const lazy = st.datasets.find((d) => d.name === "PNR:Book2")!;
    expect(lazy.pending).toEqual({
      kind: "path",
      path: "/data/PNR.opj",
      bookId: "Book2",
      rows: 5000,
      cols: 1,
    });
    // the small preview stands in as `data` until fetched — a real DataStruct,
    // just fewer rows, so every consumer that reads .time/.values still works.
    expect(lazy.data.time).toEqual([1, 2]);
    expect(lazy.data.values).toEqual([[10], [20]]);
    expect(lazy.data.metadata.origin_book).toBe("Book2");
  });

  it("ensureBookData fetches, installs the full data, and clears pending", async () => {
    vi.mocked(uploadFile).mockResolvedValue({
      ...raw,
      books: [primaryMarker, lazyEntry],
      book_source: { kind: "path", path: "/data/PNR.opj" },
    });
    await useApp.getState().importFiles([fakeFile("PNR.opj")]);
    const lazyId = useApp.getState().datasets.find((d) => d.name === "PNR:Book2")!.id;

    const full: DataStruct = {
      time: [1, 2, 3, 4, 5],
      values: [[1], [2], [3], [4], [5]],
      labels: ["m"],
      units: ["emu"],
      metadata: { origin_book: "Book2" },
    };
    vi.mocked(fetchBookData).mockResolvedValue(full);

    useApp.getState().ensureBookData(lazyId);
    await vi.waitFor(() => expect(useApp.getState().datasets.find((d) => d.id === lazyId)!.pending).toBeUndefined());

    const resolved = useApp.getState().datasets.find((d) => d.id === lazyId)!;
    expect(resolved.data).toEqual(full);
    expect(fetchBookData).toHaveBeenCalledWith({
      kind: "path",
      path: "/data/PNR.opj",
      bookId: "Book2",
      rows: 5000,
      cols: 1,
    });
  });

  it("ensureBookData clears stale row-state (indices were against the preview)", async () => {
    const id = "ds-preview-1";
    useApp.setState({
      datasets: [
        {
          id,
          name: "lazy",
          data: previewData,
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5000, cols: 1 },
          excludedRows: [0],
          filter: [{ col: 0, kind: "range", min: 0, max: 1 }],
        },
      ],
    });
    vi.mocked(fetchBookData).mockResolvedValue(raw);
    useApp.getState().ensureBookData(id);
    await vi.waitFor(() => expect(useApp.getState().datasets[0].pending).toBeUndefined());
    expect(useApp.getState().datasets[0].excludedRows).toBeUndefined();
    expect(useApp.getState().datasets[0].filter).toBeUndefined();
  });

  it("ensureBookData is a no-op for a dataset that isn't pending", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }] });
    useApp.getState().ensureBookData("d1");
    expect(fetchBookData).not.toHaveBeenCalled();
  });

  it("ensureBookData is single-flight — two calls in flight fetch once", async () => {
    const id = "ds-preview-2";
    useApp.setState({
      datasets: [
        {
          id,
          name: "lazy",
          data: previewData,
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5000, cols: 1 },
        },
      ],
    });
    let resolveFetch: (v: DataStruct) => void;
    vi.mocked(fetchBookData).mockReturnValue(new Promise((res) => (resolveFetch = res)));
    useApp.getState().ensureBookData(id);
    useApp.getState().ensureBookData(id);
    expect(fetchBookData).toHaveBeenCalledTimes(1);
    resolveFetch!(raw);
    await vi.waitFor(() => expect(useApp.getState().datasets[0].pending).toBeUndefined());
  });

  it("ensureBookData toasts on failure and leaves pending set (retry affordance)", async () => {
    const id = "ds-preview-3";
    useApp.setState({
      datasets: [
        {
          id,
          name: "lazy book",
          data: previewData,
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5000, cols: 1 },
        },
      ],
    });
    vi.mocked(fetchBookData).mockRejectedValue(new Error("network down"));
    useApp.getState().ensureBookData(id);
    await vi.waitFor(() => expect(fetchBookData).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0)); // let the rejection settle
    expect(useApp.getState().datasets[0].pending).toBeDefined(); // still pending — retryable
  });

  it("setActive triggers a fetch for a newly-active pending dataset", async () => {
    useApp.setState({
      datasets: [
        { id: "a", name: "a", data: raw },
        {
          id: "b",
          name: "b lazy",
          data: previewData,
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5000, cols: 1 },
        },
      ],
      plotWindows: [],
      focusedWindowId: null,
    });
    vi.mocked(fetchBookData).mockResolvedValue(raw);
    useApp.getState().setActive("b");
    await vi.waitFor(() => expect(fetchBookData).toHaveBeenCalled());
  });

  it("resolvePendingDatasets awaits every pending dataset and lets a failure propagate", async () => {
    useApp.setState({
      datasets: [
        {
          id: "ok",
          name: "ok",
          data: previewData,
          pending: { kind: "path", path: "/ok.opj", bookId: "BookOK", rows: 10, cols: 1 },
        },
        {
          id: "bad",
          name: "bad",
          data: previewData,
          pending: { kind: "path", path: "/bad.opj", bookId: "BookBad", rows: 10, cols: 1 },
        },
      ],
    });
    vi.mocked(fetchBookData).mockImplementation(async (source) =>
      source.bookId === "BookBad" ? Promise.reject(new Error("gone")) : raw,
    );
    await expect(useApp.getState().resolvePendingDatasets()).rejects.toThrow("gone");
    expect(useApp.getState().datasets.find((d) => d.id === "ok")!.pending).toBeUndefined();
  });

  it("saveWorkspaceToFile resolves pending datasets before serializing", async () => {
    useApp.setState({
      datasets: [
        {
          id: "lazy1",
          name: "lazy1",
          data: previewData,
          pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5000, cols: 1 },
        },
      ],
      plotWindows: [],
      focusedWindowId: null,
    });
    vi.mocked(fetchBookData).mockResolvedValue(raw);
    await useApp.getState().saveWorkspaceToFile();

    expect(useApp.getState().datasets[0].pending).toBeUndefined();
    expect(saveBlob).toHaveBeenCalledTimes(1);
    const [blob] = vi.mocked(saveBlob).mock.calls[0];
    const text = await blob.text();
    expect(text).not.toContain('"pending"');
  });

  it("full_books escape-hatch shape (a plain DataStruct, no lazy/primary marker) imports as full data", async () => {
    const fullBook = { ...raw, metadata: { origin_book: "Book9" } };
    vi.mocked(uploadFile).mockResolvedValue({ ...raw, books: [fullBook, { ...raw, metadata: { origin_book: "Book10" } }] });
    await useApp.getState().importFiles([fakeFile("Legacy.opj")]);
    const ds = useApp.getState().datasets.find((d) => d.name === "Legacy:Book9")!;
    expect(ds.pending).toBeUndefined();
    expect(ds.data.time).toEqual(raw.time);
  });

  // The general-purpose resolve helper closing the #38 "deferred edge" — every
  // compute/export entry point (corrections, dataset math, exports, batch
  // ops, macro replay, fitting workshops) awaits this instead of reading
  // `.data` straight off a possibly-still-pending dataset.
  describe("resolveDataset / resolveDatasets (#38 compute/export guard)", () => {
    it("resolveDataset is a same-tick no-op for a non-pending dataset", async () => {
      useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }] });
      const ds = await useApp.getState().resolveDataset("d1");
      expect(ds?.data).toEqual(raw);
      expect(fetchBookData).not.toHaveBeenCalled();
    });

    it("resolveDataset fetches + clears pending for a lazy dataset", async () => {
      useApp.setState({
        datasets: [
          {
            id: "d1",
            name: "book.opj",
            data: previewData,
            pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5000, cols: 1 },
          },
        ],
      });
      vi.mocked(fetchBookData).mockResolvedValue(raw);
      const ds = await useApp.getState().resolveDataset("d1");
      expect(ds?.data).toEqual(raw);
      expect(ds?.pending).toBeUndefined();
    });

    it("resolveDataset returns undefined for an unknown id without fetching", async () => {
      useApp.setState({ datasets: [] });
      const ds = await useApp.getState().resolveDataset("ghost");
      expect(ds).toBeUndefined();
      expect(fetchBookData).not.toHaveBeenCalled();
    });

    it("resolveDataset rejects on fetch failure, leaving pending set (retryable)", async () => {
      useApp.setState({
        datasets: [
          {
            id: "d1",
            name: "book.opj",
            data: previewData,
            pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5000, cols: 1 },
          },
        ],
      });
      vi.mocked(fetchBookData).mockRejectedValue(new Error("network down"));
      await expect(useApp.getState().resolveDataset("d1")).rejects.toThrow("network down");
      expect(useApp.getState().datasets[0].pending).toBeDefined();
    });

    it("resolveDatasets resolves every pending id with bounded concurrency and drops unknown ids", async () => {
      useApp.setState({
        datasets: [
          { id: "d1", name: "a", data: raw },
          {
            id: "d2",
            name: "book.opj",
            data: previewData,
            pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 5000, cols: 1 },
          },
        ],
      });
      vi.mocked(fetchBookData).mockResolvedValue(raw);
      const out = await useApp.getState().resolveDatasets(["d1", "d2", "ghost"]);
      expect(out.map((d) => d.id)).toEqual(["d1", "d2"]);
      expect(useApp.getState().datasets.find((d) => d.id === "d2")!.pending).toBeUndefined();
    });

    it("resolveDatasets rejects if any fetch fails", async () => {
      useApp.setState({
        datasets: [
          {
            id: "ok",
            name: "ok",
            data: previewData,
            pending: { kind: "path", path: "/ok.opj", bookId: "BookOK", rows: 10, cols: 1 },
          },
          {
            id: "bad",
            name: "bad",
            data: previewData,
            pending: { kind: "path", path: "/bad.opj", bookId: "BookBad", rows: 10, cols: 1 },
          },
        ],
      });
      vi.mocked(fetchBookData).mockImplementation(async (source) =>
        source.bookId === "BookBad" ? Promise.reject(new Error("gone")) : raw,
      );
      await expect(useApp.getState().resolveDatasets(["ok", "bad"])).rejects.toThrow("gone");
    });
  });

  describe("mergeSelected resolves pending picks first (#38)", () => {
    it("resolves a still-pending selected dataset before merging", async () => {
      useApp.setState({
        datasets: [
          { id: "d1", name: "a", data: raw },
          {
            id: "d2",
            name: "book.opj",
            data: previewData,
            pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 3, cols: 1 },
          },
        ],
        selectedIds: ["d1", "d2"],
        status: "",
      });
      vi.mocked(fetchBookData).mockResolvedValue(raw);

      await useApp.getState().mergeSelected();

      expect(useApp.getState().datasets.find((d) => d.id === "d2")!.pending).toBeUndefined();
      const merged = useApp.getState().datasets.find((d) => d.name.startsWith("merged"));
      expect(merged).toBeDefined();
      expect(merged!.data.time.length).toBe(raw.time.length * 2); // both sides used the FULL 3-row data
    });

    it("a pending-resolve failure aborts the merge — no partial merged dataset lands", async () => {
      useApp.setState({
        datasets: [
          { id: "d1", name: "a", data: raw },
          {
            id: "d2",
            name: "book.opj",
            data: previewData,
            pending: { kind: "path", path: "/p.opj", bookId: "Book2", rows: 3, cols: 1 },
          },
        ],
        selectedIds: ["d1", "d2"],
        status: "",
      });
      vi.mocked(fetchBookData).mockRejectedValue(new Error("network down"));

      await useApp.getState().mergeSelected();

      expect(useApp.getState().datasets.some((d) => d.name.startsWith("merged"))).toBe(false);
      expect(useApp.getState().status).toContain("network down");
    });
  });
});

describe("useApp importFilesAppended (gap #47 — multi-file append import)", () => {
  const fakeFile = (name: string, size = 10) => new File(["x".repeat(size)], name);

  // A failed/mismatched append degrades to importFiles, which re-uploads every
  // file from scratch — so uploadFile is called MORE than once per file on
  // that path. Key the mock off the filename (not call order) so it behaves
  // the same on the append attempt and the fallback retry. (Deliberately no
  // local beforeEach calling .mockReset()/.mockClear() on this hoisted
  // vi.mock() function — the top-of-file beforeEach's vi.clearAllMocks()
  // already resets call state, and re-resetting here breaks a subsequently
  // assigned .mockImplementation() under this project's toolchain.)

  it("requires ≥2 files", async () => {
    await useApp.getState().importFilesAppended([fakeFile("a.dat")]);
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("uploads every file and concatenates them row-wise into ONE dataset", async () => {
    const a: DataStruct = { time: [1, 2], values: [[10], [20]], labels: ["m"], units: ["emu"], metadata: {} };
    const b: DataStruct = { time: [3, 4], values: [[30], [40]], labels: ["m"], units: ["emu"], metadata: {} };
    const c: DataStruct = { time: [5], values: [[50]], labels: ["m"], units: ["emu"], metadata: {} };
    vi.mocked(uploadFile)
      .mockResolvedValueOnce(a)
      .mockResolvedValueOnce(b)
      .mockResolvedValueOnce(c);

    await useApp.getState().importFilesAppended([
      fakeFile("day1.dat"),
      fakeFile("day2.dat"),
      fakeFile("day3.dat"),
    ]);

    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(1); // one appended dataset, not three
    expect(ds[0].data.time).toEqual([1, 2, 3, 4, 5]);
    expect(ds[0].data.values).toEqual([[10], [20], [30], [40], [50]]);
    expect(ds[0].data.metadata.merged_from).toBe("day1.dat + day2.dat + day3.dat");
    expect(ds[0].data.metadata.merged_count).toBe(3);
    expect(useApp.getState().status).toContain("appended 3 files");
  });

  it("degrades to separate imports (with a toast) on a column-count mismatch", async () => {
    const narrow: DataStruct = { time: [1], values: [[1]], labels: ["m"], units: ["emu"], metadata: {} };
    const wide: DataStruct = {
      time: [2],
      values: [[2, 3]],
      labels: ["m", "T"],
      units: ["emu", "K"],
      metadata: {},
    };
    vi.mocked(uploadFile).mockImplementation(async (file: File) =>
      file.name === "a.dat" ? narrow : wide,
    );

    await useApp.getState().importFilesAppended([fakeFile("a.dat"), fakeFile("b.dat")]);

    // mismatch falls back to importFiles: N separate datasets, never a dead import.
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(2);
    expect(ds.map((d) => d.name)).toEqual(["a.dat", "b.dat"]);
  });

  it("degrades to separate imports when a file is a multi-workbook Origin project", async () => {
    const plain: DataStruct = { time: [1], values: [[1]], labels: ["m"], units: ["emu"], metadata: {} };
    const bookish = (short: string) => ({ ...plain, metadata: { origin_book: short } });
    vi.mocked(uploadFile).mockImplementation(async (file: File) =>
      file.name === "a.dat" ? plain : { ...plain, books: [bookish("Book1"), bookish("Book2")] },
    );

    await useApp.getState().importFilesAppended([fakeFile("a.dat"), fakeFile("Proj.opj")]);

    // falls back to importFiles, which fans the project out into its own books.
    const st = useApp.getState();
    expect(st.datasets.map((d) => d.name)).toEqual(["a.dat", "Proj:Book1", "Proj:Book2"]);
  });

  it("surfaces a per-file upload failure and degrades to separate imports", async () => {
    const ok: DataStruct = { time: [1], values: [[1]], labels: ["m"], units: ["emu"], metadata: {} };
    vi.mocked(uploadFile).mockImplementation(async (file: File) => {
      if (file.name === "bad.zzz") throw new Error("unknown format");
      return ok;
    });

    await useApp.getState().importFilesAppended([fakeFile("bad.zzz"), fakeFile("good.dat")]);

    const st = useApp.getState();
    expect(st.datasets).toHaveLength(1); // only the file that succeeded on retry
    expect(st.datasets[0].name).toBe("good.dat");
  });
});

describe("useApp pasteDataFromClipboard (gap #47 — structured clipboard paste)", () => {
  const readText = vi.fn();

  // readText is a plain local vi.fn() (not from the hoisted vi.mock()
  // factory), so resetting it directly is safe; guessImportSettings /
  // parseImportText ARE from that factory — every test that exercises them
  // sets a fresh .mockResolvedValue()/.mockRejectedValue() itself, so they
  // don't need (and deliberately don't get) a reset here.
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText },
      configurable: true,
    });
    readText.mockReset();
  });

  it("reads the clipboard and imports it through the guess/parse text engine", async () => {
    readText.mockResolvedValue("x\ty\n1\t2\n3\t4\n");
    vi.mocked(guessImportSettings).mockResolvedValue({ delimiter: "\t" });
    const parsed: DataStruct = {
      time: [1, 3],
      values: [[2], [4]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    vi.mocked(parseImportText).mockResolvedValue(parsed);

    await useApp.getState().pasteDataFromClipboard();

    expect(guessImportSettings).toHaveBeenCalledWith("x\ty\n1\t2\n3\t4\n");
    expect(parseImportText).toHaveBeenCalledWith("x\ty\n1\t2\n3\t4\n", { delimiter: "\t" });
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(1);
    expect(ds[0].name).toBe("pasted data 1");
    expect(ds[0].data).toEqual(parsed);
    expect(useApp.getState().status).toContain("pasted data 1");
  });

  it("names successive pastes pasted data 1, 2, …", async () => {
    readText.mockResolvedValue("x\n1\n2\n");
    vi.mocked(guessImportSettings).mockResolvedValue({});
    const parsed: DataStruct = { time: [1, 2], values: [[1], [2]], labels: ["x"], units: [""], metadata: {} };
    vi.mocked(parseImportText).mockResolvedValue(parsed);

    await useApp.getState().pasteDataFromClipboard();
    await useApp.getState().pasteDataFromClipboard();

    const names = useApp.getState().datasets.map((d) => d.name);
    expect(names.at(-2)).toMatch(/^pasted data \d+$/);
    expect(names.at(-1)).toMatch(/^pasted data \d+$/);
    expect(names.at(-1)).not.toBe(names.at(-2));
  });

  it("surfaces a status message and adds nothing when the clipboard is empty", async () => {
    readText.mockResolvedValue("   ");
    const before = useApp.getState().datasets.length;

    await useApp.getState().pasteDataFromClipboard();

    expect(useApp.getState().datasets).toHaveLength(before);
    expect(useApp.getState().status).toMatch(/empty/i);
  });

  it("surfaces a status message when the clipboard read is denied", async () => {
    readText.mockRejectedValue(new Error("permission denied"));
    const before = useApp.getState().datasets.length;

    await useApp.getState().pasteDataFromClipboard();

    expect(useApp.getState().datasets).toHaveLength(before);
    expect(useApp.getState().status).toMatch(/clipboard/i);
  });

  it("surfaces the backend's error message and adds nothing on a parse failure", async () => {
    readText.mockResolvedValue("garbage");
    vi.mocked(guessImportSettings).mockResolvedValue({});
    vi.mocked(parseImportText).mockRejectedValue(new Error("no data rows found"));
    const before = useApp.getState().datasets.length;

    await useApp.getState().pasteDataFromClipboard();

    expect(useApp.getState().datasets).toHaveLength(before);
    expect(useApp.getState().status).toBe("no data rows found");
  });
});

describe("useApp applyOriginFigure (item 18)", () => {
  const figureEntry = {
    id: "fig-XRD-0",
    stem: "XRD",
    datasetId: "d2",
    siblingIds: ["d2"],
    figure: {
      name: "Graph1",
      x_from: 18,
      x_to: 100,
      x_log: false,
      y_from: 1,
      y_to: 1e6,
      y_log: true,
      n_curves: 3,
      annotations: [] as string[],
    },
  };

  beforeEach(() => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "XRD:Book1", data: raw },
        { id: "d2", name: "XRD:Book2", data: raw },
      ],
      activeId: "d1",
      originFigures: [figureEntry],
      xLim: null,
      yLim: null,
      xScale: "linear",
      yScale: "linear",
      showGrid: true, // precondition: user default grid ON
      showAxisBox: false,
    });
  });

  it("activates the resolved dataset and applies the axis/log snapshot", () => {
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
    expect(s.xLim).toEqual([18, 100]);
    expect(s.yLim).toEqual([1, 1e6]);
    expect(s.xScale).toBe("linear");
    expect(s.yScale).toBe("log");
  });

  it("boxes the axes and turns OFF gridlines (Origin has none; grid undecodable)", () => {
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.showAxisBox).toBe(true);
    expect(s.showGrid).toBe(false);
  });

  it("applies the static legend + decoded legend title (decode #52)", () => {
    useApp.setState({
      originFigures: [{ ...figureEntry, figure: { ...figureEntry.figure, legend_title: "Nb/Au" } }],
    });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.legendStatic).toBe(true);
    expect(s.legendTitle).toBe("Nb/Au");
  });

  it("clears a stale legend title when the applied figure has none", () => {
    useApp.setState({ legendTitle: "Old title" });
    useApp.getState().applyOriginFigure("fig-XRD-0"); // figureEntry carries no legend_title
    expect(useApp.getState().legendStatic).toBe(true);
    expect(useApp.getState().legendTitle).toBeNull();
  });

  it("applies the faithful in-frame legend anchor (decode #52)", () => {
    // legend_pos at x=59 (fx 0.5 in [18,100]) and y=1e3 (log half in [1,1e6],
    // so fy 0.5 down from the top) -> box top-left at the frame centre.
    useApp.setState({
      originFigures: [{ ...figureEntry, figure: { ...figureEntry.figure, legend_pos: { x: 59, y: 1e3 } } }],
    });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    expect(useApp.getState().legendFrameXY).toEqual([0.5, 0.5]);
  });

  it("clears a stale frame anchor when the applied figure has no in-frame position", () => {
    useApp.setState({ legendFrameXY: [0.3, 0.3] });
    useApp.getState().applyOriginFigure("fig-XRD-0"); // figureEntry has no legend_pos
    expect(useApp.getState().legendFrameXY).toBeNull();
  });

  it("resolves every pending cross-book source before materializing an overlay (#48)", async () => {
    const preview = (book: string): DataStruct => ({
      time: [0],
      values: [[-1]],
      labels: ["signal"],
      units: ["a.u."],
      metadata: { origin_book: book, origin_column_names: ["B"], x_column_name: "A" },
    });
    const full = (book: string, time: number[], values: number[]): DataStruct => ({
      time,
      values: values.map((v) => [v]),
      labels: ["signal"],
      units: ["a.u."],
      metadata: { origin_book: book, origin_column_names: ["B"], x_column_name: "A" },
    });
    useApp.setState({
      datasets: [
        {
          id: "book-a",
          name: "P:BookA",
          data: preview("BookA"),
          pending: { kind: "path", path: "/p.opj", bookId: "BookA", rows: 3, cols: 1 },
        },
        {
          id: "book-b",
          name: "P:BookB",
          data: preview("BookB"),
          pending: { kind: "path", path: "/p.opj", bookId: "BookB", rows: 2, cols: 1 },
        },
      ],
      activeId: "book-a",
      originFigures: [
        {
          id: "fig-cross-book",
          stem: "P",
          datasetId: "book-a",
          siblingIds: ["book-a", "book-b"],
          figure: {
            ...figureEntry.figure,
            curves: [
              { book: "BookA", x: "A", y: "B" },
              { book: "BookB", x: "A", y: "B" },
            ],
          },
        },
      ],
    });
    vi.mocked(fetchBookData).mockImplementation(async (source) =>
      source.bookId === "BookA"
        ? full("BookA", [1, 2, 3], [10, 20, 30])
        : full("BookB", [4, 5], [40, 50]),
    );

    useApp.getState().applyOriginFigure("fig-cross-book");
    expect(useApp.getState().datasets).toHaveLength(2); // no preview overlay

    await vi.waitFor(() => {
      expect(fetchBookData).toHaveBeenCalledTimes(2);
      expect(useApp.getState().datasets).toHaveLength(3);
    });
    const overlay = useApp
      .getState()
      .datasets.find((d) => d.data.metadata.origin_overlay === true);
    expect(overlay?.data.time).toEqual([1, 2, 3, 4, 5]);
    expect(overlay?.data.values).toEqual([
      [10, NaN],
      [20, NaN],
      [30, NaN],
      [NaN, 40],
      [NaN, 50],
    ]);
    expect(useApp.getState().datasets.filter((d) => d.pending)).toHaveLength(0);
  });

  // #57: re-applying rebuilds the existing overlay from source, clearing any
  // row/column-indexed edits on it — so a re-apply that would actually
  // discard something asks first. The shared `source`/overlay-fixture shape
  // is reused (with small variations) by the confirm-guard tests below.
  const staleOverlaySetup = () => {
    const source = (id: string, book: string, x: number, y: number): Dataset => ({
      id, name: `P:${book}`,
      data: {
        time: [x], values: [[y]], labels: ["signal"], units: [""],
        metadata: { origin_book: book, origin_column_names: ["B"], x_column_name: "A" },
      },
    });
    useApp.setState({
      datasets: [
        source("a", "BookA", 1, 10),
        source("b", "BookB", 2, 20),
        {
          id: "old-overlay", name: "stale",
          notes: "keep this note", tags: ["reviewed"], folderId: "origin", order: 7,
          raw: {
            time: [998], values: [[998]], labels: ["older"], units: [""], metadata: {},
          },
          corrections: { xOff: 1 },
          excludedRows: [0],
          filter: [{ col: -1, kind: "range", min: 900 }],
          formulas: [{ name: "stale formula", expr: "x" }],
          data: {
            time: [999], values: [[999]], labels: ["wrong"], units: [""],
            metadata: { origin_overlay: true, origin_overlay_source: "fig-stale" },
          },
        },
      ],
      originFigures: [{
        id: "fig-stale", stem: "P", datasetId: "a", siblingIds: ["a", "b"],
        figure: {
          ...figureEntry.figure,
          curves: [
            { book: "BookA", x: "A", y: "B" },
            { book: "BookB", x: "A", y: "B" },
          ],
        },
      }],
    });
  };

  it("first-ever apply never asks (no existing overlay to lose edits from)", () => {
    // "resolves every pending cross-book source..." above already covers the
    // lazy-book variant of a first apply; this is the plain synchronous one.
    useApp.getState().applyOriginFigure("fig-XRD-0");
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("re-applying an edit-free overlay never asks and rebuilds immediately", () => {
    staleOverlaySetup();
    useApp.setState({
      datasets: useApp.getState().datasets.map((d) =>
        d.id === "old-overlay"
          ? { id: d.id, name: d.name, data: d.data } // strip every edit field
          : d,
      ),
    });

    useApp.getState().applyOriginFigure("fig-stale");

    expect(askConfirm).not.toHaveBeenCalled();
    const overlay = useApp.getState().datasets.find((d) => d.id === "old-overlay");
    expect(overlay?.data.time).toEqual([1, 2]); // rebuilt synchronously
  });

  it("re-apply with edits: asks, then rebuilds on confirm, clearing edit fields but preserving id/notes/tags/folder/order (#57)", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    staleOverlaySetup();

    useApp.getState().applyOriginFigure("fig-stale");

    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(askConfirm).toHaveBeenCalledWith(
      "Re-apply Origin figure?",
      // corrections, 1 formula, row filter, excluded rows -- this overlay set
      // no fitSpec, so "fit" is correctly absent from the list.
      '"stale" has user edits that will be discarded: corrections, 1 formula, row filter, excluded rows.',
      "Re-apply",
      true,
    );
    // Nothing rebuilt yet -- still awaiting the confirm promise to resolve.
    expect(useApp.getState().datasets.find((d) => d.id === "old-overlay")?.data.time).toEqual([999]);

    await vi.waitFor(() => {
      const overlay = useApp.getState().datasets.find((d) => d.id === "old-overlay");
      expect(overlay?.data.time).toEqual([1, 2]);
    });

    const overlays = useApp.getState().datasets.filter(
      (d) => d.data.metadata.origin_overlay_source === "fig-stale",
    );
    expect(overlays).toHaveLength(1);
    expect(overlays[0].id).toBe("old-overlay");
    expect(overlays[0].data.values).toEqual([[10, NaN], [NaN, 20]]);
    expect(overlays[0].data.metadata.origin_overlay_version).toBe(2);
    expect(overlays[0]).toMatchObject({
      notes: "keep this note", tags: ["reviewed"], folderId: "origin", order: 7,
    });
    expect(overlays[0].raw).toBeUndefined();
    expect(overlays[0].corrections).toBeUndefined();
    expect(overlays[0].excludedRows).toBeUndefined();
    expect(overlays[0].filter).toBeUndefined();
    expect(overlays[0].formulas).toBeUndefined();
  });

  it("re-apply with edits: user cancels -> zero state changes (no rebuild, no window, no status, nothing touched) (#57)", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    staleOverlaySetup();
    useApp.setState({ status: "" });
    const before = useApp.getState();

    useApp.getState().applyOriginFigure("fig-stale");
    expect(askConfirm).toHaveBeenCalledTimes(1);

    // Flush the resolved-false promise chain; nothing should change.
    await new Promise((r) => setTimeout(r, 0));

    const after = useApp.getState();
    expect(after.datasets).toBe(before.datasets); // same array reference -> no set() ran
    expect(after.plotWindows).toBe(before.plotWindows);
    expect(after.status).toBe(before.status);
    expect(after.annotations).toBe(before.annotations);
  });

  it("a stale confirmed re-apply never clobbers a newer apply issued while its dialog was open (#57)", async () => {
    let resolveConfirm!: (ok: boolean) => void;
    vi.mocked(askConfirm).mockImplementation(
      () => new Promise((res) => { resolveConfirm = res; }),
    );
    staleOverlaySetup();
    useApp.setState({
      datasets: [
        ...useApp.getState().datasets,
        { id: "d3", name: "XRD:Book3", data: raw },
      ],
      originFigures: [
        ...useApp.getState().originFigures,
        { id: "fig-simple", stem: "XRD", datasetId: "d3", siblingIds: ["d3"], figure: figureEntry.figure },
      ],
    });

    // A's re-apply asks and waits (dialog open, unresolved).
    useApp.getState().applyOriginFigure("fig-stale");
    expect(askConfirm).toHaveBeenCalledTimes(1);

    // The user applies a DIFFERENT (edit-free) figure before answering A's dialog.
    useApp.getState().applyOriginFigure("fig-simple");
    expect(useApp.getState().activeId).toBe("d3");

    // A's dialog now resolves "confirm" -- too late, B already won.
    resolveConfirm(true);
    await new Promise((r) => setTimeout(r, 0));

    expect(useApp.getState().activeId).toBe("d3"); // NOT reverted to fig-stale's dataset
    const overlay = useApp.getState().datasets.find((d) => d.id === "old-overlay");
    expect(overlay?.data.time).toEqual([999]); // stale overlay never rebuilt
  });

  it("composes with the pending-book defer path: confirms first, THEN resolves lazy source books (#57)", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    staleOverlaySetup();
    useApp.setState({
      datasets: useApp.getState().datasets.map((d) =>
        d.id === "a" || d.id === "b"
          ? { ...d, pending: { kind: "path" as const, path: "/p.opj", bookId: d.id === "a" ? "BookA" : "BookB", rows: 1, cols: 1 } }
          : d,
      ),
    });
    vi.mocked(fetchBookData).mockImplementation(async (source) =>
      source.bookId === "BookA"
        ? { time: [1, 2], values: [[10], [20]], labels: ["signal"], units: [""], metadata: { origin_book: "BookA", origin_column_names: ["B"], x_column_name: "A" } }
        : { time: [3], values: [[30]], labels: ["signal"], units: [""], metadata: { origin_book: "BookB", origin_column_names: ["B"], x_column_name: "A" } },
    );

    useApp.getState().applyOriginFigure("fig-stale");

    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(fetchBookData).not.toHaveBeenCalled(); // confirm gate ran BEFORE any source fetch

    await vi.waitFor(() => {
      expect(fetchBookData).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      const overlay = useApp.getState().datasets.find((d) => d.id === "old-overlay");
      expect(overlay?.data.time).toEqual([1, 2, 3]);
    });
    const overlay = useApp.getState().datasets.find((d) => d.id === "old-overlay");
    expect(overlay?.corrections).toBeUndefined();
  });

  it("does not create a partial overlay when one Origin source book fails (#48)", async () => {
    const preview = (book: string): DataStruct => ({
      time: [0],
      values: [[-1]],
      labels: ["signal"],
      units: [""],
      metadata: { origin_book: book, origin_column_names: ["B"], x_column_name: "A" },
    });
    useApp.setState({
      datasets: [
        {
          id: "book-a",
          name: "P:BookA",
          data: preview("BookA"),
          pending: { kind: "path", path: "/p.opj", bookId: "BookA", rows: 3, cols: 1 },
        },
        {
          id: "book-b",
          name: "P:BookB",
          data: preview("BookB"),
          pending: { kind: "path", path: "/p.opj", bookId: "BookB", rows: 3, cols: 1 },
        },
      ],
      originFigures: [
        {
          id: "fig-cross-book",
          stem: "P",
          datasetId: "book-a",
          siblingIds: ["book-a", "book-b"],
          figure: {
            ...figureEntry.figure,
            curves: [
              { book: "BookA", x: "A", y: "B" },
              { book: "BookB", x: "A", y: "B" },
            ],
          },
        },
      ],
    });
    vi.mocked(fetchBookData).mockImplementation(async (source) => {
      if (source.bookId === "BookB") throw new Error("book unavailable");
      return raw;
    });

    useApp.getState().applyOriginFigure("fig-cross-book");

    await vi.waitFor(() =>
      expect(useApp.getState().status).toBe("couldn't apply Origin figure — book unavailable"),
    );
    expect(useApp.getState().datasets).toHaveLength(2);
    expect(useApp.getState().datasets.some((d) => d.data.metadata.origin_overlay === true)).toBe(false);
  });

  it("does not apply a stale figure after a newer lazy-book request wins (#48)", async () => {
    let resolveA!: (value: DataStruct) => void;
    let resolveB!: (value: DataStruct) => void;
    const waitA = new Promise<DataStruct>((resolve) => {
      resolveA = resolve;
    });
    const waitB = new Promise<DataStruct>((resolve) => {
      resolveB = resolve;
    });
    const pending = (book: string): Dataset => ({
      id: book,
      name: book,
      data: { ...raw, metadata: { origin_book: book } },
      pending: { kind: "path", path: "/p.opj", bookId: book, rows: 3, cols: 1 },
    });
    useApp.setState({
      datasets: [pending("BookA"), pending("BookB")],
      activeId: "BookA",
      originFigures: [
        {
          ...figureEntry,
          id: "fig-a",
          datasetId: "BookA",
          siblingIds: ["BookA", "BookB"],
          figure: { ...figureEntry.figure, name: "GraphA", y_from: 10, y_to: 20 },
        },
        {
          ...figureEntry,
          id: "fig-b",
          datasetId: "BookB",
          siblingIds: ["BookA", "BookB"],
          figure: { ...figureEntry.figure, name: "GraphB", y_from: 30, y_to: 40 },
        },
      ],
    });
    vi.mocked(fetchBookData).mockImplementation((source) =>
      source.bookId === "BookA" ? waitA : waitB,
    );

    useApp.getState().applyOriginFigure("fig-a");
    useApp.getState().applyOriginFigure("fig-b");
    resolveB(raw);
    await vi.waitFor(() => expect(useApp.getState().yLim).toEqual([30, 40]));

    resolveA(raw);
    await waitA;
    await Promise.resolve();
    expect(useApp.getState().activeId).toBe("BookB");
    expect(useApp.getState().yLim).toEqual([30, 40]);
  });

  // Owner-routing item 4 ("none of the sub plots are boxed in"): Origin
  // draws every layer with a full 4-side frame, and the decoded figure
  // carries no separate border on/off flag — so an applied figure defaults
  // to boxed, even when the user had previously turned it off for a native
  // (non-Origin) plot.
  it("defaults showAxisBox on (item 4) — Origin layers are boxed unless a native plot turned it off first", () => {
    useApp.setState({ showAxisBox: false });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    expect(useApp.getState().showAxisBox).toBe(true);
  });

  // Owner-routing item 1 ("have to remember to toggle up"): applying a
  // figure is always plot-intent, so it must surface the Plot tab even when
  // the user was parked on Worksheet or Map beforehand.
  it("forces the Plot tab (item 1) even when the user was on the Worksheet tab", () => {
    useApp.setState({ stageTab: "worksheet" });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  // Fix #2: Origin's decoded major-tick increment threads through to xStep/
  // yStep (consumed by lib/uplotOpts.fixedLogAxisSplits for a fixed log range).
  it("carries the figure's decoded x_step/y_step, and clears them when absent", () => {
    useApp.setState({
      originFigures: [
        { ...figureEntry, figure: { ...figureEntry.figure, x_step: 10, y_step: 0.1 } },
      ],
      xStep: 999, // stale from a prior apply
      yStep: 999,
    });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    expect(useApp.getState().xStep).toBe(10);
    expect(useApp.getState().yStep).toBe(0.1);

    // Re-applying a figure with NO decoded step must clear the stale value,
    // never leave the previous figure's step behind.
    useApp.setState({ originFigures: [figureEntry] });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    expect(useApp.getState().xStep).toBeNull();
    expect(useApp.getState().yStep).toBeNull();
  });

  it("setXLim/setYLim clear a stale decoded step (a manual range is not the Origin figure that produced it)", () => {
    useApp.setState({ xStep: 5, yStep: 7 });
    useApp.getState().setXLim([0, 1]);
    useApp.getState().setYLim([0, 1]);
    expect(useApp.getState().xStep).toBeNull();
    expect(useApp.getState().yStep).toBeNull();
  });

  it("applies Origin's decoded axis titles to the axis labels", () => {
    useApp.setState({
      originFigures: [
        {
          ...figureEntry,
          figure: {
            ...figureEntry.figure,
            x_title: "2θ (°)",
            y_title: "Intensity (arb. units)",
          },
        },
      ],
      xAxisLabel: "stale",
      yAxisLabel: "stale",
    });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.xAxisLabel).toBe("2θ (°)");
    expect(s.yAxisLabel).toBe("Intensity (arb. units)");
  });

  it("resets axis labels to auto ('') when the figure carries no titles", () => {
    useApp.setState({ xAxisLabel: "stale", yAxisLabel: "stale" });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.xAxisLabel).toBe("");
    expect(s.yAxisLabel).toBe("");
  });

  it("is a no-op for an unresolved figure", () => {
    useApp.setState({ originFigures: [{ ...figureEntry, datasetId: null }] });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.activeId).toBe("d1"); // unchanged
    expect(s.xLim).toBeNull();
  });

  it("is a no-op for an unknown figure id", () => {
    useApp.getState().applyOriginFigure("nope");
    expect(useApp.getState().activeId).toBe("d1");
  });

  it("pins the figure's positioned annotation_marks as plot annotations", () => {
    useApp.setState({
      originFigures: [
        {
          ...figureEntry,
          figure: {
            ...figureEntry.figure,
            annotation_marks: [
              { text: "Field applied in-plane\nT = 1.3 K", x: -5.311, y: 0.4915 },
            ],
          },
        },
      ],
      annotations: [{ id: "stale", x: 0, y: 0, text: "from a previous figure" }],
    });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const anns = useApp.getState().annotations;
    expect(anns).toHaveLength(1); // REPLACED the stale one, not appended
    expect(anns[0].text).toBe("Field applied in-plane\nT = 1.3 K");
    expect(anns[0].x).toBeCloseTo(-5.311);
    expect(anns[0].y).toBeCloseTo(0.4915);
  });

  it("re-applying the same figure never stacks its marks", () => {
    useApp.setState({
      originFigures: [
        {
          ...figureEntry,
          figure: {
            ...figureEntry.figure,
            annotation_marks: [{ text: "T = 1.3 K", x: 1, y: 2 }],
          },
        },
      ],
    });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    useApp.getState().applyOriginFigure("fig-XRD-0");
    expect(useApp.getState().annotations).toHaveLength(1);
  });

  it("a figure without marks clears previously pinned annotations", () => {
    useApp.setState({
      annotations: [{ id: "old", x: 5, y: 5, text: "left over" }],
    });
    useApp.getState().applyOriginFigure("fig-XRD-0"); // figureEntry has no marks
    expect(useApp.getState().annotations).toEqual([]);
  });
});

describe("useApp applyOriginFigure — double-Y (2-layer window, both layers -> same dataset)", () => {
  const doubleYData: DataStruct = {
    time: [1, 2, 3],
    values: [
      [10, 100, 1000],
      [20, 200, 2000],
      [30, 300, 3000],
    ],
    labels: ["ch0", "ch1", "ch2"],
    units: ["", "", ""],
    metadata: {
      origin_book: "Book2",
      x_column_name: "A",
      origin_column_names: ["B", "C", "D"], // -> value channels 0, 1, 2
    },
  };

  const layer1 = {
    id: "fig-XRD-0",
    stem: "XRD",
    datasetId: "d2",
    siblingIds: ["d2"],
    figure: {
      name: "Graph7",
      layer: 1,
      x_from: 0,
      x_to: 10,
      x_log: false,
      y_from: 0,
      y_to: 50,
      y_log: false,
      n_curves: 1,
      annotations: [] as string[],
      curves: [{ book: "Book2", x: "A", y: "B" }],
    },
  };
  const layer2 = {
    id: "fig-XRD-1",
    stem: "XRD",
    datasetId: "d2",
    siblingIds: ["d2"],
    figure: {
      name: "Graph7",
      layer: 2,
      x_from: 0,
      x_to: 10,
      x_log: false,
      y_from: 0,
      y_to: 5000,
      y_log: false,
      y_title: "Counts",
      n_curves: 2,
      annotations: [] as string[],
      curves: [
        { book: "Book2", x: "A", y: "C" },
        { book: "Book2", x: "A", y: "D" },
      ],
    },
  };

  beforeEach(() => {
    useApp.setState({
      datasets: [{ id: "d2", name: "XRD:Book2", data: doubleYData }],
      activeId: null,
      originFigures: [layer1, layer2],
      xLim: null,
      yLim: null,
      xScale: "linear",
      yScale: "linear",
      yKeys: null,
      y2Keys: null,
    });
  });

  it("applying layer 1 plots the UNION of both layers, y2Keys tags layer 2's on the right", () => {
    useApp.setState({ showAxisBox: false });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
    // Item 4: a double-Y apply is still an Origin layer — boxed by default.
    expect(s.showAxisBox).toBe(true);
    // yKeys is the union (layer 1 first, then layer 2) so layer-2 curves render;
    // y2Keys tags which of them sit on the right axis. effectiveChannels (the
    // real plotted set) derives from yKeys, so it must include 1 and 2.
    expect(s.yKeys).toEqual([0, 1, 2]);
    expect(s.y2Keys).toEqual([1, 2]);
    expect(effectiveChannels(doubleYData, s.yKeys, s.xKey)).toEqual([0, 1, 2]);
    expect(s.xLim).toEqual([0, 10]);
    expect(s.yLim).toEqual([0, 50]); // layer 1's own range, not layer 2's
    // 13.2 #6: layer 2's own axis state reaches the secondary axis
    expect(s.y2Lim).toEqual([0, 5000]);
    expect(s.y2Scale).toBe("linear");
    // W4 #37: layer 2's decoded title becomes the y2 axis label override
    expect(s.y2AxisLabel).toBe("Counts");
  });

  // Fixes #2 + #4: lower layer drives xStep/yStep, upper layer drives y2Step;
  // both layers' decoded legend labels merge into one seriesLabels map.
  it("merges xStep/yStep (from the lower layer) + y2Step (from the upper layer) + both layers' legend labels", () => {
    useApp.setState({
      originFigures: [
        { ...layer1, figure: { ...layer1.figure, x_step: 2, y_step: 5, legend_labels: ["ZFC"] } },
        { ...layer2, figure: { ...layer2.figure, y_step: 500, legend_labels: ["FC", "Difference"] } },
      ],
    });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.xStep).toBe(2);
    expect(s.yStep).toBe(5);
    expect(s.y2Step).toBe(500);
    // channel 0 <- layer1 curve "B"; channels 1,2 <- layer2 curves "C","D".
    expect(s.seriesLabels).toEqual({ 0: "ZFC", 1: "FC", 2: "Difference" });
  });

  it("applying layer 2 (the other entry) offers the same combined view", () => {
    useApp.getState().applyOriginFigure("fig-XRD-1");
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
    expect(s.yKeys).toEqual([0, 1, 2]); // union, layer 1 first ...
    expect(s.y2Keys).toEqual([1, 2]); // ... and layer 2 tagged onto y2
    expect(s.yLim).toEqual([0, 50]); // axes always come from the lower layer
  });

  it("falls back to the clicked layer's own single-axis view when a selection can't be mapped", () => {
    useApp.setState({
      originFigures: [
        layer1,
        { ...layer2, figure: { ...layer2.figure, curves: [{ book: "Elsewhere", x: "A", y: "C" }] } },
      ],
    });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
    expect(s.yKeys).toEqual([0]); // layer 1's own selection, applied directly
    expect(s.y2Keys).toBeNull(); // no combined view — partner selection failed
  });

  it("does not COMBINE (Y/Y2) when the two layers resolve to different datasets — arranges a spatial multi-panel instead (item 4, decode-plan #36)", () => {
    useApp.setState({
      datasets: [
        { id: "d2", name: "XRD:Book2", data: doubleYData },
        { id: "d3", name: "XRD:Book3", data: doubleYData },
      ],
      originFigures: [layer1, { ...layer2, datasetId: "d3" }],
      stackMode: false,
      spatialPanels: null,
    });
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    // The Y/Y2 combine mechanism requires the SAME resolved dataset — it did
    // not fire here (both layers resolved, just to different datasets), so
    // this is NOT the "falls back to a single layer" case either: with 2
    // layers that both resolve to a dataset + channels, the multi-panel
    // spatial apply takes over instead.
    expect(s.y2Keys).toBeNull();
    expect(s.stackMode).toBe(true);
    expect(s.spatialPanels).toHaveLength(2);
    // No decoded frame geometry on either layer -> the ordinal single-column
    // fallback stack (layer 1 first, per figureLayerFamily's layer-ascending
    // sort), each panel keeping its OWN layer's dataset/channels/ranges.
    expect(s.spatialPanels?.[0]).toMatchObject({
      datasetId: "d2",
      xKey: null,
      yKeys: [0],
      xLim: [0, 10],
      yLim: [0, 50],
      row: 0,
      col: 0,
    });
    expect(s.spatialPanels?.[1]).toMatchObject({
      datasetId: "d3",
      xKey: null,
      yKeys: [1, 2],
      xLim: [0, 10],
      yLim: [0, 5000],
      yAxisLabel: "Counts",
      row: 1,
      col: 0,
    });
  });
});

describe("useApp applyOriginFigure — spatial multi-panel (decode-plan #36, item 4)", () => {
  const chData = (book: string): DataStruct => ({
    time: [0, 1, 2],
    values: [[1], [2], [3]],
    labels: ["ch0"],
    units: [""],
    metadata: { origin_book: book, x_column_name: "A", origin_column_names: ["B"] },
  });

  interface Frame {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  const mkEntry = (
    id: string,
    layer: number,
    datasetId: string | null,
    book: string,
    frame: Frame | null,
    yRange: [number, number],
  ) => ({
    id,
    stem: "Fixed Lambdas SI",
    datasetId,
    siblingIds: ["p1", "p2", "p3"],
    figure: {
      name: "Graph6",
      layer,
      x_from: 0,
      x_to: 10,
      x_log: false,
      y_from: yRange[0],
      y_to: yRange[1],
      y_log: false,
      n_curves: 1,
      annotations: [] as string[],
      curves: [{ book, x: "A", y: "B" }],
      frame,
    },
  });

  beforeEach(() => {
    useApp.setState({
      datasets: [
        { id: "p1", name: "Fixed Lambdas SI:Book1", data: chData("Book1") },
        { id: "p2", name: "Fixed Lambdas SI:Book2", data: chData("Book2") },
        { id: "p3", name: "Fixed Lambdas SI:Book3", data: chData("Book3") },
      ],
      activeId: null,
      stackMode: false,
      spatialPanels: null,
      originFigures: [],
      originFidelity: [],
    });
  });

  it("arranges a 2-layer stack using real decoded frame geometry ('Fixed Lambdas SI'!Graph6 shape)", () => {
    const top = mkEntry("fig-0", 1, "p1", "Book1", { left: 0, top: 0, right: 995, bottom: 480 }, [0, 100]);
    const bottom = mkEntry("fig-1", 2, "p2", "Book2", { left: 0, top: 520, right: 995, bottom: 990 }, [0, 200]);
    useApp.setState({ originFigures: [top, bottom], showAxisBox: false });
    useApp.getState().applyOriginFigure("fig-0");
    const s = useApp.getState();
    expect(s.stackMode).toBe(true);
    expect(s.spatialPanels).toEqual([
      expect.objectContaining({ datasetId: "p1", row: 0, col: 0, xLim: [0, 10], yLim: [0, 100] }),
      expect.objectContaining({ datasetId: "p2", row: 1, col: 0, xLim: [0, 10], yLim: [0, 200] }),
    ]);
    // Owner-routing item 4: the singleton flag useMultiPanelStage reads for
    // every spatial panel — Origin layers are boxed by default.
    expect(s.showAxisBox).toBe(true);
  });

  it("generalizes past 2 layers: a 3-layer family arranges as a 3-panel ordinal stack (no frame geometry)", () => {
    const l1 = mkEntry("fig-0", 1, "p1", "Book1", null, [0, 1]);
    const l2 = mkEntry("fig-1", 2, "p2", "Book2", null, [0, 2]);
    const l3 = mkEntry("fig-2", 3, "p3", "Book3", null, [0, 3]);
    useApp.setState({ originFigures: [l1, l2, l3] });
    useApp.getState().applyOriginFigure("fig-1"); // clicking the MIDDLE layer's own entry
    const s = useApp.getState();
    expect(s.stackMode).toBe(true);
    expect(s.spatialPanels?.map((p) => [p.datasetId, p.row, p.col])).toEqual([
      ["p1", 0, 0],
      ["p2", 1, 0],
      ["p3", 2, 0],
    ]);
    // The clicked layer's OWN dataset activates, even though it isn't first.
    expect(s.activeId).toBe("p2");
  });

  it("falls back to the clicked layer's own single-layer apply when a family member's dataset never resolved", () => {
    const l1 = mkEntry("fig-0", 1, "p1", "Book1", null, [0, 1]);
    const l2 = mkEntry("fig-1", 2, null, "Book2", null, [0, 2]); // unresolved
    useApp.setState({ originFigures: [l1, l2] });
    useApp.getState().applyOriginFigure("fig-0");
    const s = useApp.getState();
    expect(s.spatialPanels).toBeNull(); // no multi-panel — all-or-nothing resolution failed
    expect(s.stackMode).toBe(false); // untouched — the single-layer tail never turns it on
    expect(s.activeId).toBe("p1"); // clicked layer's own dataset activated instead
    expect(s.yLim).toEqual([0, 1]); // its own axis snapshot, not a panel arrangement
  });

  it("falls back to the clicked layer's own apply when a family member's channel selection is empty", () => {
    const l1 = mkEntry("fig-0", 1, "p1", "Book1", null, [0, 1]);
    const l2 = mkEntry("fig-1", 2, "p2", "Elsewhere", null, [0, 2]); // book mismatch -> no selection
    useApp.setState({ originFigures: [l1, l2] });
    useApp.getState().applyOriginFigure("fig-0");
    const s = useApp.getState();
    expect(s.spatialPanels).toBeNull();
    expect(s.stackMode).toBe(false);
    expect(s.activeId).toBe("p1");
  });
});

describe("useApp facetByColumn (gap #21 residual)", () => {
  const facetData: DataStruct = {
    time: [0, 1, 2, 3, 4, 5],
    values: [
      [1, 10],
      [1, 20],
      [2, 30],
      [2, 40],
      [1, 50],
      [2, 60],
    ],
    labels: ["grp", "y"],
    units: ["", ""],
    metadata: {},
  };

  beforeEach(() => {
    useApp.setState({
      datasets: [{ id: "d1", name: "ds1", data: facetData }],
      activeId: null,
      stackMode: false,
      spatialPanels: null,
      facetPanels: null,
      macroRecording: false,
      macroSteps: [],
    });
  });

  it("builds one panel per distinct level, activates the dataset, and turns on stack mode", () => {
    useApp.getState().facetByColumn("d1", 0);
    const s = useApp.getState();
    expect(s.activeId).toBe("d1");
    expect(s.stackMode).toBe(true);
    expect(s.spatialPanels).toBeNull();
    expect(s.facetPanels).toHaveLength(2);
    expect(s.facetPanels?.map((p) => p.label)).toEqual(["1", "2"]);
  });

  it("clears a prior spatial arrangement", () => {
    useApp.setState({
      spatialPanels: [
        {
          datasetId: "other",
          xKey: null,
          yKeys: [0],
          xLim: [0, 1],
          yLim: [0, 1],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
        },
      ],
    });
    useApp.getState().facetByColumn("d1", 0);
    expect(useApp.getState().spatialPanels).toBeNull();
  });

  it("no-ops (with a toast, no crash) when the dataset is missing", () => {
    useApp.getState().facetByColumn("nope", 0);
    const s = useApp.getState();
    expect(s.facetPanels).toBeNull();
    expect(s.stackMode).toBe(false);
    expect(s.activeId).toBeNull();
  });

  it("no-ops when the column has no finite levels", () => {
    const allNaN: DataStruct = { ...facetData, values: facetData.values.map((r) => [NaN, r[1]]) };
    useApp.setState({ datasets: [{ id: "d1", name: "ds1", data: allNaN }] });
    useApp.getState().facetByColumn("d1", 0);
    const s = useApp.getState();
    expect(s.facetPanels).toBeNull();
    expect(s.stackMode).toBe(false);
  });

  it("no-ops when every row is excluded (guard #11 analysis view is empty)", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "ds1", data: facetData, excludedRows: [0, 1, 2, 3, 4, 5] }],
    });
    useApp.getState().facetByColumn("d1", 0);
    expect(useApp.getState().facetPanels).toBeNull();
  });

  it("honors row exclusion (guard #11) — an excluded row never enters a facet panel", () => {
    // Exclude row 0 (time=0, grp=1, y=10) — level "1"'s remaining rows are 1,4.
    // Pin yKeys to just channel 1 ("y") so data[1] is unambiguous.
    useApp.setState({
      datasets: [{ id: "d1", name: "ds1", data: facetData, excludedRows: [0] }],
      activeId: "d1",
      yKeys: [1],
    });
    useApp.getState().facetByColumn("d1", 0);
    const level1 = useApp.getState().facetPanels?.find((p) => p.label === "1");
    expect(level1?.payload.data[0]).toEqual([1, 4]);
    expect(level1?.payload.data[1]).toEqual([20, 50]);
  });

  it("does NOT carry over the x/y channel selection of a DIFFERENT active dataset", () => {
    // xKey=1 ("y") only makes sense for whatever dataset is currently active;
    // facetByColumn targets d1 while "other" is active, so it must fall back
    // to facetPayloads' own default (x = time) rather than misapplying it.
    useApp.setState({
      datasets: [
        { id: "other", name: "other", data: facetData },
        { id: "d1", name: "ds1", data: facetData },
      ],
      activeId: "other",
      xKey: 1,
      yKeys: [0],
    });
    useApp.getState().facetByColumn("d1", 0);
    const s = useApp.getState();
    expect(s.facetPanels?.[0].payload.xLabel).not.toBe("y");
  });

  it("carries over the current x/y channel selection when the dataset IS already active", () => {
    useApp.setState({ activeId: "d1", xKey: null, yKeys: [1] });
    useApp.getState().facetByColumn("d1", 0);
    const s = useApp.getState();
    expect(s.facetPanels?.[0].payload.series.map((ser) => ser.label)).toEqual(["y"]);
  });

  it("records a macro step while recording", () => {
    useApp.getState().startMacro();
    useApp.getState().facetByColumn("d1", 0);
    const steps = useApp.getState().macroSteps;
    expect(steps).toHaveLength(1);
    expect(steps[0].code).toBe('qz.facetByColumn("d1", 0)');
    expect(steps[0].label).toBe("Facet by grp");
  });
});

describe("useApp breakAtGaps (gap #21 last residual)", () => {
  // time carries a real gap (0..9, then a jump to 60..63); channel 0 is a
  // DELIBERATELY evenly-spaced value column (step 10 throughout) so a test
  // can tell whether breakAtGaps used the right x source (see the
  // carry-over tests below: an evenly-spaced x finds NO qualifying gap).
  const breakData: DataStruct = {
    time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 60, 61, 62, 63],
    values: Array.from({ length: 14 }, (_, i) => [i * 10]),
    labels: ["y"],
    units: [""],
    metadata: {},
  };

  beforeEach(() => {
    useApp.setState({
      datasets: [{ id: "d1", name: "ds1", data: breakData }],
      activeId: null,
      xKey: null,
      yKeys: null,
      stackMode: false,
      spatialPanels: null,
      facetPanels: null,
      breakPanels: null,
      macroRecording: false,
      macroSteps: [],
    });
  });

  it("auto-detects the gap, builds paneled segments, activates the dataset, and turns on stack mode", () => {
    useApp.getState().breakAtGaps("d1");
    const s = useApp.getState();
    expect(s.activeId).toBe("d1");
    expect(s.stackMode).toBe(true);
    expect(s.spatialPanels).toBeNull();
    expect(s.facetPanels).toBeNull();
    expect(s.breakPanels).toHaveLength(2);
    expect(s.breakPanels?.[0].xRange).toEqual([0, 9]);
    expect(s.breakPanels?.[1].xRange).toEqual([60, 63]);
  });

  it("clears a prior spatial arrangement", () => {
    useApp.setState({
      spatialPanels: [
        {
          datasetId: "other",
          xKey: null,
          yKeys: [0],
          xLim: [0, 1],
          yLim: [0, 1],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
        },
      ],
    });
    useApp.getState().breakAtGaps("d1");
    expect(useApp.getState().spatialPanels).toBeNull();
  });

  it("clears a prior facet arrangement", () => {
    useApp.setState({
      facetPanels: [
        { label: "x", payload: { data: [[0]], series: [], xLabel: "", xUnit: "" } },
      ],
    });
    useApp.getState().breakAtGaps("d1");
    expect(useApp.getState().facetPanels).toBeNull();
  });

  it("no-ops (with a toast, no crash) when the dataset is missing", () => {
    useApp.getState().breakAtGaps("nope");
    const s = useApp.getState();
    expect(s.breakPanels).toBeNull();
    expect(s.stackMode).toBe(false);
    expect(s.activeId).toBeNull();
  });

  it("no-ops when no qualifying gap exists (evenly spaced data)", () => {
    const even: DataStruct = {
      ...breakData,
      time: Array.from({ length: 14 }, (_, i) => i),
    };
    useApp.setState({ datasets: [{ id: "d1", name: "ds1", data: even }] });
    useApp.getState().breakAtGaps("d1");
    const s = useApp.getState();
    expect(s.breakPanels).toBeNull();
    expect(s.stackMode).toBe(false);
  });

  it("no-ops when every row is excluded (guard #11 analysis view is empty)", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "ds1", data: breakData, excludedRows: breakData.time.map((_, i) => i) },
      ],
    });
    useApp.getState().breakAtGaps("d1");
    expect(useApp.getState().breakPanels).toBeNull();
  });

  it("honors row exclusion (guard #11) — an excluded row never enters a break panel", () => {
    // Exclude row 0 (time=0) -- the first segment's remaining rows are 1..9.
    useApp.setState({
      datasets: [{ id: "d1", name: "ds1", data: breakData, excludedRows: [0] }],
    });
    useApp.getState().breakAtGaps("d1");
    const s = useApp.getState();
    expect(s.breakPanels?.[0].payload.data[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("accepts an explicit breaks override instead of auto-detecting", () => {
    useApp.getState().breakAtGaps("d1", [[2, 8]]);
    const s = useApp.getState();
    expect(s.breakPanels).toHaveLength(2);
    expect(s.breakPanels?.[0].xRange).toEqual([0, 2]);
    expect(s.breakPanels?.[1].xRange).toEqual([8, 63]);
  });

  it("does NOT carry over the x/y channel selection of a DIFFERENT active dataset", () => {
    // channel 0 is evenly spaced (no qualifying gap); if breakAtGaps wrongly
    // carried over "other"'s xKey=0 selection, no break would be found.
    useApp.setState({
      datasets: [
        { id: "other", name: "other", data: breakData },
        { id: "d1", name: "ds1", data: breakData },
      ],
      activeId: "other",
      xKey: 0,
      yKeys: [0],
    });
    useApp.getState().breakAtGaps("d1");
    expect(useApp.getState().breakPanels).toHaveLength(2);
  });

  it("carries over the current x/y channel selection when the dataset IS already active", () => {
    // xKey=0 (evenly spaced) IS honored when d1 is already active -> no gap -> no-op.
    useApp.setState({ activeId: "d1", xKey: 0, yKeys: [0] });
    useApp.getState().breakAtGaps("d1");
    expect(useApp.getState().breakPanels).toBeNull();
  });

  it("no-ops when the breaks would leave fewer than 2 non-empty panels", () => {
    // [-5,-1] carves no rows out of the actual data range (everything is
    // >= 0) -> only ONE segment ends up non-empty.
    useApp.getState().breakAtGaps("d1", [[-5, -1]]);
    expect(useApp.getState().breakPanels).toBeNull();
  });

  it("records a macro step while recording", () => {
    useApp.getState().startMacro();
    useApp.getState().breakAtGaps("d1");
    const steps = useApp.getState().macroSteps;
    expect(steps).toHaveLength(1);
    expect(steps[0].code).toBe('qz.breakAtGaps("d1")');
    expect(steps[0].label).toBe("Break x-axis at gaps");
  });
});

describe("useApp removeDatasets (item 17 book-family filter)", () => {
  it("removes exactly the given ids, leaving the rest untouched", () => {
    useApp.setState({
      datasets: [
        { id: "b1", name: "XRD:Book1", data: raw },
        { id: "b2", name: "XRD:Book2", data: raw },
        { id: "b3", name: "XRD:Book3", data: raw },
      ],
      activeId: "b1",
      selectedIds: ["b1"],
    });
    useApp.getState().removeDatasets(["b2"]);
    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["b1", "b3"]);
    expect(s.activeId).toBe("b1"); // untouched active dataset survives
  });

  it("falls back to the first survivor when the active dataset is removed", () => {
    useApp.setState({
      datasets: [
        { id: "b1", name: "XRD:Book1", data: raw },
        { id: "b2", name: "XRD:Book2", data: raw },
      ],
      activeId: "b1",
    });
    useApp.getState().removeDatasets(["b1"]);
    expect(useApp.getState().activeId).toBe("b2");
  });

  it("disables (not removes) an Origin figure whose target dataset was removed", () => {
    useApp.setState({
      datasets: [
        { id: "b1", name: "XRD:Book1", data: raw },
        { id: "b2", name: "XRD:Book2", data: raw },
      ],
      originFigures: [
        {
          id: "fig-XRD-0",
          stem: "XRD",
          datasetId: "b2",
          siblingIds: ["b1", "b2"],
          figure: {
            name: "Graph1",
            x_from: 0,
            x_to: 1,
            x_log: false,
            y_from: 0,
            y_to: 1,
            y_log: false,
            n_curves: 1,
            annotations: [],
          },
        },
      ],
    });
    useApp.getState().removeDatasets(["b2"]);
    const s = useApp.getState();
    expect(s.originFigures).toHaveLength(1); // still listed
    expect(s.originFigures[0].datasetId).toBeNull(); // just disabled
  });
});

describe("useApp loadWorkspace", () => {
  it("replaces the library and activates the first dataset", () => {
    useApp.setState({
      datasets: [{ id: "old", name: "stale", data: raw }],
      activeId: "old",
      yKeys: [1],
      seriesStyles: { 0: { width: 5 } },
      xLim: [0, 9],
      rsmPeaks: { datasetId: "old", peaks: [] },
    });

    useApp.getState().loadWorkspace({
      datasets: [
        { id: "w1", name: "first", data: raw },
        { id: "w2", name: "second", data: raw },
      ],
    });

    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["w1", "w2"]);
    expect(s.activeId).toBe("w1"); // first dataset becomes active
    expect(s.yKeys).toBeNull(); // per-dataset view reset
    expect(s.seriesStyles).toEqual({});
    expect(s.xLim).toBeNull();
    expect(s.rsmPeaks).toBeNull(); // markers tied to the old library dropped
    expect(s.status).toContain("2 datasets");
  });

  it("handles an empty workspace (no active dataset)", () => {
    useApp.setState({ datasets: [{ id: "old", name: "x", data: raw }], activeId: "old" });
    useApp.getState().loadWorkspace({ datasets: [] });
    expect(useApp.getState().datasets).toEqual([]);
    expect(useApp.getState().activeId).toBeNull();
  });

  // GUI_INTERACTION_PLAN #10 item 3: the ToolWindow layout registry
  // round-trips through loadWorkspace exactly like plotWindows/folders — a
  // legacy doc with no field resets to {} (every window falls back to its
  // own default props), same as a fresh app start.
  it("restores a persisted ToolWindow layout map", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "w1", name: "first", data: raw }],
      toolWindowLayout: { baseline: { x: 200, y: 150, width: 320, height: null, collapsed: false } },
    });
    expect(useApp.getState().toolWindowLayout).toEqual({
      baseline: { x: 200, y: 150, width: 320, height: null, collapsed: false },
    });
  });

  it("defaults toolWindowLayout to {} for a doc without the field", () => {
    useApp.getState().setToolWindowLayout("stale", { x: 1, y: 1, width: 300, height: null, collapsed: false });
    useApp.getState().loadWorkspace({ datasets: [{ id: "w1", name: "first", data: raw }] });
    expect(useApp.getState().toolWindowLayout).toEqual({});
  });

  it("restores the folder tree, expansion, and persisted active/selection (v2)", () => {
    useApp.getState().loadWorkspace({
      datasets: [
        { id: "w1", name: "a", data: raw, folderId: "f1" },
        { id: "w2", name: "b", data: raw },
      ],
      folders: [{ id: "f1", name: "XRD", parentId: null, order: 0 }],
      activeId: "w2",
      selectedIds: ["w2"],
      expandedFolders: ["f1"],
    });
    const s = useApp.getState();
    expect(s.folders.map((f) => f.id)).toEqual(["f1"]);
    expect(s.datasets.find((d) => d.id === "w1")!.folderId).toBe("f1");
    expect(s.activeId).toBe("w2"); // persisted active honored, not datasets[0]
    expect(s.expandedFolders).toEqual(["f1"]);
  });

  // project-organization plan item 6: a legacy v1 .dwk carries only `group`
  // strings (no folder tree at all) — loadWorkspace must promote them.
  it("migrates a v1 doc's legacy `group` strings into root folders on load", () => {
    useApp.getState().loadWorkspace({
      datasets: [
        { id: "w1", name: "a", data: raw, group: "Batch A" },
        { id: "w2", name: "b", data: raw, group: "Batch A" },
        { id: "w3", name: "c", data: raw }, // ungrouped — stays at root
      ],
    });
    const s = useApp.getState();
    expect(s.folders).toHaveLength(1);
    expect(s.folders[0].name).toBe("Batch A");
    const fid = s.folders[0].id;
    expect(s.datasets.find((d) => d.id === "w1")!.folderId).toBe(fid);
    expect(s.datasets.find((d) => d.id === "w2")!.folderId).toBe(fid);
    expect(s.datasets.find((d) => d.id === "w3")!.folderId).toBeUndefined();
    // group is cleared post-migration — the folder is now the source of truth.
    expect(s.datasets.find((d) => d.id === "w1")!.group).toBeUndefined();
    // the freshly-created folder is auto-revealed, not left collapsed+hidden.
    expect(s.expandedFolders).toContain(fid);
  });

  it("re-loading an already-migrated workspace does not duplicate the folder", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "w1", name: "a", data: raw, group: "Batch A" }],
    });
    const first = useApp.getState();
    const savedFolders = first.folders;
    const savedDatasets = first.datasets;

    // Simulate a re-open of the SAME (now-migrated) workspace — datasets carry
    // folderId, no group; folders carry the one migrated folder.
    useApp.getState().loadWorkspace({ datasets: savedDatasets, folders: savedFolders });
    const second = useApp.getState();
    expect(second.folders).toHaveLength(1); // still just one — no duplicate
    expect(second.folders[0].id).toBe(first.folders[0].id);
  });
});

describe("useApp appendWorkspace (MAIN_PLAN #16 — Append workspace)", () => {
  // A minimal LoadedWorkspace wrapper — appendWorkspace only ever reads
  // `.datasets` off it (see lib/workspace.mergeWorkspace's doc).
  function asLoaded(datasets: Dataset[]): LoadedWorkspace {
    return {
      datasets,
      folders: [],
      activeId: null,
      selectedIds: [],
      expandedFolders: [],
      originFigures: [],
      originFidelity: [],
      smartFolders: [],
      reports: [],
      macroSteps: [],
      recalcMode: "auto",
      figureDocs: [],
      plotWindows: [],
      focusedWindowId: null,
      toolWindowLayout: {},
    };
  }

  it("appends the incoming datasets without touching activeId, plotWindows, or view state", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "existing", data: raw }],
      activeId: "d1",
      yKeys: [0],
      xLim: [1, 2],
    });
    const pre = useApp.getState();
    const preExisting = pre.datasets[0];

    useApp.getState().appendWorkspace(
      asLoaded([
        { id: "n1", name: "new one", data: raw },
        { id: "n2", name: "new two", data: raw },
      ]),
    );

    const s = useApp.getState();
    expect(s.datasets.map((d) => d.id)).toEqual(["d1", "n1", "n2"]);
    expect(s.datasets[0]).toBe(preExisting); // the existing dataset object is untouched
    expect(s.activeId).toBe(pre.activeId);
    expect(s.yKeys).toBe(pre.yKeys);
    expect(s.xLim).toBe(pre.xLim);
    expect(s.plotWindows).toBe(pre.plotWindows);
    expect(s.status).toBe("appended 2 datasets (0 renamed)");
  });

  it("remaps a colliding id and suffixes a colliding name, reporting the renamed count", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "sample", data: raw }], activeId: "d1" });

    useApp.getState().appendWorkspace(asLoaded([{ id: "d1", name: "sample", data: raw }]));

    const s = useApp.getState();
    expect(s.datasets).toHaveLength(2);
    expect(s.datasets[0].id).toBe("d1"); // existing untouched
    expect(s.datasets[1].id).not.toBe("d1"); // incoming id collided -> remapped
    expect(s.datasets[1].name).toBe("sample (2)"); // Origin-style name suffix
    expect(s.status).toBe("appended 1 dataset (1 renamed)");
  });

  it("is a no-op (no history entry, no status change) for a workspace with no datasets", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "a", data: raw }], history: [], status: "" });

    useApp.getState().appendWorkspace(asLoaded([]));

    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toBe("");
  });
});

describe("useApp tags", () => {
  it("adds a trimmed tag, dedupes, and ignores blanks", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    useApp.getState().addDatasetTag("d1", "  MvsH ");
    useApp.getState().addDatasetTag("d1", "MvsH"); // dupe -> no-op
    useApp.getState().addDatasetTag("d1", "   "); // blank -> no-op
    expect(useApp.getState().datasets[0].tags).toEqual(["MvsH"]);
  });

  it("removes a tag and drops the list to undefined when empty", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "x", data: raw, tags: ["a", "b"] }],
      activeId: "d1",
    });
    useApp.getState().removeDatasetTag("d1", "a");
    expect(useApp.getState().datasets[0].tags).toEqual(["b"]);
    useApp.getState().removeDatasetTag("d1", "b");
    expect(useApp.getState().datasets[0].tags).toBeUndefined();
  });
});

describe("useApp groups", () => {
  it("sets a trimmed group and clears it when blank", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    useApp.getState().setDatasetGroup("d1", "  Batch A ");
    expect(useApp.getState().datasets[0].group).toBe("Batch A");
    useApp.getState().setDatasetGroup("d1", "   ");
    expect(useApp.getState().datasets[0].group).toBeUndefined();
  });
});

describe("useApp setCellValue", () => {
  it("edits a value cell immutably and leaves the rest intact", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    const before = useApp.getState().datasets[0].data;
    useApp.getState().setCellValue("d1", 1, 0, 99);
    const after = useApp.getState().datasets[0].data;
    expect(after.values[1][0]).toBe(99);
    expect(after.values[0][0]).toBe(10); // sibling row untouched
    expect(after.values).not.toBe(before.values); // new array (immutable)
    expect(raw.values[1][0]).toBe(20); // shared fixture never mutated
  });

  it("edits the x/time column for col < 0", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    useApp.getState().setCellValue("d1", 0, -1, 7);
    expect(useApp.getState().datasets[0].data.time[0]).toBe(7);
    expect(raw.time[0]).toBe(1); // shared fixture never mutated
  });
});

describe("useApp 2-D map gridding", () => {
  it("defaults to linear / 200 and updates via setters", () => {
    expect(useApp.getState().mapMethod).toBe("linear");
    expect(useApp.getState().mapRes).toBe(200);
    useApp.getState().setMapMethod("idw");
    useApp.getState().setMapRes(400);
    expect(useApp.getState().mapMethod).toBe("idw");
    expect(useApp.getState().mapRes).toBe(400);
  });
});

describe("useApp computed columns (recompute)", () => {
  const twoCol: DataStruct = {
    time: [1, 2],
    values: [
      [10, 20],
      [30, 40],
    ],
    labels: ["A", "B"],
    units: ["u", "v"],
    metadata: {},
  };

  it("addFormula appends a computed column and evaluates it", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: twoCol }], activeId: "d1" });
    useApp.getState().addFormula("d1", "S", "A + B");
    const d = useApp.getState().datasets[0];
    expect(d.formulas).toEqual([{ name: "S", expr: "A + B" }]);
    expect(d.data.labels).toEqual(["A", "B", "S"]);
    expect(d.data.values).toEqual([
      [10, 20, 30],
      [30, 40, 70],
    ]);
  });

  it("recomputes the computed column when a base cell is edited", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: twoCol }], activeId: "d1" });
    useApp.getState().addFormula("d1", "S", "A + B");
    useApp.getState().setCellValue("d1", 0, 0, 100); // A[0] 10 → 100
    const d = useApp.getState().datasets[0];
    expect(d.data.values[0][0]).toBe(100);
    expect(d.data.values[0][2]).toBe(120); // S recomputed = 100 + 20
  });

  it("refuses to edit a computed cell (it would be overwritten)", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: twoCol }], activeId: "d1" });
    useApp.getState().addFormula("d1", "S", "A + B"); // S is column index 2
    useApp.getState().setCellValue("d1", 0, 2, 999);
    expect(useApp.getState().datasets[0].data.values[0][2]).toBe(30); // unchanged
  });

  it("removeFormula drops the computed column back to the base", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: twoCol }], activeId: "d1" });
    useApp.getState().addFormula("d1", "S", "A + B");
    useApp.getState().removeFormula("d1", 0);
    const d = useApp.getState().datasets[0];
    expect(d.formulas).toBeUndefined();
    expect(d.data.labels).toEqual(["A", "B"]);
    expect(d.data.values).toEqual([
      [10, 20],
      [30, 40],
    ]);
  });

  it("recomputes after corrections (base changes upstream)", async () => {
    // The backend echoes the same shape it received (3 cols incl. the stale
    // computed S, value 999 here) — recompute strips it and re-derives S.
    const corrected: DataStruct = {
      ...twoCol,
      labels: ["A", "B", "S"],
      units: ["u", "v", ""],
      values: [
        [0, 20, 999],
        [20, 40, 999],
      ],
    };
    vi.mocked(applyCorrectionsApi).mockResolvedValue(corrected);
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: twoCol }], activeId: "d1" });
    useApp.getState().addFormula("d1", "S", "A + B");
    await useApp.getState().applyCorrections("d1", { yOff: -10 });
    const d = useApp.getState().datasets[0];
    // corrected A column drove a fresh S = A + B (999 discarded).
    expect(d.data.values[0][2]).toBe(20); // 0 + 20
    expect(d.data.values[1][2]).toBe(60); // 20 + 40
  });
});

describe("useApp macro recorder", () => {
  beforeEach(() => {
    useApp.setState({ macroRecording: false, macroSteps: [] });
  });

  it("records nothing while paused (the gate lives in recordMacro)", () => {
    useApp.getState().setYScale("log");
    expect(useApp.getState().macroSteps).toHaveLength(0);
  });

  it("captures curated actions once recording", () => {
    useApp.getState().startMacro();
    useApp.getState().setYScale("log");
    useApp.getState().setXKey(2);
    const steps = useApp.getState().macroSteps;
    expect(steps.map((s) => s.code)).toEqual(['qz.setYScale("log")', "qz.setXKey(2)"]);
    expect(steps[0].label).toBe("Y axis log");
  });

  it("records corrections with the dataset name and params", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue({ ...raw, values: [[1], [2], [3]] });
    useApp.setState({ datasets: [{ id: "d1", name: "samp.dat", data: raw }], activeId: "d1" });
    useApp.getState().startMacro();
    await useApp.getState().applyCorrections("d1", { yOff: 5 });
    expect(useApp.getState().macroSteps[0].code).toBe(
      'qz.applyCorrections("samp.dat", { yOff: 5 })',
    );
  });

  it("clear empties the log and stops recording", () => {
    useApp.getState().startMacro();
    useApp.getState().setYScale("log");
    useApp.getState().clearMacro();
    expect(useApp.getState().macroSteps).toHaveLength(0);
    expect(useApp.getState().macroRecording).toBe(false);
  });
});

describe("stage routing (2-D map auto-open)", () => {
  const map2d: DataStruct = {
    time: [0, 1, 2, 3],
    values: [
      [0, 0, 1],
      [1, 0, 2],
      [0, 1, 3],
      [1, 1, 4],
    ],
    labels: ["2Theta", "Omega", "Intensity"],
    units: ["deg", "deg", "cps"],
    metadata: { is2D: true },
  };

  beforeEach(() => {
    useApp.setState({ datasets: [], activeId: null, stageTab: "plot" });
  });

  it("opens an imported 2-D map on the Map tab", () => {
    useApp.getState().addDataset({ id: "m1", name: "rsm.xrdml", data: map2d });
    expect(useApp.getState().stageTab).toBe("map");
  });

  it("opens an imported 1-D scan on the Plot tab", () => {
    useApp.setState({ stageTab: "map" }); // was viewing a map
    useApp.getState().addDataset({ id: "d1", name: "scan.dat", data: raw });
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("routes the tab when selecting an existing dataset", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "scan.dat", data: raw },
        { id: "m1", name: "rsm.xrdml", data: map2d },
      ],
      activeId: "d1",
      stageTab: "plot",
    });
    useApp.getState().setActive("m1");
    expect(useApp.getState().stageTab).toBe("map");
    useApp.getState().setActive("d1");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("never overrides an explicit Worksheet choice", () => {
    useApp.setState({ stageTab: "worksheet" });
    useApp.getState().addDataset({ id: "m1", name: "rsm.xrdml", data: map2d });
    expect(useApp.getState().stageTab).toBe("worksheet");
  });
});

// Owner-routing item 1 (2026-07-09, "it's a bit confusing when I'm opening a
// plot vs workbook and then have to remember to toggle up"): unlike passive
// activation (addDataset/loadWorkspace, tested above), setActive IS the
// plot-intent primitive — it must ALWAYS surface the Plot tab (or Map, for a
// 2-D dataset), even from the Worksheet tab.
describe("stage routing — plot-intent forces the Plot tab off Worksheet (item 1)", () => {
  const map2d: DataStruct = {
    time: [0, 1, 2, 3],
    values: [
      [0, 0, 1],
      [1, 0, 2],
      [0, 1, 3],
      [1, 1, 4],
    ],
    labels: ["2Theta", "Omega", "Intensity"],
    units: ["deg", "deg", "cps"],
    metadata: { is2D: true },
  };

  beforeEach(() => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "scan.dat", data: raw },
        { id: "m1", name: "rsm.xrdml", data: map2d },
      ],
      activeId: "d1",
      stageTab: "worksheet",
    });
  });

  it("setActive forces the Plot tab even when currently on Worksheet", () => {
    useApp.getState().setActive("d1");
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("setActive still routes a 2-D map to the Map tab, not Plot, off Worksheet", () => {
    useApp.getState().setActive("m1");
    expect(useApp.getState().stageTab).toBe("map");
  });
});

describe("useApp channel modeling types — per dataset", () => {
  const wide: DataStruct = {
    time: [1, 2, 3],
    values: [
      [10, 1, 0.1],
      [20, 2, 0.2],
      [30, 3, 0.3],
    ],
    labels: ["m", "T", "e"],
    units: ["emu", "K", ""],
    metadata: {},
  };

  it("sets and clears a type override on the active dataset", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "a", data: wide }], activeId: "d1" });
    useApp.getState().setChannelType(1, "nominal");
    expect(useApp.getState().datasets[0].channelTypes).toEqual({ 1: "nominal" });
    useApp.getState().setChannelType(1, "ordinal");
    expect(useApp.getState().datasets[0].channelTypes).toEqual({ 1: "ordinal" });
    useApp.getState().setChannelType(1, null);
    expect(useApp.getState().datasets[0].channelTypes).toBeUndefined(); // empties to undefined
  });

  it("is a no-op with no active dataset", () => {
    useApp.setState({ datasets: [], activeId: null });
    useApp.getState().setChannelType(0, "nominal");
    expect(useApp.getState().datasets).toEqual([]);
  });
});

describe("useApp soloChannel (column switcher engine)", () => {
  const wide: DataStruct = {
    time: [1, 2, 3],
    values: [
      [10, 1, 0.1],
      [20, 2, 0.2],
      [30, 3, 0.3],
    ],
    labels: ["m", "T", "e"],
    units: ["emu", "K", ""],
    metadata: {},
  };

  it("solos one plotted channel by hiding the others", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: wide }],
      activeId: "d1",
      xKey: null,
      yKeys: null,
      seriesOrder: null,
      hiddenChannels: [],
    });
    useApp.getState().soloChannel(1);
    expect([...useApp.getState().hiddenChannels].sort()).toEqual([0, 2]);
  });

  it("null clears the solo (show all)", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: wide }],
      activeId: "d1",
      hiddenChannels: [0, 2],
    });
    useApp.getState().soloChannel(null);
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });

  it("respects the x-key and column roles; ignores non-plotted channels", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: wide, channelRoles: { 2: "label" } }],
      activeId: "d1",
      xKey: 0, // channel 0 is the x-axis → plotted = [1] only
      yKeys: null,
      seriesOrder: null,
      hiddenChannels: [],
    });
    useApp.getState().soloChannel(1);
    expect(useApp.getState().hiddenChannels).toEqual([]); // 1 is the only plotted channel
    useApp.getState().soloChannel(2); // a roled (non-plotted) channel → no-op
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });
});

describe("useApp row exclusion (#50 row-state model)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [{ id: "d1", name: "ds", data: raw }],
      activeId: "d1",
    });
  });

  const excludedOf = (id: string) =>
    useApp.getState().datasets.find((d) => d.id === id)?.excludedRows;

  it("toggleRowExcluded adds then removes a row, staying sorted", () => {
    useApp.getState().toggleRowExcluded("d1", 2);
    useApp.getState().toggleRowExcluded("d1", 0);
    expect(excludedOf("d1")).toEqual([0, 2]);
    useApp.getState().toggleRowExcluded("d1", 0);
    expect(excludedOf("d1")).toEqual([2]);
  });

  it("clears the field to undefined when the last exclusion is removed", () => {
    useApp.getState().toggleRowExcluded("d1", 1);
    useApp.getState().toggleRowExcluded("d1", 1);
    expect(excludedOf("d1")).toBeUndefined();
  });

  it("setRowsExcluded sanitizes to in-range, sorted, unique indices", () => {
    // raw has 3 rows (indices 0..2); 9 and -1 are out of range, 1.5 non-integer
    useApp.getState().setRowsExcluded("d1", [2, 2, 9, -1, 1.5, 0]);
    expect(excludedOf("d1")).toEqual([0, 2]);
  });

  it("clearRowExclusions empties the field", () => {
    useApp.getState().setRowsExcluded("d1", [0, 1]);
    useApp.getState().clearRowExclusions("d1");
    expect(excludedOf("d1")).toBeUndefined();
  });

  it("leaves other datasets untouched", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
    });
    useApp.getState().toggleRowExcluded("d1", 1);
    expect(excludedOf("d1")).toEqual([1]);
    expect(excludedOf("d2")).toBeUndefined();
  });
});

describe("useApp row selection (#50 selection dimension)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [{ id: "d1", name: "ds", data: raw }], activeId: "d1", selection: null });
  });
  const excludedOf = (id: string) =>
    useApp.getState().datasets.find((d) => d.id === id)?.excludedRows;

  it("toggleRowSelected builds a selection scoped to the active dataset", () => {
    useApp.getState().toggleRowSelected(2);
    useApp.getState().toggleRowSelected(0);
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [0, 2] });
    useApp.getState().toggleRowSelected(0);
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [2] });
  });

  it("setRowSelection replaces with a sorted unique set; empty clears", () => {
    useApp.getState().setRowSelection([2, 0, 2]);
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [0, 2] });
    useApp.getState().setRowSelection([]);
    expect(useApp.getState().selection).toBeNull();
  });

  it("excludeSelectedRows merges the selection into excludedRows and clears it", () => {
    useApp.getState().setRowSelection([1, 2]);
    useApp.getState().excludeSelectedRows();
    expect(excludedOf("d1")).toEqual([1, 2]);
    expect(useApp.getState().selection).toBeNull();
    useApp.getState().setRowSelection([0]); // unions with existing exclusions
    useApp.getState().excludeSelectedRows();
    expect(excludedOf("d1")).toEqual([0, 1, 2]);
  });

  it("keepOnlySelectedRows excludes the complement", () => {
    useApp.getState().setRowSelection([1]); // raw has 3 rows → exclude 0 and 2
    useApp.getState().keepOnlySelectedRows();
    expect(excludedOf("d1")).toEqual([0, 2]);
    expect(useApp.getState().selection).toBeNull();
  });

  it("ignores a stale selection belonging to another dataset", () => {
    useApp.setState({ selection: { datasetId: "other", rows: [0, 1] } });
    useApp.getState().toggleRowSelected(2); // starts fresh for the active dataset
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [2] });
    useApp.setState({ selection: { datasetId: "other", rows: [0] } });
    useApp.getState().excludeSelectedRows(); // stale → no-op
    expect(excludedOf("d1")).toBeUndefined();
  });

  // GUI_INTERACTION #14: a `windowId` argument targets `worksheetSelections`
  // instead — completely independent of the active-dataset singleton above.
  it("excludeSelectedRows(windowId) acts on that window's own selection, leaving the active-dataset one untouched", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "ds", data: raw }],
      selection: { datasetId: "d1", rows: [0] }, // the Stage tab's own selection
      worksheetSelections: { ws1: { datasetId: "d1", rows: [1, 2] } },
    });
    useApp.getState().excludeSelectedRows("ws1");
    expect(excludedOf("d1")).toEqual([1, 2]);
    expect(useApp.getState().worksheetSelections.ws1).toBeUndefined(); // that window's selection cleared
    expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [0] }); // Stage tab's untouched
  });

  it("keepOnlySelectedRows(windowId) excludes that window's complement only", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "ds", data: raw }],
      worksheetSelections: { ws1: { datasetId: "d1", rows: [1] } },
    });
    useApp.getState().keepOnlySelectedRows("ws1");
    expect(excludedOf("d1")).toEqual([0, 2]);
    expect(useApp.getState().worksheetSelections.ws1).toBeUndefined();
  });

  it("excludeSelectedRows(windowId) is a no-op for an unknown or empty window selection", () => {
    useApp.getState().excludeSelectedRows("no-such-window");
    expect(excludedOf("d1")).toBeUndefined();
  });
});

describe("useApp folder tree (project-organization item 1)", () => {
  const mkDs = (id: string): Dataset => ({
    id,
    name: id,
    data: { time: [0], values: [[1]], labels: ["y"], units: [""], metadata: {} },
  });

  beforeEach(() => useApp.setState({ datasets: [], folders: [], activeId: null, selectedIds: [] }));

  it("createFolder appends a folder and returns its id", () => {
    const id = useApp.getState().createFolder(null, "XRD");
    const { folders } = useApp.getState();
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ id, name: "XRD", parentId: null });
  });

  it("moveDatasetToFolder sets the dataset's folderId", () => {
    useApp.setState({ datasets: [mkDs("d1")] });
    const fid = useApp.getState().createFolder(null, "F");
    useApp.getState().moveDatasetToFolder("d1", fid);
    expect(useApp.getState().datasets[0].folderId).toBe(fid);
  });

  it("deleteFolder (reparent) re-homes its datasets to root, never deleting them", () => {
    useApp.setState({ datasets: [mkDs("d1")] });
    const fid = useApp.getState().createFolder(null, "F");
    useApp.getState().moveDatasetToFolder("d1", fid);
    useApp.getState().deleteFolder(fid);
    expect(useApp.getState().folders).toHaveLength(0);
    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().datasets[0].folderId).toBeUndefined();
  });

  it("removing a dataset never dangles a folder ref (membership is on the dataset)", () => {
    useApp.setState({ datasets: [mkDs("d1"), mkDs("d2")] });
    const fid = useApp.getState().createFolder(null, "F");
    useApp.getState().moveDatasetToFolder("d1", fid);
    useApp.getState().removeDataset("d1");
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["d2"]);
    expect(useApp.getState().folders).toHaveLength(1); // folder still valid, just empty
  });

  it("renameFolder + moveFolder nest and rename", () => {
    const a = useApp.getState().createFolder(null, "A");
    const b = useApp.getState().createFolder(null, "B");
    useApp.getState().renameFolder(a, "XRD 2024");
    useApp.getState().moveFolder(b, a); // nest B under A
    const { folders } = useApp.getState();
    expect(folders.find((f) => f.id === a)!.name).toBe("XRD 2024");
    expect(folders.find((f) => f.id === b)!.parentId).toBe(a);
  });
});

describe("useApp removeFormula column remap", () => {
  it("remaps channelRoles + filter when removing a non-last computed column", () => {
    // Base column m (col 0) + two computed columns F1 (col 1), F2 (col 2).
    const data: DataStruct = {
      time: [1, 2, 3],
      values: [
        [10, 20, 30],
        [20, 40, 60],
        [30, 60, 90],
      ],
      labels: ["m", "F1", "F2"],
      units: ["emu", "", ""],
      metadata: {},
    };
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "x",
          data,
          formulas: [
            { name: "F1", expr: "m*2" },
            { name: "F2", expr: "m*3" },
          ],
          channelRoles: { 2: "ignore" }, // role tags F2 (column 2)
          filter: [{ col: 2, kind: "range", min: 0 }], // filter on F2
        },
      ],
      activeId: "d1",
    });

    useApp.getState().removeFormula("d1", 0); // remove F1 -> F2 shifts column 2 -> 1

    const ds = useApp.getState().datasets[0];
    expect(ds.data.labels).toEqual(["m", "F2"]);
    expect(ds.channelRoles).toEqual({ 1: "ignore" }); // remapped 2 -> 1, not stale
    expect(ds.filter).toEqual([{ col: 1, kind: "range", min: 0 }]);
  });
});

describe("useApp smart folders (org #9)", () => {
  it("addSmartFolder trims and appends; blank name is a no-op", () => {
    useApp.setState({ smartFolders: [] });
    useApp.getState().addSmartFolder("  Loops  ", " tag:mvsh ");
    useApp.getState().addSmartFolder("   ", "tag:x"); // blank -> no-op
    const sf = useApp.getState().smartFolders;
    expect(sf).toHaveLength(1);
    expect(sf[0].name).toBe("Loops");
    expect(sf[0].query).toBe("tag:mvsh");
    expect(sf[0].id).toBeTruthy();
  });

  it("updateSmartFolder edits name+query; a blank name keeps the old one", () => {
    useApp.setState({ smartFolders: [{ id: "s1", name: "Loops", query: "tag:mvsh" }] });
    useApp.getState().updateSmartFolder("s1", "", "format:qd");
    expect(useApp.getState().smartFolders[0]).toEqual({
      id: "s1",
      name: "Loops",
      query: "format:qd",
    });
    useApp.getState().updateSmartFolder("s1", "QD", "format:qd");
    expect(useApp.getState().smartFolders[0].name).toBe("QD");
  });

  it("removeSmartFolder drops by id (datasets untouched)", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: raw }],
      smartFolders: [{ id: "s1", name: "Loops", query: "" }],
    });
    useApp.getState().removeSmartFolder("s1");
    expect(useApp.getState().smartFolders).toEqual([]);
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("loadWorkspace restores saved smart folders and clears them when absent", () => {
    useApp.setState({ smartFolders: [] });
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d1", name: "a", data: raw }],
      smartFolders: [{ id: "s1", name: "Loops", query: "tag:mvsh" }],
    });
    expect(useApp.getState().smartFolders).toHaveLength(1);
    useApp.getState().loadWorkspace({ datasets: [] }); // e.g. clearAll's reset
    expect(useApp.getState().smartFolders).toEqual([]);
  });
});

describe("useApp plot windows (MULTI_PLOT_PLAN #2 — the focused-window facade)", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  it("the ≥1-window invariant holds at all times (whatever prior tests left behind)", () => {
    const s = useApp.getState();
    expect(s.plotWindows.length).toBeGreaterThanOrEqual(1);
    expect(s.plotWindows.some((w) => w.id === s.focusedWindowId)).toBe(true);
  });

  it("loadWorkspace resets to exactly one maximized window bound to the restored active dataset", () => {
    useApp.setState({ plotWindows: [win({ id: "stale" }), win({ id: "stale2" })], focusedWindowId: "stale" });
    useApp.getState().loadWorkspace({ datasets: [{ id: "d9", name: "a", data: raw }], activeId: "d9" });
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(1);
    expect(s.plotWindows[0].winState).toBe("maximized");
    expect(s.plotWindows[0].datasetId).toBe("d9");
    expect(s.focusedWindowId).toBe(s.plotWindows[0].id);
  });

  it("createWindow adds a window bound to the active dataset by default and does not move focus", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
      plotWindows: [win({ id: "w1" })],
      focusedWindowId: "w1",
    });
    const newId = useApp.getState().createWindow();
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(2);
    expect(s.plotWindows.find((w) => w.id === newId)?.datasetId).toBe("d1");
    expect(s.focusedWindowId).toBe("w1"); // unchanged — only focusWindow moves focus
  });

  it("createWindow accepts an explicit datasetId/view override", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1", activeId: "d1" });
    const view = { ...defaultPlotView(), plotTitle: "seeded" };
    const newId = useApp.getState().createWindow("d2", view);
    const created = useApp.getState().plotWindows.find((w) => w.id === newId);
    expect(created?.datasetId).toBe("d2");
    expect(created?.view.plotTitle).toBe("seeded");
  });

  it("focusWindow snapshots the outgoing window's LIVE view and hydrates the incoming one", () => {
    const w1 = win({ id: "w1", view: { ...defaultPlotView(), plotTitle: "stale w1 record" } });
    const w2 = win({ id: "w2", datasetId: "d2", view: { ...defaultPlotView(), plotTitle: "w2 title" } });
    useApp.setState({
      plotWindows: [w1, w2],
      focusedWindowId: "w1",
      plotTitle: "live w1 title", // the LIVE singleton diverged from w1's stale record
    });
    useApp.getState().focusWindow("w2");
    const s = useApp.getState();
    expect(s.focusedWindowId).toBe("w2");
    expect(s.plotTitle).toBe("w2 title"); // hydrated from w2's stored view
    expect(s.plotWindows.find((w) => w.id === "w1")?.view.plotTitle).toBe("live w1 title"); // snapshotted
  });

  it("focusWindow is a no-op when the target is already focused or unknown", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1", plotTitle: "keep" });
    useApp.getState().focusWindow("w1");
    useApp.getState().focusWindow("ghost");
    const s = useApp.getState();
    expect(s.focusedWindowId).toBe("w1");
    expect(s.plotTitle).toBe("keep");
  });

  it("closeWindow refocuses the top-z survivor and hydrates its view", () => {
    const w1 = win({ id: "w1", z: 0, view: { ...defaultPlotView(), plotTitle: "w1" } });
    const w2 = win({ id: "w2", z: 5, view: { ...defaultPlotView(), plotTitle: "w2" } });
    const w3 = win({ id: "w3", z: 2, view: { ...defaultPlotView(), plotTitle: "w3" } });
    useApp.setState({ plotWindows: [w1, w2, w3], focusedWindowId: "w2" });
    useApp.getState().closeWindow("w2");
    const s = useApp.getState();
    expect(s.plotWindows.map((w) => w.id)).toEqual(["w1", "w3"]);
    expect(s.focusedWindowId).toBe("w3"); // top-z among the survivors
    expect(s.plotTitle).toBe("w3"); // hydrated
  });

  it("closeWindow on an unfocused window drops it without touching focus or the live view", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2" })],
      focusedWindowId: "w1",
      plotTitle: "unchanged",
    });
    useApp.getState().closeWindow("w2");
    const s = useApp.getState();
    expect(s.plotWindows.map((w) => w.id)).toEqual(["w1"]);
    expect(s.focusedWindowId).toBe("w1");
    expect(s.plotTitle).toBe("unchanged");
  });

  it("closeWindow never drops below one window (the ≥1-window invariant)", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" });
    useApp.getState().closeWindow("w1");
    expect(useApp.getState().plotWindows).toHaveLength(1);
    expect(useApp.getState().plotWindows[0].id).toBe("w1");
  });

  it("removeDataset nulls a window's binding without closing it", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
      plotWindows: [win({ id: "w1", datasetId: "d1" })],
      focusedWindowId: "w1",
    });
    useApp.getState().removeDataset("d1");
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(1);
    expect(s.plotWindows[0].datasetId).toBeNull();
  });

  it("removeDatasets/removeSelected also null window bindings for the removed ids", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
      selectedIds: ["d2"],
      plotWindows: [win({ id: "w1", datasetId: "d1" }), win({ id: "w2", datasetId: "d2" })],
      focusedWindowId: "w1",
    });
    useApp.getState().removeSelected(); // removes d2 (the selection)
    expect(useApp.getState().plotWindows.find((w) => w.id === "w2")?.datasetId).toBeNull();

    useApp.getState().removeDatasets(["d1"]);
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.datasetId).toBeNull();
  });

  it("duplicateWindow clones a window at a new id, snapshotting the LIVE view if it's focused", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", datasetId: "d1" })],
      focusedWindowId: "w1",
      plotTitle: "live title",
    });
    const newId = useApp.getState().duplicateWindow("w1");
    const s = useApp.getState();
    expect(newId).not.toBeNull();
    expect(s.plotWindows).toHaveLength(2);
    const dup = s.plotWindows.find((w) => w.id === newId);
    expect(dup?.datasetId).toBe("d1");
    expect(dup?.view.plotTitle).toBe("live title");
  });

  it("duplicateWindow returns null for an unknown id", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" });
    expect(useApp.getState().duplicateWindow("ghost")).toBeNull();
  });

  it("createWindow defaults bg to 'theme' (item 18)", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1", activeId: "d1" });
    const newId = useApp.getState().createWindow();
    expect(useApp.getState().plotWindows.find((w) => w.id === newId)?.bg).toBe("theme");
  });

  it("duplicateWindow inherits the source window's bg override (item 18)", () => {
    useApp.setState({ plotWindows: [win({ id: "w1", bg: "light" })], focusedWindowId: "w1" });
    const newId = useApp.getState().duplicateWindow("w1");
    expect(useApp.getState().plotWindows.find((w) => w.id === newId)?.bg).toBe("light");
  });

  it("setWindowBg sets one window's background override without touching others; no-op for an unknown id", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", bg: "theme" }), win({ id: "w2", bg: "theme" })],
      focusedWindowId: "w1",
    });
    useApp.getState().setWindowBg("w1", "dark");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w1")?.bg).toBe("dark");
    expect(s.plotWindows.find((w) => w.id === "w2")?.bg).toBe("theme");
    useApp.getState().setWindowBg("ghost", "light");
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.bg).toBe("dark"); // unchanged
  });

  it("createWindow defaults linkGroup to null — linking is opt-in, never automatic (item 13)", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1", activeId: "d1" });
    const newId = useApp.getState().createWindow();
    expect(useApp.getState().plotWindows.find((w) => w.id === newId)?.linkGroup).toBeNull();
  });

  it("duplicateWindow inherits the source window's linkGroup (item 13 — matches bg inheritance)", () => {
    useApp.setState({ plotWindows: [win({ id: "w1", linkGroup: 2 })], focusedWindowId: "w1" });
    const newId = useApp.getState().duplicateWindow("w1");
    expect(useApp.getState().plotWindows.find((w) => w.id === newId)?.linkGroup).toBe(2);
  });

  it("cycleWindowLinkGroup cycles one window null -> 1 -> 2 -> 3 -> null without touching others; no-op for an unknown id (item 13)", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2", linkGroup: 3 })],
      focusedWindowId: "w1",
    });
    const groupOf = (id: string) => useApp.getState().plotWindows.find((w) => w.id === id)?.linkGroup;
    useApp.getState().cycleWindowLinkGroup("w1");
    expect(groupOf("w1")).toBe(1);
    useApp.getState().cycleWindowLinkGroup("w1");
    expect(groupOf("w1")).toBe(2);
    useApp.getState().cycleWindowLinkGroup("w1");
    expect(groupOf("w1")).toBe(3);
    useApp.getState().cycleWindowLinkGroup("w1");
    expect(groupOf("w1")).toBeNull();
    expect(groupOf("w2")).toBe(3); // untouched throughout
    useApp.getState().cycleWindowLinkGroup("ghost");
    expect(groupOf("w1")).toBeNull(); // unchanged
  });

  it("moveWindow/resizeWindow update geometry only; raiseWindow bumps z above the rest", () => {
    useApp.setState({
      plotWindows: [
        win({ id: "w1", z: 0, geometry: { x: 0, y: 0, w: 480, h: 360 } }),
        win({ id: "w2", z: 3, geometry: { x: 10, y: 10, w: 480, h: 360 } }),
      ],
      focusedWindowId: "w1",
    });
    useApp.getState().moveWindow("w1", 50, 60);
    useApp.getState().resizeWindow("w1", 600, 400);
    useApp.getState().raiseWindow("w1");
    const w1 = useApp.getState().plotWindows.find((w) => w.id === "w1")!;
    expect(w1.geometry).toEqual({ x: 50, y: 60, w: 600, h: 400 });
    expect(w1.z).toBeGreaterThan(3);
  });
});

describe("useApp plot windows — item 4 focused-window routing", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: null,
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  it("setActive rebinds ONLY the focused window's datasetId; an unfocused window keeps its pin", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      plotWindows: [win({ id: "w1", datasetId: "d1" }), win({ id: "w2", datasetId: "d1" })],
      focusedWindowId: "w1",
    });
    useApp.getState().setActive("d2");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("d2"); // focused → rebound
    expect(s.plotWindows.find((w) => w.id === "w2")?.datasetId).toBe("d1"); // unfocused → pinned
  });

  it("addDataset binds the FOCUSED window to the freshly-imported dataset", () => {
    useApp.setState({
      datasets: [],
      plotWindows: [win({ id: "w1", datasetId: null }), win({ id: "w2", datasetId: null })],
      focusedWindowId: "w1",
    });
    useApp.getState().addDataset({ id: "new1", name: "fresh.dat", data: raw });
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("new1");
    expect(s.plotWindows.find((w) => w.id === "w2")?.datasetId).toBeNull();
  });

  it("focusWindow retargets activeId/selectedIds to the newly-focused window's dataset (the window follows the Library, and vice versa)", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      activeId: "d1",
      selectedIds: ["d1"],
      plotWindows: [win({ id: "w1", datasetId: "d1" }), win({ id: "w2", datasetId: "d2" })],
      focusedWindowId: "w1",
    });
    useApp.getState().focusWindow("w2");
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
    expect(s.selectedIds).toEqual(["d2"]);
  });

  it("focusWindow onto an UNBOUND window clears activeId/selectedIds (the empty state)", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
      selectedIds: ["d1"],
      plotWindows: [win({ id: "w1", datasetId: "d1" }), win({ id: "w2", datasetId: null })],
      focusedWindowId: "w1",
    });
    useApp.getState().focusWindow("w2");
    const s = useApp.getState();
    expect(s.activeId).toBeNull();
    expect(s.selectedIds).toEqual([]);
  });

  it("focusWindow clears transient tool/gadget/overlay state exactly as setActive does for a dataset switch", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      plotWindows: [win({ id: "w1", datasetId: "d1" }), win({ id: "w2", datasetId: "d2" })],
      focusedWindowId: "w1",
      integral: { xlo: 0, xhi: 1, area: 1 },
      qfitRoi: [0, 1],
      qfitBusy: true,
      gadgetBusy: true,
    });
    useApp.getState().focusWindow("w2");
    const s = useApp.getState();
    expect(s.integral).toBeNull();
    expect(s.qfitRoi).toBeNull();
    expect(s.qfitBusy).toBe(false);
    expect(s.gadgetBusy).toBe(false);
  });

  it("closeWindow's refocus follows the same activeId/transient-reset contract as focusWindow", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: raw },
      ],
      plotWindows: [
        win({ id: "w1", datasetId: "d1", z: 0 }),
        win({ id: "w2", datasetId: "d2", z: 5 }),
      ],
      focusedWindowId: "w2",
      integral: { xlo: 0, xhi: 1, area: 1 },
    });
    useApp.getState().closeWindow("w2");
    const s = useApp.getState();
    expect(s.focusedWindowId).toBe("w1");
    expect(s.activeId).toBe("d1");
    expect(s.selectedIds).toEqual(["d1"]);
    expect(s.integral).toBeNull();
  });
});

describe("useApp plot windows — item 6 (Tile/Cascade + canvas bounds)", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: null,
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  it("setPlotCanvasBounds stores the Plot tab's current canvas size", () => {
    useApp.getState().setPlotCanvasBounds({ width: 900, height: 500 });
    expect(useApp.getState().plotCanvasBounds).toEqual({ width: 900, height: 500 });
    useApp.getState().setPlotCanvasBounds(null);
    expect(useApp.getState().plotCanvasBounds).toBeNull();
  });

  it("tileWindows is a no-op with fewer than 2 visible windows", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" });
    const before = useApp.getState().plotWindows;
    useApp.getState().tileWindows();
    expect(useApp.getState().plotWindows).toBe(before);
  });

  it("tileWindows arranges visible windows into a grid, skips minimized ones, and un-maximizes maximized ones", () => {
    useApp.setState({
      plotWindows: [
        win({ id: "w1", winState: "maximized" }),
        win({ id: "w2" }),
        win({ id: "w3", winState: "minimized", geometry: { x: 1, y: 2, w: 3, h: 4 } }),
      ],
      focusedWindowId: "w1",
      plotCanvasBounds: { width: 800, height: 400 },
    });
    useApp.getState().tileWindows();
    const s = useApp.getState();
    const w1 = s.plotWindows.find((w) => w.id === "w1")!;
    const w2 = s.plotWindows.find((w) => w.id === "w2")!;
    const w3 = s.plotWindows.find((w) => w.id === "w3")!;
    expect(w1.winState).toBe("normal"); // was maximized
    expect(w2.winState).toBe("normal");
    expect(w1.geometry).not.toEqual({ x: 0, y: 0, w: 480, h: 360 });
    expect(w3.winState).toBe("minimized"); // untouched
    expect(w3.geometry).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("cascadeWindows staggers visible windows and falls back to a default size without known bounds", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2" })],
      focusedWindowId: "w1",
      plotCanvasBounds: null,
    });
    useApp.getState().cascadeWindows();
    const s = useApp.getState();
    const w1 = s.plotWindows.find((w) => w.id === "w1")!;
    const w2 = s.plotWindows.find((w) => w.id === "w2")!;
    expect(w2.geometry.x).toBeGreaterThan(w1.geometry.x);
    expect(w2.geometry.y).toBeGreaterThan(w1.geometry.y);
  });
});

describe("useApp plot windows — item 7 (.dwk + autosave persistence)", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 10, y: 20, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  it("windowsForSave freezes the FOCUSED window's LIVE view into its record without mutating the store", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", view: { ...defaultPlotView(), plotTitle: "stale" } }), win({ id: "w2" })],
      focusedWindowId: "w1",
      plotTitle: "live on-screen title",
    });
    const saved = useApp.getState().windowsForSave();
    expect(saved.find((w) => w.id === "w1")?.view.plotTitle).toBe("live on-screen title");
    // A pure read: the store's own plotWindows record is untouched.
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.view.plotTitle).toBe("stale");
  });

  it("loadWorkspace restores a persisted layout and hydrates the focused window's view into the live singletons", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: raw }],
      plotWindows: [win({ id: "old" })],
      focusedWindowId: "old",
    });
    const persisted = [
      win({ id: "p1", geometry: { x: 5, y: 5, w: 300, h: 200 }, view: { ...defaultPlotView(), yScale: "log", plotTitle: "restored" } }),
      win({ id: "p2", z: 3 }),
    ];
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
      plotWindows: persisted,
      focusedWindowId: "p1",
    });
    const s = useApp.getState();
    expect(s.plotWindows.map((w) => w.id)).toEqual(["p1", "p2"]);
    expect(s.focusedWindowId).toBe("p1");
    expect(s.yScale).toBe("log"); // hydrated from p1's persisted view
    expect(s.plotTitle).toBe("restored");
  });

  it("loadWorkspace clamps a dead dataset ref on a persisted window (never drops it) via sanitizePlotWindows", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
      plotWindows: [win({ id: "p1", datasetId: "gone" })],
      focusedWindowId: "p1",
    });
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(1);
    expect(s.plotWindows[0].datasetId).toBeNull();
  });

  it("loadWorkspace with NO persisted layout keeps today's single-maximized-window default + dataset-derived smart defaults", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
    });
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(1);
    expect(s.plotWindows[0].winState).toBe("maximized");
    expect(s.errKeys).toEqual(defaultErrKeys(raw));
  });

  it("loadWorkspace falls back to the first restored window when the persisted focusedWindowId doesn't match any", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
      plotWindows: [win({ id: "p1" }), win({ id: "p2" })],
      focusedWindowId: "ghost",
    });
    expect(useApp.getState().focusedWindowId).toBe("p1");
  });
});

describe("useApp plot windows — item 8 (minimize/maximize/restore)", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  it("minimizing an UNFOCUSED window just flips its winState", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" }), win({ id: "w2" })], focusedWindowId: "w1" });
    useApp.getState().minimizeWindow("w2");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w2")?.winState).toBe("minimized");
    expect(s.focusedWindowId).toBe("w1"); // untouched
  });

  it("minimizing the FOCUSED window hands focus to the top-z remaining VISIBLE window", () => {
    useApp.setState({
      plotWindows: [
        win({ id: "w1", z: 0, view: { ...defaultPlotView(), plotTitle: "w1" } }),
        win({ id: "w2", z: 5, view: { ...defaultPlotView(), plotTitle: "w2" } }),
        win({ id: "w3", z: 9, winState: "minimized", view: { ...defaultPlotView(), plotTitle: "w3" } }),
      ],
      focusedWindowId: "w1",
      plotTitle: "live",
    });
    useApp.getState().minimizeWindow("w1");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w1")?.winState).toBe("minimized");
    expect(s.focusedWindowId).toBe("w2"); // top-z among VISIBLE survivors (w3 is minimized, excluded)
    expect(s.plotTitle).toBe("w2"); // hydrated
  });

  it("minimizing the only visible window with no other candidate leaves focus in place (still 'focused', just hidden)", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" });
    useApp.getState().minimizeWindow("w1");
    const s = useApp.getState();
    expect(s.plotWindows[0].winState).toBe("minimized");
    expect(s.focusedWindowId).toBe("w1");
  });

  it("restoreWindow un-minimizes AND focuses in one step, hydrating its view", () => {
    useApp.setState({
      plotWindows: [
        win({ id: "w1", view: { ...defaultPlotView(), plotTitle: "w1" } }),
        win({ id: "w2", winState: "minimized", view: { ...defaultPlotView(), plotTitle: "w2" } }),
      ],
      focusedWindowId: "w1",
      plotTitle: "live w1",
    });
    useApp.getState().restoreWindow("w2");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w2")?.winState).toBe("normal");
    expect(s.focusedWindowId).toBe("w2");
    expect(s.plotTitle).toBe("w2"); // hydrated
    expect(s.plotWindows.find((w) => w.id === "w1")?.view.plotTitle).toBe("live w1"); // snapshotted
  });

  it("restoreWindow is a no-op on a window that isn't minimized", () => {
    useApp.setState({ plotWindows: [win({ id: "w1" })], focusedWindowId: "w1" });
    const before = useApp.getState().plotWindows;
    useApp.getState().restoreWindow("w1");
    expect(useApp.getState().plotWindows).toBe(before);
  });

  it("toggleMaximizeWindow flips normal<->maximized and is a no-op on a minimized window", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", winState: "normal" }), win({ id: "w2", winState: "minimized" })],
      focusedWindowId: "w1",
    });
    useApp.getState().toggleMaximizeWindow("w1");
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.winState).toBe("maximized");
    useApp.getState().toggleMaximizeWindow("w1");
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.winState).toBe("normal");
    useApp.getState().toggleMaximizeWindow("w2");
    expect(useApp.getState().plotWindows.find((w) => w.id === "w2")?.winState).toBe("minimized");
  });
});

describe("useApp plot windows — item 9 (Origin figures / figure docs into new windows)", () => {
  const figureEntry = {
    id: "fig-1",
    stem: "XRD",
    datasetId: "d2",
    siblingIds: ["d2"],
    figure: {
      name: "Graph1",
      x_from: 18,
      x_to: 100,
      x_log: false,
      y_from: 1,
      y_to: 1e6,
      y_log: true,
      n_curves: 3,
      annotations: [] as string[],
    },
  };

  beforeEach(() => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "XRD:Book1", data: raw },
        { id: "d2", name: "XRD:Book2", data: raw },
      ],
      activeId: "d1",
      originFigures: [figureEntry],
      // Owner-routing item 1: every test in this block starts parked on
      // Worksheet so "opens a new window" assertions also cover "and
      // surfaces the Plot tab" without needing a separate fixture.
      stageTab: "worksheet",
    });
  });

  it("applyOriginFigure({newWindow:true}) opens + focuses a NEW window instead of overwriting the previously-focused one", () => {
    const before = useApp.getState().plotWindows.length;
    useApp.getState().applyOriginFigure("fig-1", { newWindow: true });
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(before + 1);
    const created = s.plotWindows.find((w) => w.datasetId === "d2" && s.focusedWindowId === w.id);
    expect(created).toBeDefined();
    expect(s.focusedWindowId).toBe(created!.id);
    expect(s.xLim).toEqual([18, 100]); // the apply logic landed on the NEW window
    expect(s.yScale).toBe("log");
    expect(s.stageTab).toBe("plot"); // item 1: surfaced even though we started on Worksheet
  });

  it("applyOriginFigure({newWindow:true}) titles the new window from the figure's label", () => {
    useApp.getState().applyOriginFigure("fig-1", { newWindow: true });
    const s = useApp.getState();
    const created = s.plotWindows.find((w) => w.id === s.focusedWindowId)!;
    expect(created.title).toContain("Graph1");
  });

  it("applyOriginFigure without newWindow keeps applying to the focused window (unchanged v1 behavior)", () => {
    const before = useApp.getState().plotWindows.length;
    useApp.getState().applyOriginFigure("fig-1");
    expect(useApp.getState().plotWindows).toHaveLength(before);
  });

  it("openFigureDocInWindow opens a new window bound to a LIVE doc's dataset and applies its channel/scale config", () => {
    useApp.getState().addFigureDoc({
      id: "doc-1",
      name: "My Figure",
      datasetId: "d2",
      live: true,
      config: {
        xKey: null,
        yKeys: [0],
        xScale: "linear",
        yScale: "log",
        title: "Doc Title",
        xLabel: "X",
        yLabel: "Y",
        style: "default",
        fmt: "pdf",
        dpi: 200,
        overrides: null,
        seriesStyles: null,
      },
    });
    const before = useApp.getState().plotWindows.length;
    useApp.getState().openFigureDocInWindow("doc-1");
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(before + 1);
    const created = s.plotWindows.find((w) => w.id === s.focusedWindowId)!;
    expect(created.datasetId).toBe("d2");
    expect(created.title).toBe("My Figure");
    expect(s.yScale).toBe("log");
    expect(s.plotTitle).toBe("Doc Title");
    expect(s.stageTab).toBe("plot"); // item 1: surfaced even though we started on Worksheet
  });

  it("openFigureDocInWindow is a no-op for a frozen doc or one with no resolved dataset", () => {
    useApp.getState().addFigureDoc({
      id: "doc-frozen",
      name: "Frozen",
      datasetId: null,
      live: false,
      dataSnapshot: raw,
      config: {
        xKey: null,
        yKeys: null,
        xScale: "linear",
        yScale: "linear",
        title: "",
        xLabel: "",
        yLabel: "",
        style: "default",
        fmt: "pdf",
        dpi: 200,
        overrides: null,
        seriesStyles: null,
      },
    });
    const before = useApp.getState().plotWindows.length;
    useApp.getState().openFigureDocInWindow("doc-frozen");
    expect(useApp.getState().plotWindows).toHaveLength(before);
  });
});

describe("useApp plot windows — item 10 (default titles, dedupe, rename)", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  it("createWindow defaults the title to the bound dataset's name", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "MyData", data: raw }],
      plotWindows: [win({ id: "w0", datasetId: null })],
      focusedWindowId: "w0",
    });
    const id = useApp.getState().createWindow("d1");
    expect(useApp.getState().plotWindows.find((w) => w.id === id)?.title).toBe("MyData");
  });

  it("createWindow dedupes against a window already showing the same name", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "MyData", data: raw }],
      plotWindows: [win({ id: "w1", datasetId: "d1" })],
      focusedWindowId: "w1",
    });
    const id = useApp.getState().createWindow("d1");
    expect(useApp.getState().plotWindows.find((w) => w.id === id)?.title).toBe("MyData (2)");
  });

  it("createWindow uses an explicit title verbatim, skipping the computed default", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "MyData", data: raw }],
      plotWindows: [win({ id: "w1", datasetId: "d1" })],
      focusedWindowId: "w1",
    });
    const id = useApp.getState().createWindow("d1", undefined, "Custom Name");
    expect(useApp.getState().plotWindows.find((w) => w.id === id)?.title).toBe("Custom Name");
  });

  it("duplicateWindow dedupes the source's OWN displayed title", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: raw }],
      plotWindows: [win({ id: "w1", title: "Comparison" })],
      focusedWindowId: "w1",
    });
    const id = useApp.getState().duplicateWindow("w1");
    expect(useApp.getState().plotWindows.find((w) => w.id === id)?.title).toBe("Comparison (2)");
  });

  it("renameWindow sets an explicit title verbatim (never deduped)", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1", title: "A" }), win({ id: "w2", title: "A" })],
      focusedWindowId: "w1",
    });
    useApp.getState().renameWindow("w2", "A"); // colliding on purpose — a user's explicit choice
    expect(useApp.getState().plotWindows.find((w) => w.id === "w2")?.title).toBe("A");
  });
});

describe("useApp plot windows — item 11 (snapshot-as-window)", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  const bundle = (): FrozenPlotBundle => ({
    payload: {
      data: [
        [1, 2, 3],
        [10, 20, 30],
      ] as FrozenPlotBundle["payload"]["data"],
      series: [{ label: "m", unit: "emu" }],
      xLabel: "t",
      xUnit: "s",
    },
    styleList: null,
    labelList: null,
    errorBars: [],
    plotted: [0],
    colorByColumns: [],
    hidden: null,
  });

  it("createSnapshotWindow freezes the live view onto a kind:'snapshot' window on top — focus/active untouched", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "alpha", data: raw }],
      activeId: "d1",
      plotWindows: [win({ id: "w1", bg: "light" })],
      focusedWindowId: "w1",
      yScale: "log",
      plotTitle: "live title",
    });
    const b = bundle();
    const id = useApp.getState().createSnapshotWindow(b);
    const s = useApp.getState();
    const snap = s.plotWindows.find((w) => w.id === id)!;
    expect(snap.kind).toBe("snapshot");
    expect(snap.datasetId).toBeNull(); // never dataset-bound
    expect(snap.title).toBe("Snapshot — alpha");
    expect(snap.snapshot).toBe(b);
    expect(snap.view.yScale).toBe("log"); // frozen from the LIVE singletons
    expect(snap.view.plotTitle).toBe("live title");
    expect(snap.bg).toBe("light"); // inherits the source window's override
    expect(snap.z).toBeGreaterThan(s.plotWindows.find((w) => w.id === "w1")!.z);
    expect(s.focusedWindowId).toBe("w1"); // snapshots never take focus
    expect(s.activeId).toBe("d1");
  });

  it("createSnapshotWindow dedupes successive titles and returns null with no focused window", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "alpha", data: raw }],
      plotWindows: [win({ id: "w1" })],
      focusedWindowId: "w1",
    });
    useApp.getState().createSnapshotWindow(bundle());
    const second = useApp.getState().createSnapshotWindow(bundle());
    expect(useApp.getState().plotWindows.find((w) => w.id === second)?.title).toBe(
      "Snapshot — alpha (2)",
    );
    useApp.setState({ focusedWindowId: null });
    expect(useApp.getState().createSnapshotWindow(bundle())).toBeNull();
  });

  it("focusWindow on a snapshot raises its z ONLY — no focus move, no view swap, no activeId retarget", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "alpha", data: raw }],
      activeId: "d1",
      selectedIds: ["d1"],
      plotWindows: [
        win({ id: "w1", z: 5, view: { ...defaultPlotView(), plotTitle: "w1 record" } }),
        win({ id: "s1", kind: "snapshot", datasetId: null, z: 1, snapshot: bundle() }),
      ],
      focusedWindowId: "w1",
      plotTitle: "live title",
    });
    useApp.getState().focusWindow("s1");
    const s = useApp.getState();
    expect(s.focusedWindowId).toBe("w1"); // still the plot window
    expect(s.plotTitle).toBe("live title"); // live singletons untouched
    expect(s.activeId).toBe("d1");
    expect(s.selectedIds).toEqual(["d1"]);
    // The outgoing plot window's record was NOT snapshot-swapped …
    expect(s.plotWindows.find((w) => w.id === "w1")?.view.plotTitle).toBe("w1 record");
    // … but the snapshot window did rise to the top.
    expect(s.plotWindows.find((w) => w.id === "s1")!.z).toBeGreaterThan(
      s.plotWindows.find((w) => w.id === "w1")!.z,
    );
  });

  it("closeWindow: the last PLOT window can't close while snapshots remain; the snapshot itself can", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "s1", kind: "snapshot", datasetId: null, snapshot: bundle() })],
      focusedWindowId: "w1",
    });
    useApp.getState().closeWindow("w1"); // no-op — w1 is the last plot window
    expect(useApp.getState().plotWindows.map((w) => w.id)).toEqual(["w1", "s1"]);
    useApp.getState().closeWindow("s1"); // snapshots always close freely
    expect(useApp.getState().plotWindows.map((w) => w.id)).toEqual(["w1"]);
    expect(useApp.getState().focusedWindowId).toBe("w1");
  });

  it("restoreWindow on a minimized snapshot un-minimizes + raises WITHOUT focusing it", () => {
    useApp.setState({
      plotWindows: [
        win({ id: "w1", z: 5 }),
        win({ id: "s1", kind: "snapshot", datasetId: null, z: 1, winState: "minimized", snapshot: bundle() }),
      ],
      focusedWindowId: "w1",
      plotTitle: "live title",
    });
    useApp.getState().restoreWindow("s1");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "s1")?.winState).toBe("normal");
    expect(s.plotWindows.find((w) => w.id === "s1")!.z).toBeGreaterThan(5);
    expect(s.focusedWindowId).toBe("w1"); // unlike a plot window's restore
    expect(s.plotTitle).toBe("live title");
  });

  it("minimizing the focused plot window skips a visible snapshot when handing off focus", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "s1", kind: "snapshot", datasetId: null, snapshot: bundle() })],
      focusedWindowId: "w1",
    });
    useApp.getState().minimizeWindow("w1");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w1")?.winState).toBe("minimized");
    expect(s.focusedWindowId).toBe("w1"); // no plot candidate — focus stays put
  });

  it("duplicateWindow on a snapshot yields another snapshot carrying the same frozen bundle", () => {
    const b = bundle();
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "s1", kind: "snapshot", datasetId: null, title: "Snap", snapshot: b })],
      focusedWindowId: "w1",
    });
    const id = useApp.getState().duplicateWindow("s1");
    const dup = useApp.getState().plotWindows.find((w) => w.id === id)!;
    expect(dup.kind).toBe("snapshot");
    expect(dup.snapshot).toBe(b);
    expect(dup.datasetId).toBeNull();
  });

  it("loadWorkspace round-trips a snapshot window and never lands focus on it", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
      plotWindows: [
        win({ id: "s1", kind: "snapshot", datasetId: null, snapshot: bundle() }),
        win({ id: "p1", datasetId: "d1" }),
      ],
      focusedWindowId: "s1", // a hand-edited doc pointing focus at the snapshot
    });
    const s = useApp.getState();
    expect(s.plotWindows.map((w) => w.id)).toEqual(["s1", "p1"]);
    expect(s.plotWindows.find((w) => w.id === "s1")?.snapshot?.payload.data).toEqual([
      [1, 2, 3],
      [10, 20, 30],
    ]);
    expect(s.focusedWindowId).toBe("p1"); // clamped to the first PLOT window
  });

  it("loadWorkspace appends a fresh main window when the doc's windows are ALL snapshots", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
      plotWindows: [win({ id: "s1", kind: "snapshot", datasetId: null, snapshot: bundle() })],
      focusedWindowId: "s1",
    });
    const s = useApp.getState();
    expect(s.plotWindows.some((w) => w.kind === "plot")).toBe(true);
    expect(s.plotWindows.find((w) => w.id === "s1")?.kind).toBe("snapshot"); // the snapshot survives
    const focused = s.plotWindows.find((w) => w.id === s.focusedWindowId);
    expect(focused?.kind).toBe("plot");
  });
});

describe("useApp plot windows — item 14 (drag-drop rebind + per-window pin)", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  // A dataset whose parser hint makes `defaultErrKeys` non-trivial, so the
  // "smart defaults" half of a rebind is distinguishable from a plain reset.
  const errData: DataStruct = {
    time: [1, 2, 3],
    values: [
      [10, 1],
      [20, 2],
      [30, 3],
    ],
    labels: ["R", "dR"],
    units: ["", ""],
    metadata: { error_channels: { "0": 1 } },
  };

  const seedTwoDatasets = () =>
    useApp.setState({
      datasets: [
        { id: "d1", name: "a", data: raw },
        { id: "d2", name: "b", data: errData },
      ],
      activeId: "d1",
      selectedIds: ["d1"],
    });

  it("rebindWindow on the FOCUSED window produces the SAME state as setActive (smart-defaults parity)", () => {
    const seed = () => {
      seedTwoDatasets();
      useApp.setState({
        plotWindows: [win({ id: "w1", datasetId: "d1" }), win({ id: "w2", datasetId: "d1" })],
        focusedWindowId: "w1",
        xLim: [0, 1],
        seriesStyles: { 0: { color: "#fff" } },
        plotTitle: "kept across rebinds",
        errKeys: {},
        stageTab: "worksheet",
        worksheetId: "d1",
      });
    };
    const pick = (s: ReturnType<typeof useApp.getState>) => ({
      activeId: s.activeId,
      selectedIds: s.selectedIds,
      worksheetId: s.worksheetId,
      stageTab: s.stageTab,
      bindings: s.plotWindows.map((w) => [w.id, w.datasetId]),
      xLim: s.xLim,
      xKey: s.xKey,
      seriesStyles: s.seriesStyles,
      errKeys: s.errKeys,
      hiddenChannels: s.hiddenChannels,
      plotTitle: s.plotTitle,
    });

    seed();
    useApp.getState().setActive("d2");
    const viaSetActive = pick(useApp.getState());

    seed();
    useApp.getState().rebindWindow("w1", "d2");
    const viaRebind = pick(useApp.getState());

    expect(viaRebind).toEqual(viaSetActive);
    // And both really produced the d2-derived smart defaults + resets.
    expect(viaRebind.errKeys).toEqual(defaultErrKeys(errData));
    expect(viaRebind.xLim).toBeNull();
    expect(viaRebind.seriesStyles).toEqual({});
    expect(viaRebind.plotTitle).toBe("kept across rebinds"); // titles survive a dataset switch
    expect(viaRebind.bindings).toEqual([
      ["w1", "d2"],
      ["w2", "d1"], // the unfocused window kept its binding
    ]);
  });

  it("rebindWindow on a BACKGROUND window rebinds + resets its stored view, never touching focus or the live view", () => {
    seedTwoDatasets();
    useApp.setState({
      plotWindows: [
        win({ id: "w1", datasetId: "d1" }),
        win({
          id: "w2",
          datasetId: "d1",
          view: {
            ...defaultPlotView(),
            xLim: [0, 1],
            seriesStyles: { 0: { color: "#fff" } },
            plotTitle: "w2 title",
          },
        }),
      ],
      focusedWindowId: "w1",
      xLim: [5, 6],
      plotTitle: "live w1",
    });
    useApp.getState().rebindWindow("w2", "d2");
    const s = useApp.getState();
    expect(s.focusedWindowId).toBe("w1"); // focus unchanged
    expect(s.activeId).toBe("d1"); // Library selection unchanged
    expect(s.xLim).toEqual([5, 6]); // live singleton view untouched
    expect(s.plotTitle).toBe("live w1");
    const w2 = s.plotWindows.find((w) => w.id === "w2")!;
    expect(w2.datasetId).toBe("d2");
    expect(w2.view.xLim).toBeNull(); // same dataset-derived reset setActive applies
    expect(w2.view.seriesStyles).toEqual({});
    expect(w2.view.errKeys).toEqual(defaultErrKeys(errData));
    expect(w2.view.plotTitle).toBe("w2 title"); // display config survives, like setActive
  });

  it("rebindWindow is a no-op for an unknown window or dataset id", () => {
    seedTwoDatasets();
    useApp.setState({ plotWindows: [win({ id: "w1", datasetId: "d1" })], focusedWindowId: "w1" });
    const before = useApp.getState().plotWindows;
    useApp.getState().rebindWindow("ghost", "d2");
    useApp.getState().rebindWindow("w1", "no-such-dataset");
    expect(useApp.getState().plotWindows).toBe(before);
    expect(useApp.getState().plotWindows[0].datasetId).toBe("d1");
  });

  it("an explicit rebindWindow rebinds even a PINNED focused window (deliberate beats passive)", () => {
    seedTwoDatasets();
    useApp.setState({
      plotWindows: [win({ id: "w1", datasetId: "d1", pinned: true }), win({ id: "w2", datasetId: "d1" })],
      focusedWindowId: "w1",
    });
    useApp.getState().rebindWindow("w1", "d2");
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(2); // no retarget, no new window
    expect(s.focusedWindowId).toBe("w1");
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("d2");
    expect(s.plotWindows.find((w) => w.id === "w1")?.pinned).toBe(true); // still pinned
    expect(s.plotWindows.find((w) => w.id === "w2")?.datasetId).toBe("d1");
  });

  it("createWindowAt places the new window at the drop point, clamped to the canvas bounds", () => {
    seedTwoDatasets();
    useApp.setState({
      plotWindows: [win({ id: "w1" })],
      focusedWindowId: "w1",
      plotCanvasBounds: { width: 800, height: 600 },
    });
    const id = useApp.getState().createWindowAt("d2", 790, 590); // near the corner
    const created = useApp.getState().plotWindows.find((w) => w.id === id)!;
    expect(created.datasetId).toBe("d2");
    expect(created.geometry).toEqual({ x: 800 - 480, y: 600 - 360, w: 480, h: 360 });
    expect(useApp.getState().focusedWindowId).toBe("w1"); // placement ≠ focus (the drop handler focuses)

    const id2 = useApp.getState().createWindowAt("d2", -10, -10);
    expect(useApp.getState().plotWindows.find((w) => w.id === id2)!.geometry).toMatchObject({ x: 0, y: 0 });
  });

  it("a Library click while the focused window is PINNED retargets the top-z unpinned VISIBLE window", () => {
    seedTwoDatasets();
    useApp.setState({
      plotWindows: [
        win({ id: "w1", datasetId: "d1", pinned: true, z: 10 }),
        win({ id: "w2", datasetId: "d1", z: 1 }),
        win({ id: "w3", datasetId: "d1", z: 5 }),
        win({ id: "w4", datasetId: "d1", z: 9, winState: "minimized" }), // top-z but hidden
      ],
      focusedWindowId: "w1",
      plotTitle: "pinned live view",
    });
    useApp.getState().setActive("d2");
    const s = useApp.getState();
    expect(s.focusedWindowId).toBe("w3"); // top-z among unpinned VISIBLE (w4 minimized, w2 lower)
    expect(s.plotWindows.find((w) => w.id === "w3")?.datasetId).toBe("d2");
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("d1"); // the pin held
    expect(s.plotWindows.find((w) => w.id === "w1")?.pinned).toBe(true);
    // Focus-away snapshotted the pinned window's live view into its record.
    expect(s.plotWindows.find((w) => w.id === "w1")?.view.plotTitle).toBe("pinned live view");
    expect(s.activeId).toBe("d2");
  });

  it("a Library click with NO unpinned visible candidate creates + focuses a fresh window on the dataset", () => {
    seedTwoDatasets();
    useApp.setState({
      plotWindows: [
        win({ id: "w1", datasetId: "d1", pinned: true }),
        win({ id: "w2", datasetId: "d1", pinned: true }),
        win({ id: "w3", datasetId: "d1", winState: "minimized" }), // unpinned but hidden
      ],
      focusedWindowId: "w1",
    });
    useApp.getState().setActive("d2");
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(4);
    const created = s.plotWindows.find((w) => !["w1", "w2", "w3"].includes(w.id))!;
    expect(s.focusedWindowId).toBe(created.id);
    expect(created.datasetId).toBe("d2");
    expect(created.pinned).toBe(false);
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("d1"); // both pins held
    expect(s.plotWindows.find((w) => w.id === "w2")?.datasetId).toBe("d1");
  });

  it("setActive with the focused window UNPINNED behaves exactly as before (no retarget, no new window)", () => {
    seedTwoDatasets();
    useApp.setState({
      plotWindows: [win({ id: "w1", datasetId: "d1" }), win({ id: "w2", datasetId: "d1" })],
      focusedWindowId: "w1",
    });
    useApp.getState().setActive("d2");
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(2);
    expect(s.focusedWindowId).toBe("w1");
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("d2");
  });

  it("addDataset honors the pin: the import lands in the retargeted window, never the pinned one", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: raw }],
      plotWindows: [win({ id: "w1", datasetId: "d1", pinned: true }), win({ id: "w2", datasetId: "d1" })],
      focusedWindowId: "w1",
    });
    useApp.getState().addDataset({ id: "new1", name: "fresh.dat", data: raw });
    const s = useApp.getState();
    expect(s.focusedWindowId).toBe("w2");
    expect(s.plotWindows.find((w) => w.id === "w2")?.datasetId).toBe("new1");
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("d1"); // the pin held
    expect(s.activeId).toBe("new1");
  });

  it("addDataset with NO candidate creates + focuses a fresh window titled after the import", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "a", data: raw }],
      plotWindows: [win({ id: "w1", datasetId: "d1", pinned: true })],
      focusedWindowId: "w1",
    });
    useApp.getState().addDataset({ id: "new1", name: "fresh.dat", data: raw });
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(2);
    const created = s.plotWindows.find((w) => w.id !== "w1")!;
    expect(s.focusedWindowId).toBe(created.id);
    expect(created.datasetId).toBe("new1");
    expect(created.title).toBe("fresh.dat"); // named from the import (dataset not in store at create time)
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("d1");
  });

  it("toggleWindowPin flips one window's pin; unknown id is a no-op", () => {
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "w2" })],
      focusedWindowId: "w1",
    });
    useApp.getState().toggleWindowPin("w1");
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.pinned).toBe(true);
    expect(useApp.getState().plotWindows.find((w) => w.id === "w2")?.pinned).toBe(false);
    useApp.getState().toggleWindowPin("w1");
    expect(useApp.getState().plotWindows.find((w) => w.id === "w1")?.pinned).toBe(false);
    useApp.getState().toggleWindowPin("ghost");
    expect(useApp.getState().plotWindows.map((w) => w.pinned)).toEqual([false, false]);
  });
});

describe("useApp plot windows — item 17 (worksheet/map document windows, full MDI)", () => {
  const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    view: defaultPlotView(),
    bg: "theme",
    linkGroup: null,
    pinned: false,
    ...over,
  });

  const seed = () =>
    useApp.setState({
      datasets: [{ id: "d1", name: "alpha", data: raw }],
      activeId: "d1",
      selectedIds: ["d1"],
      plotWindows: [win({ id: "w1" })],
      focusedWindowId: "w1",
    });

  it("createDocumentWindow adds a live-bound document window on top — focus/active untouched, title deduped", () => {
    seed();
    const id = useApp.getState().createDocumentWindow("worksheet", "d1");
    const s = useApp.getState();
    const doc = s.plotWindows.find((w) => w.id === id)!;
    expect(doc.kind).toBe("worksheet");
    expect(doc.datasetId).toBe("d1"); // LIVE binding — unlike a snapshot
    // w1 (untitled, bound to d1) already displays "alpha" → the new window
    // dedupes to "alpha (2)" (item 10's convention).
    expect(doc.title).toBe("alpha (2)");
    expect(doc.winState).toBe("normal");
    expect(doc.z).toBeGreaterThan(s.plotWindows.find((w) => w.id === "w1")!.z);
    expect(doc.view).toEqual(defaultPlotView()); // required by the model, unused
    expect(s.focusedWindowId).toBe("w1"); // document windows never take focus
    expect(s.activeId).toBe("d1");
  });

  it("createDocumentWindow with an unknown dataset id creates an UNBOUND window, never a dangling ref", () => {
    seed();
    const id = useApp.getState().createDocumentWindow("map", "ghost");
    const doc = useApp.getState().plotWindows.find((w) => w.id === id)!;
    expect(doc.kind).toBe("map");
    expect(doc.datasetId).toBeNull(); // the decision-#4 empty state
  });

  it("focusWindow on a document window raises its z ONLY — no focus move, no view swap, no activeId retarget", () => {
    seed();
    useApp.setState({
      plotWindows: [
        win({ id: "w1", z: 5, view: { ...defaultPlotView(), plotTitle: "w1 record" } }),
        win({ id: "ws1", kind: "worksheet", z: 1 }),
      ],
      focusedWindowId: "w1",
      plotTitle: "live title",
    });
    useApp.getState().focusWindow("ws1");
    const s = useApp.getState();
    expect(s.focusedWindowId).toBe("w1"); // still the plot window
    expect(s.plotTitle).toBe("live title"); // live singletons untouched
    expect(s.activeId).toBe("d1");
    // The outgoing plot window's record was NOT snapshot-swapped …
    expect(s.plotWindows.find((w) => w.id === "w1")?.view.plotTitle).toBe("w1 record");
    // … but the document window did rise to the top.
    expect(s.plotWindows.find((w) => w.id === "ws1")!.z).toBeGreaterThan(
      s.plotWindows.find((w) => w.id === "w1")!.z,
    );
  });

  it("closeWindow: a document window always closes; the last PLOT window can't close while documents remain", () => {
    seed();
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet" }), win({ id: "m1", kind: "map" })],
      focusedWindowId: "w1",
    });
    useApp.getState().closeWindow("w1"); // no-op — w1 is the last plot window
    expect(useApp.getState().plotWindows.map((w) => w.id)).toEqual(["w1", "ws1", "m1"]);
    useApp.getState().closeWindow("ws1"); // documents always close freely
    useApp.getState().closeWindow("m1");
    expect(useApp.getState().plotWindows.map((w) => w.id)).toEqual(["w1"]);
    expect(useApp.getState().focusedWindowId).toBe("w1");
  });

  it("removeDataset nulls a document window's binding without closing it (LIVE binding, decision #4)", () => {
    seed();
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet" })],
      focusedWindowId: "w1",
    });
    useApp.getState().removeDataset("d1");
    const s = useApp.getState();
    expect(s.plotWindows.map((w) => w.id)).toEqual(["w1", "ws1"]); // neither force-closed
    expect(s.plotWindows.find((w) => w.id === "ws1")?.datasetId).toBeNull();
  });

  it("rebindWindow on a document window retargets the binding ONLY — view, focus, and live singletons untouched", () => {
    seed();
    useApp.setState({
      datasets: [
        { id: "d1", name: "alpha", data: raw },
        { id: "d2", name: "beta", data: raw },
      ],
      plotWindows: [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet" })],
      focusedWindowId: "w1",
      plotTitle: "live title",
    });
    const viewBefore = useApp.getState().plotWindows.find((w) => w.id === "ws1")!.view;
    useApp.getState().rebindWindow("ws1", "d2");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "ws1")?.datasetId).toBe("d2");
    expect(s.plotWindows.find((w) => w.id === "ws1")?.view).toBe(viewBefore); // no view reset (same object)
    expect(s.focusedWindowId).toBe("w1");
    expect(s.activeId).toBe("d1");
    expect(s.plotTitle).toBe("live title");
  });

  it("rebindWindow on a snapshot window is a no-op (frozen means frozen — a drop never half-rebinds it)", () => {
    seed();
    const bundle: FrozenPlotBundle = {
      payload: {
        data: [[0], [1]] as FrozenPlotBundle["payload"]["data"],
        series: [{ label: "m", unit: "" }],
        xLabel: "x",
        xUnit: "",
      },
      styleList: null,
      labelList: null,
      errorBars: [],
      plotted: [0],
      colorByColumns: [],
      hidden: null,
    };
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "s1", kind: "snapshot", datasetId: null, snapshot: bundle })],
      focusedWindowId: "w1",
    });
    useApp.getState().rebindWindow("s1", "d1");
    expect(useApp.getState().plotWindows.find((w) => w.id === "s1")?.datasetId).toBeNull();
  });

  it("a pinned focused window's PASSIVE rebind never retargets a document window — it creates a fresh plot window", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "alpha", data: raw },
        { id: "d2", name: "beta", data: raw },
      ],
      activeId: "d1",
      selectedIds: ["d1"],
      // The ONLY other visible window is a worksheet document — kind-guarded
      // out of the candidate set, so the retarget must create a new window.
      plotWindows: [win({ id: "w1", pinned: true }), win({ id: "ws1", kind: "worksheet" })],
      focusedWindowId: "w1",
    });
    useApp.getState().setActive("d2");
    const s = useApp.getState();
    expect(s.plotWindows).toHaveLength(3);
    const created = s.plotWindows.find((w) => !["w1", "ws1"].includes(w.id))!;
    expect(created.kind).toBe("plot");
    expect(s.focusedWindowId).toBe(created.id);
    expect(created.datasetId).toBe("d2");
    expect(s.plotWindows.find((w) => w.id === "w1")?.datasetId).toBe("d1"); // the pin held
    expect(s.plotWindows.find((w) => w.id === "ws1")?.datasetId).toBe("d1"); // the document untouched
  });

  it("minimizing the focused plot window skips a visible document window when handing off focus", () => {
    seed();
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet" })],
      focusedWindowId: "w1",
    });
    useApp.getState().minimizeWindow("w1");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "w1")?.winState).toBe("minimized");
    expect(s.focusedWindowId).toBe("w1"); // no plot candidate — focus stays put
  });

  it("restoreWindow on a minimized document window un-minimizes + raises WITHOUT focusing it", () => {
    seed();
    useApp.setState({
      plotWindows: [win({ id: "w1", z: 5 }), win({ id: "ws1", kind: "worksheet", z: 1, winState: "minimized" })],
      focusedWindowId: "w1",
      plotTitle: "live title",
    });
    useApp.getState().restoreWindow("ws1");
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "ws1")?.winState).toBe("normal");
    expect(s.plotWindows.find((w) => w.id === "ws1")!.z).toBeGreaterThan(5);
    expect(s.focusedWindowId).toBe("w1"); // unlike a plot window's restore
    expect(s.plotTitle).toBe("live title");
  });

  it("loadWorkspace round-trips a document window's live binding and appends a fresh main window when ALL windows are documents", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ id: "d1", name: "a", data: raw }],
      activeId: "d1",
      plotWindows: [win({ id: "ws1", kind: "worksheet" })],
      focusedWindowId: "ws1", // a hand-edited doc pointing focus at the document
    });
    const s = useApp.getState();
    expect(s.plotWindows.find((w) => w.id === "ws1")?.kind).toBe("worksheet"); // survives
    expect(s.plotWindows.find((w) => w.id === "ws1")?.datasetId).toBe("d1"); // binding restored
    const focused = s.plotWindows.find((w) => w.id === s.focusedWindowId);
    expect(focused?.kind).toBe("plot"); // the appended main window took focus
  });

  // GUI_INTERACTION #14: a worksheet document window's row selection lives in
  // `worksheetSelections`, keyed by its OWN window id — closing/rebinding it
  // must not leak a stale entry that could resurface on an unrelated future
  // window (id reuse across a long session, or a coincidental datasetId match).
  it("closeWindow drops the closed document window's worksheetSelections entry (no leak)", () => {
    seed();
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet" })],
      focusedWindowId: "w1",
      worksheetSelections: { ws1: { datasetId: "d1", rows: [0, 1] } },
    });
    useApp.getState().closeWindow("ws1"); // background window — the non-focused branch
    expect(useApp.getState().worksheetSelections.ws1).toBeUndefined();
  });

  it("closeWindow drops the entry even when closing the FOCUSED window (the refocus branch)", () => {
    seed();
    useApp.setState({
      plotWindows: [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet" })],
      focusedWindowId: "ws1",
      worksheetSelections: { ws1: { datasetId: "d1", rows: [2] } },
    });
    useApp.getState().closeWindow("ws1");
    expect(useApp.getState().worksheetSelections.ws1).toBeUndefined();
    expect(useApp.getState().focusedWindowId).toBe("w1");
  });

  it("rebindWindow on a document window leaves its OLD selection entry stale — self-heals via the datasetId guard, never rebinds it to the new dataset", () => {
    seed();
    useApp.setState({
      datasets: [
        { id: "d1", name: "alpha", data: raw },
        { id: "d2", name: "beta", data: raw },
      ],
      plotWindows: [win({ id: "w1" }), win({ id: "ws1", kind: "worksheet" })],
      focusedWindowId: "w1",
      worksheetSelections: { ws1: { datasetId: "d1", rows: [0] } },
    });
    useApp.getState().rebindWindow("ws1", "d2");
    // Same "live only if datasetId still matches" contract useWorksheetView
    // reads through: the entry still names the OLD dataset, so it reads as
    // empty for the window's NEW binding — the old rows never leak forward.
    expect(useApp.getState().worksheetSelections.ws1?.datasetId).toBe("d1");
  });

  it("loadWorkspace resets worksheetSelections — transient UI state never round-trips", () => {
    useApp.setState({ worksheetSelections: { ws1: { datasetId: "d1", rows: [0] } } });
    useApp.getState().loadWorkspace({ datasets: [{ id: "d1", name: "a", data: raw }], activeId: "d1" });
    expect(useApp.getState().worksheetSelections).toEqual({});
  });
});
