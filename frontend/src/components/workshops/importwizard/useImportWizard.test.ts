import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteImportFilter,
  importGuess,
  importParse,
  importPreview,
  listImportFilters,
  saveImportFilter,
} from "../../../lib/api";
import type {
  DataStruct,
  ImportFilterWire,
  ImportPreviewResponse,
  ImportSettingsWire,
} from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useImportWizard } from "./useImportWizard";

vi.mock("../../../lib/api", () => ({
  importGuess: vi.fn(),
  importPreview: vi.fn(),
  importParse: vi.fn(),
  listImportFilters: vi.fn(),
  saveImportFilter: vi.fn(),
  deleteImportFilter: vi.fn(),
}));

const SETTINGS: ImportSettingsWire = {
  delimiter: "auto",
  header_line: 1,
  units_line: 2,
  data_start_line: 3,
  column_names: ["Temp", "Moment"],
  roles: ["x", "y"],
};

const PREVIEW: ImportPreviewResponse = {
  raw_lines: ["# header comment", "Temp,Moment", "(K),(emu)", "300,0.0012"],
  n_lines: 4,
  delimiter: ",",
  header_line: 1,
  units_line: 2,
  data_start_line: 3,
  columns: [
    { index: 0, name: "Temp", unit: "K", role: "x" },
    { index: 1, name: "Moment", unit: "emu", role: "y" },
  ],
  rows: [[300, 0.0012]],
  n_data_rows: 1,
  n_preview_rows: 1,
};

const DS: DataStruct = {
  time: [300],
  values: [[0.0012]],
  labels: ["Moment"],
  units: ["emu"],
  metadata: {},
};

const fakeFile = (name: string, text = "# header comment\nTemp,Moment\n(K),(emu)\n300,0.0012\n") =>
  new File([text], name);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listImportFilters).mockResolvedValue([]);
  vi.mocked(importGuess).mockResolvedValue(SETTINGS);
  vi.mocked(importPreview).mockResolvedValue(PREVIEW);
  useApp.setState({ datasets: [], activeId: null, status: "", recent: [] });
});

describe("useImportWizard", () => {
  it("loads saved filters on mount", async () => {
    const filt: ImportFilterWire = { name: "Messy", glob: "*.dat", settings: SETTINGS, updated: "t" };
    vi.mocked(listImportFilters).mockResolvedValue([filt]);
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([filt]));
  });

  it("reads the picked file, guesses starting settings, and previews", async () => {
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    expect(importGuess).toHaveBeenCalledWith(expect.stringContaining("Temp,Moment"));
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));
    expect(importPreview).toHaveBeenCalledWith(expect.any(String), SETTINGS, 30);
    expect(result.current.file?.name).toBe("run1.dat");
  });

  it("re-previews (debounced) when a setting is patched", async () => {
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));
    vi.mocked(importPreview).mockClear();

    act(() => result.current.patchSettings({ data_start_line: 5 }));
    await waitFor(() =>
      expect(importPreview).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ data_start_line: 5 }),
        30,
      ),
    );
  });

  it("edits a column's role/name/unit through the aligned-array helpers", async () => {
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));

    act(() => result.current.setColumnRole(1, "error"));
    expect(result.current.settings?.roles).toEqual(["x", "error"]);

    act(() => result.current.setColumnName(0, "Temperature"));
    expect(result.current.settings?.column_names).toEqual(["Temperature (K)", "Moment (emu)"]);

    act(() => result.current.setColumnUnit(1, "mA·m²"));
    expect(result.current.settings?.column_names).toEqual([
      "Temperature (K)",
      "Moment (mA·m²)",
    ]);
  });

  it("imports the confirmed settings into a new library dataset named after the file", async () => {
    vi.mocked(importParse).mockResolvedValue(DS);
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));

    await act(async () => {
      await result.current.doImport();
    });

    expect(importParse).toHaveBeenCalledWith(expect.any(String), SETTINGS);
    const ds = useApp.getState().datasets;
    expect(ds).toHaveLength(1);
    expect(ds[0].name).toBe("run1.dat");
    expect(ds[0].data).toEqual(DS);
    expect(result.current.imported).toBe(true);
  });

  it("surfaces a parse error (422) without adding a dataset", async () => {
    vi.mocked(importParse).mockRejectedValue(new Error("no y/error columns selected to import"));
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));

    await act(async () => {
      await result.current.doImport();
    });

    expect(result.current.error).toContain("no y/error columns");
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("saves the confirmed settings as a named filter", async () => {
    const saved: ImportFilterWire = { name: "Messy XYZ", glob: "*.dat", settings: SETTINGS, updated: "t" };
    vi.mocked(saveImportFilter).mockResolvedValue(saved);
    const { result } = renderHook(() => useImportWizard());
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.preview).toEqual(PREVIEW));

    await act(async () => {
      await result.current.saveAsFilter("Messy XYZ", "*.dat");
    });

    expect(saveImportFilter).toHaveBeenCalledWith("Messy XYZ", "*.dat", SETTINGS);
    expect(result.current.filters).toContainEqual(saved);
  });

  it("applies a saved filter's settings (and re-previews under them)", async () => {
    const filt: ImportFilterWire = { name: "Messy", glob: "*.dat", settings: SETTINGS, updated: "t" };
    vi.mocked(listImportFilters).mockResolvedValue([filt]);
    vi.mocked(importGuess).mockResolvedValue({ ...SETTINGS, delimiter: "auto", roles: ["y", "y"] });
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([filt]));
    await act(async () => {
      await result.current.pickFile(fakeFile("run1.dat"));
    });
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    act(() => result.current.applyFilter("Messy"));
    expect(result.current.settings).toEqual(SETTINGS);
  });

  it("removes a saved filter", async () => {
    const filt: ImportFilterWire = { name: "Messy", glob: "*.dat", settings: SETTINGS, updated: "t" };
    vi.mocked(listImportFilters).mockResolvedValue([filt]);
    const { result } = renderHook(() => useImportWizard());
    await waitFor(() => expect(result.current.filters).toEqual([filt]));

    await act(async () => {
      await result.current.removeFilter("Messy");
    });

    expect(deleteImportFilter).toHaveBeenCalledWith("Messy");
    expect(result.current.filters).toEqual([]);
  });
});
