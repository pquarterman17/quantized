// Tests for MAIN_PLAN #10 (re-import a dataset from its source file). Six
// branches per the plan: shape-preserved keeps exclusions/roles; row-count
// change clears + toasts; corrections re-applied through the chokepoint;
// no-source fallback (file picker); failure leaves state untouched; undo
// restores the pre-reimport dataset in one step.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections as applyCorrectionsApi, importFile, uploadFile } from "../lib/api";
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
    history: [],
    future: [],
    status: "",
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
