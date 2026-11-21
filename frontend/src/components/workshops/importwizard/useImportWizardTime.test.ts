// The wizard's per-column time format (lib/importTimeFormats.ts): choosing a
// format sends it, with the matching role, in the preview and parse requests.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { importGuess, importParse, importPreview, listImportFilters } from "../../../lib/api/importFilters";
import type { DataStruct, ImportPreviewResponse, ImportSettingsWire } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useImportWizard } from "./useImportWizard";

vi.mock("../../../lib/api/importFilters", () => ({
  importGuess: vi.fn(),
  importPreview: vi.fn(),
  importParse: vi.fn(),
  listImportFilters: vi.fn(),
  saveImportFilter: vi.fn(),
  deleteImportFilter: vi.fn(),
}));

const TEXT = "Time,Temp\n23:59:59,1\n00:00:01,2\n";

const SETTINGS: ImportSettingsWire = {
  delimiter: "auto",
  header_line: 0,
  units_line: null,
  label_line: null,
  data_start_line: 1,
  column_names: ["Time", "Temp"],
  roles: ["x", "y"],
  time_formats: ["clock", null],
};

const PREVIEW: ImportPreviewResponse = {
  raw_lines: TEXT.trim().split("\n"),
  n_lines: 3,
  delimiter: ",",
  header_line: 0,
  units_line: null,
  label_line: null,
  data_start_line: 1,
  columns: [
    { index: 0, name: "Time", unit: "s", role: "x", time_kind: "clock", time_format: "clock" },
    { index: 1, name: "Temp", unit: "", role: "y" },
  ],
  rows: [[86399, 1], [86401, 2]],
  n_data_rows: 2,
  n_preview_rows: 2,
  comments: [],
};

const DS: DataStruct = { time: [0, 2], values: [[1], [2]], labels: ["Temp"], units: [""], metadata: {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listImportFilters).mockResolvedValue([]);
  vi.mocked(importGuess).mockResolvedValue(SETTINGS);
  vi.mocked(importPreview).mockResolvedValue(PREVIEW);
  vi.mocked(importParse).mockResolvedValue(DS);
  useApp.setState({ datasets: [], activeId: null, status: "", recent: [] });
});

async function opened() {
  const hook = renderHook(() => useImportWizard());
  await act(async () => {
    await hook.result.current.pickFile(new File([TEXT], "log.csv"));
  });
  await waitFor(() => expect(hook.result.current.preview?.columns[0].time_format).toBe("clock"));
  return hook;
}

describe("useImportWizard time formats", () => {
  it("sends the chosen format in the parse request", async () => {
    const { result } = await opened();
    act(() => result.current.setTimeFormat(0, "elapsed"));
    expect(result.current.preview?.columns[0].time_format).toBe("elapsed"); // optimistic
    await act(async () => {
      await result.current.doImport();
    });
    expect(importParse).toHaveBeenCalledWith(
      TEXT,
      expect.objectContaining({ time_formats: ["elapsed", null], roles: ["x", "y"] }),
    );
  });

  it("turning the X column to text makes it a label, so it is not an all-NaN axis", async () => {
    const { result } = await opened();
    act(() => result.current.setTimeFormat(0, "text"));
    expect(result.current.settings?.time_formats).toEqual(["text", null]);
    expect(result.current.settings?.roles).toEqual(["label", "y"]);
  });

  it("keeps the formats the preview applied once a role edit records roles (after a delimiter change)", async () => {
    // A delimiter change sends roles + formats null; the server re-guesses both.
    vi.mocked(importGuess).mockResolvedValue({ ...SETTINGS, roles: null, time_formats: null });
    const { result } = await opened();
    act(() => result.current.setColumnRole(1, "error"));
    expect(result.current.settings?.roles).toEqual(["x", "error"]);
    expect(result.current.settings?.time_formats).toEqual(["clock", null]);
  });

  it("sends the unwrap choice", async () => {
    const { result } = await opened();
    vi.mocked(importPreview).mockClear();
    const repreviewed = { ...PREVIEW, n_lines: 99 };
    vi.mocked(importPreview).mockResolvedValue(repreviewed);
    act(() => result.current.patchSettings({ unwrap_midnight: false }));
    await waitFor(() => expect(result.current.preview?.n_lines).toBe(99));
    expect(importPreview).toHaveBeenCalledWith(TEXT, expect.objectContaining({ unwrap_midnight: false }), 30);
  });
});
