// Tests for MAIN_PLAN #10 (re-import a dataset from its source file). Six
// branches per the plan: shape-preserved keeps exclusions/roles; row-count
// change clears + toasts; corrections re-applied through the chokepoint;
// no-source fallback (file picker); failure leaves state untouched; undo
// restores the pre-reimport dataset in one step.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi, importFile, uploadFile } from "../lib/api";
import { askConfirm } from "../components/overlays/ConfirmDialog";
import { createFigureDocument, type FigureDocument } from "../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { DataStruct, Dataset } from "../lib/types";
import { toast } from "./toasts";
import { useApp } from "./useApp";

vi.mock("../lib/api", () => ({
  applyCorrections: vi.fn(),
  uploadFile: vi.fn(),
  fetchBookData: vi.fn(),
  importFile: vi.fn(),
  guessImportSettings: vi.fn(),
  parseImportText: vi.fn(),
}));

const openFilePickerMock = vi.fn();
vi.mock("../lib/openFilePicker", () => ({
  IMPORT_ACCEPT: "",
  openFilePicker: (...args: unknown[]) => openFilePickerMock(...(args as [(files: File[]) => void, string?])),
}));

vi.mock("./toasts", () => ({ toast: vi.fn() }));
vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

const fresh: DataStruct = {
  time: [1, 2, 3],
  values: [[11], [21], [31]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

function baseDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "sample.dat",
    data: raw,
    source: { kind: "path", path: "/data/sample.dat" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    worksheetId: null,
    originFigures: [],
    reports: [],
    figureDocs: [],
    editableFigures: [],
    history: [],
    future: [],
    status: "",
    groupKey: null,
  });
});

describe("reimportDataset — shape preserved", () => {
  it("keeps excludedRows/filter/channelRoles/formulas when the shape is unchanged", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({
      datasets: [
        baseDataset({
          excludedRows: [1],
          filter: [{ col: 0, kind: "range", min: 0, max: 100 }],
          channelRoles: { 0: "label" },
          channelTypes: { 0: "continuous" },
        }),
      ],
    });

    await useApp.getState().reimportDataset("d1");

    expect(importFile).toHaveBeenCalledWith("/data/sample.dat");
    const ds = useApp.getState().datasets[0];
    expect(ds.data).toEqual(fresh);
    expect(ds.excludedRows).toEqual([1]);
    expect(ds.filter).toEqual([{ col: 0, kind: "range", min: 0, max: 100 }]);
    expect(ds.channelRoles).toEqual({ 0: "label" });
    expect(ds.channelTypes).toEqual({ 0: "continuous" });
    // identity fields preserved
    expect(ds.id).toBe("d1");
    expect(ds.name).toBe("sample.dat");
  });

  it("keeps the live view's channel-keyed state when the shape is unchanged", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh); // same 1-column shape
    useApp.setState({
      datasets: [baseDataset()],
      activeId: "d1",
      hiddenChannels: [0],
      seriesStyles: { 0: { color: "#ff0000" } },
    });

    await useApp.getState().reimportDataset("d1");

    const s = useApp.getState();
    expect(s.hiddenChannels).toEqual([0]); // unchanged shape → styles still apply
    expect(s.seriesStyles).toEqual({ 0: { color: "#ff0000" } });
  });

  it("keeps id/name/tags/group/notes across the swap", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({
      datasets: [baseDataset({ tags: ["MvsH"], group: "batch1", notes: "sample A" })],
    });
    await useApp.getState().reimportDataset("d1");
    const ds = useApp.getState().datasets[0];
    expect(ds.tags).toEqual(["MvsH"]);
    expect(ds.group).toBe("batch1");
    expect(ds.notes).toBe("sample A");
  });
});

describe("reimportDataset — row/column count change", () => {
  it("clears row/column-indexed state and toasts on a row-count change", async () => {
    vi.mocked(importFile).mockResolvedValue({ ...fresh, time: [1, 2], values: [[11], [21]] });
    useApp.setState({
      datasets: [baseDataset({ excludedRows: [1], filter: [{ col: 0, kind: "range", min: 0, max: 100 }] })],
    });

    await useApp.getState().reimportDataset("d1");

    const ds = useApp.getState().datasets[0];
    expect(ds.excludedRows).toBeUndefined();
    expect(ds.filter).toBeUndefined();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("changed shape"), "info");
  });

  it("clears row/column-indexed state on a BASE column-count change", async () => {
    vi.mocked(importFile).mockResolvedValue({
      ...fresh,
      labels: ["m", "T"],
      units: ["emu", "K"],
      values: [[11, 1], [21, 2], [31, 3]],
    });
    useApp.setState({ datasets: [baseDataset({ channelRoles: { 0: "label" } })] });

    await useApp.getState().reimportDataset("d1");

    expect(useApp.getState().datasets[0].channelRoles).toBeUndefined();
  });

  // The dataset-scoped clear above had a parallel VIEW-scoped gap: the live
  // singleton view AND every window's stored view kept channel-keyed state
  // (styles/hidden/keys) indexing the OLD columns (noted 2026-07-21, fixed).
  it("resets the live view's channel-keyed state on a shape change (active dataset)", async () => {
    vi.mocked(importFile).mockResolvedValue({
      ...fresh,
      labels: ["m", "T"],
      units: ["emu", "K"],
      values: [[11, 1], [21, 2], [31, 3]],
    });
    useApp.setState({
      datasets: [baseDataset()],
      activeId: "d1",
      hiddenChannels: [0],
      seriesStyles: { 0: { color: "#ff0000" } },
      yKeys: [0],
    });

    await useApp.getState().reimportDataset("d1");

    const s = useApp.getState();
    expect(s.hiddenChannels).toEqual([]); // reset to the new shape's defaults
    expect(s.seriesStyles).toEqual({});
    expect(s.yKeys).toBeNull();
  });

  it("resets a background window's view on a shape change, not just the singleton", async () => {
    vi.mocked(importFile).mockResolvedValue({
      ...fresh,
      labels: ["m", "T"],
      units: ["emu", "K"],
      values: [[11, 1], [21, 2], [31, 3]],
    });
    const bgWindow: PlotWindow = {
      id: "wBg",
      kind: "plot",
      title: "",
      datasetId: "d1",
      geometry: { x: 0, y: 0, w: 480, h: 360 },
      z: 0,
      winState: "normal",
      bg: "theme",
      linkGroup: null,
      pinned: false,
      view: { ...defaultPlotView(), hiddenChannels: [0], seriesStyles: { 0: { color: "#0000ff" } } },
    };
    // activeId stays null (beforeEach) so the singleton branch is skipped —
    // any reset of the window's view can only come from the window walk.
    useApp.setState({ datasets: [baseDataset()], plotWindows: [bgWindow] });

    await useApp.getState().reimportDataset("d1");

    const win = useApp.getState().plotWindows.find((w) => w.id === "wBg")!;
    expect(win.view.hiddenChannels).toEqual([]);
    expect(win.view.seriesStyles).toEqual({});
  });

  // commitReimport reset the live view AND every bound plotWindows entry on a
  // shape change, but store/figureLifecycle.ts's `editableFigures` (a SAVED,
  // possibly-closed FigureDocument) landed later (4bdd56c, after reimport.ts's
  // last revision 40d4556) and was never wired in — its bindings/view stayed
  // stale, silently rendering the wrong columns when reopened. The bound
  // figure's indices here are IN RANGE under both layouts — a column-count
  // change still resets them, because an in-range index is not proof its
  // column still means the same thing.
  it("resets a bound saved figure's bindings/view state on a column-count change; an unbound figure is untouched", async () => {
    vi.mocked(importFile).mockResolvedValue({
      ...fresh,
      values: [[11, 300], [21, 301], [31, 302]],
      labels: ["m", "T"],
      units: ["emu", "K"],
    });
    const bound: FigureDocument = createFigureDocument({
      id: "fig-bound",
      name: "Bound",
      datasetId: "d1",
      view: {
        ...defaultPlotView(),
        yKeys: [0],
        seriesStyles: { 0: { color: "#ff0000" } },
        hiddenChannels: [0],
      },
      errors: [{ channel: 0, target: 0, axis: "y", side: "both" }],
    });
    const unbound: FigureDocument = createFigureDocument({
      id: "fig-unbound",
      name: "Unbound",
      datasetId: "d2",
      view: {
        ...defaultPlotView(),
        yKeys: [0],
        seriesStyles: { 0: { color: "#00ff00" } },
        hiddenChannels: [0],
      },
      errors: [{ channel: 0, target: 0, axis: "y", side: "both" }],
    });
    useApp.setState({ datasets: [baseDataset()], editableFigures: [bound, unbound] });

    await useApp.getState().reimportDataset("d1");

    const figures = useApp.getState().editableFigures;
    const resetBound = figures.find((d) => d.id === "fig-bound")!;
    const stillUnbound = figures.find((d) => d.id === "fig-unbound")!;
    expect(resetBound.bindings.yKeys).toBeNull();
    expect(resetBound.bindings.errors).toEqual([]);
    expect(resetBound.plot.view.seriesStyles).toEqual({});
    expect(resetBound.plot.view.hiddenChannels).toEqual([]);
    expect(stillUnbound).toBe(unbound); // different dataset — same reference, untouched
  });

  // Row-only reshapes never disturb saved figures: column meaning is provably
  // intact, and a durable document's styling should survive — unlike the live
  // view/window reset, which fires on any shape change.
  it("leaves saved figures untouched (same array reference) on a row-only reshape", async () => {
    vi.mocked(importFile).mockResolvedValue({ ...fresh, time: [1, 2], values: [[11], [21]] });
    const bound: FigureDocument = createFigureDocument({
      id: "fig-bound",
      name: "Bound",
      datasetId: "d1",
      view: { ...defaultPlotView(), yKeys: [0], seriesStyles: { 0: { color: "#ff0000" } } },
    });
    const initial = [bound];
    useApp.setState({ datasets: [baseDataset()], editableFigures: initial });

    await useApp.getState().reimportDataset("d1");

    expect(useApp.getState().editableFigures).toBe(initial);
  });

  it("leaves editableFigures untouched (same array reference) on a same-shape reimport", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh); // same 1-column shape
    const bound: FigureDocument = createFigureDocument({
      id: "fig-bound",
      name: "Bound",
      datasetId: "d1",
      view: { ...defaultPlotView(), yKeys: [0] },
    });
    const initial = [bound];
    useApp.setState({ datasets: [baseDataset()], editableFigures: initial });

    await useApp.getState().reimportDataset("d1");

    expect(useApp.getState().editableFigures).toBe(initial);
  });
});

describe("reimportDataset — corrections re-applied", () => {
  it("re-applies stored corrections to the fresh raw through applyCorrectionsApi", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    const corrected = { ...fresh, values: [[111], [211], [311]] };
    vi.mocked(applyCorrectionsApi).mockResolvedValue(corrected);
    useApp.setState({
      datasets: [baseDataset({ raw, corrections: { yOff: 5 } })],
    });

    await useApp.getState().reimportDataset("d1");

    expect(applyCorrectionsApi).toHaveBeenCalledWith({ dataset: fresh, params: { yOff: 5 } });
    const ds = useApp.getState().datasets[0];
    expect(ds.raw).toEqual(fresh); // the new PRISTINE raw
    expect(ds.data).toEqual(corrected); // the re-corrected data
    expect(ds.corrections).toEqual({ yOff: 5 }); // params unchanged
  });

  it("does not call applyCorrectionsApi when the dataset has no stored corrections", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [baseDataset()] });
    await useApp.getState().reimportDataset("d1");
    expect(applyCorrectionsApi).not.toHaveBeenCalled();
    expect(useApp.getState().datasets[0].data).toEqual(fresh);
  });
});

describe("reimportDataset — no-source fallback", () => {
  it("opens the file picker and uploads instead of calling importFile", async () => {
    const file = new File(["x"], "sample.dat");
    openFilePickerMock.mockImplementation((onPick: (files: File[]) => void) => onPick([file]));
    vi.mocked(uploadFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [baseDataset({ source: undefined })] });

    await useApp.getState().reimportDataset("d1");

    expect(openFilePickerMock).toHaveBeenCalled();
    expect(uploadFile).toHaveBeenCalledWith(file);
    expect(importFile).not.toHaveBeenCalled();
    const ds = useApp.getState().datasets[0];
    expect(ds.data).toEqual(fresh);
    expect(ds.source).toBeUndefined(); // an upload still never learns a path
  });

  it("does nothing when the picker is cancelled (no file chosen)", async () => {
    openFilePickerMock.mockImplementation(() => {
      /* user cancelled — onPick never called, so the returned promise never
       * resolves either (matches every other openFilePicker call site). */
    });
    useApp.setState({ datasets: [baseDataset({ source: undefined })] });

    void useApp.getState().reimportDataset("d1"); // never resolves — don't await
    await Promise.resolve();

    expect(uploadFile).not.toHaveBeenCalled();
    expect(useApp.getState().datasets[0].data).toEqual(raw);
  });
});

describe("reimportDataset — failure leaves state untouched", () => {
  it("a rejected importFile leaves the dataset and history untouched", async () => {
    vi.mocked(importFile).mockRejectedValue(new Error("file not found"));
    useApp.setState({ datasets: [baseDataset()] });

    await useApp.getState().reimportDataset("d1");

    const ds = useApp.getState().datasets[0];
    expect(ds.data).toEqual(raw);
    expect(useApp.getState().history).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("failed"), "danger");
  });

  it("a book no longer present in the refreshed file leaves the dataset untouched", async () => {
    vi.mocked(importFile).mockResolvedValue({
      ...fresh,
      books: [{ lazy: false, primary: true, id: "Book1", labels: ["m"], units: ["emu"], metadata: {}, rows: 3, cols: 1 }],
    });
    useApp.setState({
      datasets: [baseDataset({ data: { ...raw, metadata: { origin_book: "Book9" } } })],
    });

    await useApp.getState().reimportDataset("d1");

    expect(useApp.getState().datasets[0].data.metadata.origin_book).toBe("Book9");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("a rejected applyCorrectionsApi (during re-apply) leaves the dataset untouched", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    vi.mocked(applyCorrectionsApi).mockRejectedValue(new Error("boom"));
    useApp.setState({ datasets: [baseDataset({ raw, corrections: { yOff: 5 } })] });

    await useApp.getState().reimportDataset("d1");

    const ds = useApp.getState().datasets[0];
    expect(ds.data).toEqual(raw);
    expect(useApp.getState().history).toHaveLength(0);
  });
});

describe("reimportDataset — undo", () => {
  it("undo restores the pre-reimport dataset in ONE step", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [baseDataset()] });

    await useApp.getState().reimportDataset("d1");
    expect(useApp.getState().datasets[0].data).toEqual(fresh);
    expect(useApp.getState().history).toHaveLength(1); // ONE entry for the whole op

    useApp.getState().undo();

    expect(useApp.getState().datasets[0].data).toEqual(raw);
  });

  it("undo restores the pre-reimport dataset even when corrections were re-applied", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    const corrected = { ...fresh, values: [[111], [211], [311]] };
    vi.mocked(applyCorrectionsApi).mockResolvedValue(corrected);
    useApp.setState({ datasets: [baseDataset({ raw, corrections: { yOff: 5 } })] });

    await useApp.getState().reimportDataset("d1");
    expect(useApp.getState().history).toHaveLength(1);

    useApp.getState().undo();

    const ds = useApp.getState().datasets[0];
    expect(ds.data).toEqual(raw);
    expect(ds.raw).toEqual(raw);
  });
});

// LIBRARY_WORKBOOK_UX_PLAN PR M (L0.55): preview the downstream impact
// BEFORE committing, via the SAME `downstreamOf` closure the recalc engine
// uses (lib/dependencyImpact.ts).
describe("reimportDataset — dependency impact preview (PR M)", () => {
  it("skips the confirm entirely when nothing depends on the dataset (today's frictionless case)", async () => {
    vi.mocked(importFile).mockResolvedValue(fresh);
    useApp.setState({ datasets: [baseDataset()] });

    await useApp.getState().reimportDataset("d1");

    expect(askConfirm).not.toHaveBeenCalled();
    expect(importFile).toHaveBeenCalled();
  });

  it("previews the impact and proceeds when confirmed", async () => {
    vi.mocked(askConfirm).mockResolvedValue(true);
    vi.mocked(importFile).mockResolvedValue(fresh);
    const derived: Dataset = {
      id: "d2",
      name: "derived-sheet",
      data: raw,
      derivedFrom: { datasetId: "d1", pipeline: "x" },
    };
    useApp.setState({ datasets: [baseDataset(), derived] });

    await useApp.getState().reimportDataset("d1");

    expect(askConfirm).toHaveBeenCalledWith(
      'Re-import "sample.dat"?',
      expect.stringContaining("derived-sheet"),
      "Re-import",
    );
    expect(importFile).toHaveBeenCalled();
    expect(useApp.getState().datasets.find((d) => d.id === "d1")?.data).toEqual(fresh);
  });

  it("does nothing (zero mutation, no API call) when the preview is declined", async () => {
    vi.mocked(askConfirm).mockResolvedValue(false);
    vi.mocked(importFile).mockResolvedValue(fresh);
    const derived: Dataset = {
      id: "d2",
      name: "derived-sheet",
      data: raw,
      derivedFrom: { datasetId: "d1", pipeline: "x" },
    };
    useApp.setState({ datasets: [baseDataset(), derived] });
    const before = useApp.getState().datasets;

    await useApp.getState().reimportDataset("d1");

    expect(importFile).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toBe(before);
    expect(useApp.getState().history).toHaveLength(0);
  });
});

// LIBRARY_WORKBOOK_UX_PLAN PR M booked finding (G5 canonical-state review):
// a shape-changing reimport that invalidates a bound figure's groupKey
// surfaces a clear message instead of a raw backend ValueError later.
describe("reimportDataset — groupKey reset on reshape (PR M booked finding)", () => {
  it("clears a bound figure's groupKey/facetKey on a column-count change and toasts why", async () => {
    vi.mocked(importFile).mockResolvedValue({ ...fresh, labels: ["m", "extra"], units: ["emu", ""], values: [[11, 0], [21, 0], [31, 0]] });
    const doc = createFigureDocument({
      id: "fig1",
      name: "Figure",
      datasetId: "d1",
      view: defaultPlotView(),
      groupKey: 0,
    });
    useApp.setState({ datasets: [baseDataset()], editableFigures: [doc] });

    await useApp.getState().reimportDataset("d1");

    const updated = useApp.getState().editableFigures[0];
    expect(updated.bindings.groupKey).toBeNull();
    expect(updated.bindings.facetKey).toBeNull();
    expect(vi.mocked(toast)).toHaveBeenCalledWith(
      expect.stringContaining("grouping column no longer exists"),
      "info",
    );
  });

  it("does not toast the groupKey message when no bound figure had one set", async () => {
    vi.mocked(importFile).mockResolvedValue({ ...fresh, labels: ["m", "extra"], units: ["emu", ""], values: [[11, 0], [21, 0], [31, 0]] });
    const doc = createFigureDocument({ id: "fig1", name: "Figure", datasetId: "d1", view: defaultPlotView() });
    useApp.setState({ datasets: [baseDataset()], editableFigures: [doc] });

    await useApp.getState().reimportDataset("d1");

    expect(vi.mocked(toast)).not.toHaveBeenCalledWith(expect.stringContaining("grouping column"), "info");
  });

  it("leaves groupKey untouched on a row-only reshape (columns unchanged)", async () => {
    vi.mocked(importFile).mockResolvedValue({ ...fresh, time: [1, 2], values: [[11], [21]] }); // fewer rows, same columns
    const doc = createFigureDocument({
      id: "fig1",
      name: "Figure",
      datasetId: "d1",
      view: defaultPlotView(),
      groupKey: 0,
    });
    useApp.setState({ datasets: [baseDataset()], editableFigures: [doc] });

    await useApp.getState().reimportDataset("d1");

    expect(useApp.getState().editableFigures[0].bindings.groupKey).toBe(0);
  });

  // P1.5 review round P1: the LIVE view's groupKey singleton is a SEPARATE
  // reset target from editableFigures above (it didn't exist as a PlotView
  // field until P1.5) -- it must clear through the SAME datasetViewDefaults
  // choke point commitReimport's `viewReset` already routes xKey/yKeys
  // through on a shape-changed reimport of the ACTIVE dataset.
  it("clears the LIVE groupKey singleton on a shape-changed reimport of the active dataset", async () => {
    vi.mocked(importFile).mockResolvedValue({ ...fresh, labels: ["m", "extra"], units: ["emu", ""], values: [[11, 0], [21, 0], [31, 0]] });
    useApp.setState({ datasets: [baseDataset()], activeId: "d1", groupKey: 0 });

    await useApp.getState().reimportDataset("d1");

    expect(useApp.getState().groupKey).toBeNull();
  });
});
