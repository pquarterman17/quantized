import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyCorrections as applyCorrectionsApi,
  guessImportSettings,
  parseImportText,
  uploadFile,
} from "../lib/api";
import { effectiveChannels } from "../lib/plotdata";
import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
}));

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
    status: "",
    originFigures: [],
    folders: [],
    expandedFolders: [],
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
  it("inserts an independent copy right after the source and activates it", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "first.dat", data: raw },
        { id: "d2", name: "second.dat", data: raw },
      ],
      activeId: "d2",
    });

    useApp.getState().duplicateDataset("d1");

    const ds = useApp.getState().datasets;
    expect(ds.map((d) => d.name)).toEqual(["first.dat", "first.dat (copy)", "second.dat"]);
    const copy = ds[1];
    expect(copy.id).not.toBe("d1");
    expect(useApp.getState().activeId).toBe(copy.id); // copy becomes active
    // Deep copy: the clone's arrays are independent of the source.
    expect(copy.data).toEqual(raw);
    expect(copy.data.values).not.toBe(raw.values);
  });

  it("carries raw / corrections / bgRef onto the copy", () => {
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

    useApp.getState().duplicateDataset("d1");
    const copy = useApp.getState().datasets[1];
    expect(copy.raw).toEqual(raw);
    expect(copy.corrections).toEqual({ yOff: 5 });
    expect(copy.bgRef).toEqual({ datasetId: "bg", interp: "pchip" });
    expect(copy.corrections).not.toBe(useApp.getState().datasets[0].corrections); // independent
  });

  it("is a no-op for an unknown id", () => {
    useApp.setState({ datasets: [{ id: "d1", name: "x", data: raw }], activeId: "d1" });
    useApp.getState().duplicateDataset("ghost");
    expect(useApp.getState().datasets).toHaveLength(1);
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
    });
    await useApp.getState().importFiles([fakeFile("XRD.opj")]);

    const s = useApp.getState();
    expect(s.originFigures).toHaveLength(1);
    expect(s.originFigures[0].stem).toBe("XRD");
    const book2 = s.datasets.find((d) => d.name === "XRD:Book2");
    expect(s.originFigures[0].datasetId).toBe(book2?.id);
    // figures never leak into the DataStruct payload itself (data contract).
    expect(s.datasets.every((d) => !("figures" in d.data))).toBe(true);
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
      xLog: false,
      yLog: false,
    });
  });

  it("activates the resolved dataset and applies the axis/log snapshot", () => {
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
    expect(s.xLim).toEqual([18, 100]);
    expect(s.yLim).toEqual([1, 1e6]);
    expect(s.xLog).toBe(false);
    expect(s.yLog).toBe(true);
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
      xLog: false,
      yLog: false,
      yKeys: null,
      y2Keys: null,
    });
  });

  it("applying layer 1 plots the UNION of both layers, y2Keys tags layer 2's on the right", () => {
    useApp.getState().applyOriginFigure("fig-XRD-0");
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
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
    expect(s.y2Log).toBe(false);
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
    });
  });

  it("arranges a 2-layer stack using real decoded frame geometry ('Fixed Lambdas SI'!Graph6 shape)", () => {
    const top = mkEntry("fig-0", 1, "p1", "Book1", { left: 0, top: 0, right: 995, bottom: 480 }, [0, 100]);
    const bottom = mkEntry("fig-1", 2, "p2", "Book2", { left: 0, top: 520, right: 995, bottom: 990 }, [0, 200]);
    useApp.setState({ originFigures: [top, bottom] });
    useApp.getState().applyOriginFigure("fig-0");
    const s = useApp.getState();
    expect(s.stackMode).toBe(true);
    expect(s.spatialPanels).toEqual([
      expect.objectContaining({ datasetId: "p1", row: 0, col: 0, xLim: [0, 10], yLim: [0, 100] }),
      expect.objectContaining({ datasetId: "p2", row: 1, col: 0, xLim: [0, 10], yLim: [0, 200] }),
    ]);
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
    useApp.getState().setYLog(true);
    expect(useApp.getState().macroSteps).toHaveLength(0);
  });

  it("captures curated actions once recording", () => {
    useApp.getState().startMacro();
    useApp.getState().setYLog(true);
    useApp.getState().setXKey(2);
    const steps = useApp.getState().macroSteps;
    expect(steps.map((s) => s.code)).toEqual(["qz.setYLog(true)", "qz.setXKey(2)"]);
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
    useApp.getState().setYLog(true);
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
