import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi, uploadFile } from "../lib/api";
import type { DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({ applyCorrections: vi.fn(), uploadFile: vi.fn() }));

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [], activeId: null, status: "" });
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
    useApp.getState().loadWorkspace([{ id: "w1", name: "n", data: raw }]);
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

  it("continues past a bad file and reports the failure", async () => {
    vi.mocked(uploadFile)
      .mockRejectedValueOnce(new Error("unknown format"))
      .mockResolvedValueOnce(raw);
    await useApp.getState().importFiles([fakeFile("bad.zzz"), fakeFile("good.dat")]);

    expect(useApp.getState().datasets).toHaveLength(1);
    expect(useApp.getState().datasets[0].name).toBe("good.dat");
    expect(useApp.getState().status).toContain("failed bad.zzz");
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

    useApp.getState().loadWorkspace([
      { id: "w1", name: "first", data: raw },
      { id: "w2", name: "second", data: raw },
    ]);

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
    useApp.getState().loadWorkspace([]);
    expect(useApp.getState().datasets).toEqual([]);
    expect(useApp.getState().activeId).toBeNull();
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
  it("defaults to natural / 200 and updates via setters", () => {
    expect(useApp.getState().mapMethod).toBe("natural");
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
