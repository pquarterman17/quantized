// Plot audit round 2: a multi-sheet Excel workbook imports every data sheet
// (payload `sheets`, src/quantized/io/excel_sheets.py) as its own dataset in
// ONE workbook node, and re-import finds each dataset's own sheet again.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { importFile, uploadFile } from "../lib/api";
import { resolveFreshData } from "../lib/reimport";
import type { DataStruct, Dataset } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  importFile: vi.fn(),
  uploadFile: vi.fn(),
}));

const sheet = (name: string, y: number): DataStruct => ({
  time: [1, 2],
  values: [[y], [y + 1]],
  labels: [`y${name}`],
  units: [""],
  metadata: { sheet_name: name },
});

const workbook = (): DataStruct => ({ ...sheet("First", 10), sheets: [sheet("Second", 20)] });

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [],
    folders: [],
    workbooks: [],
    activeId: null,
    selectedIds: [],
    expandedFolders: [],
    expandedWorkbookIds: [],
    history: [],
    future: [],
  });
});

describe("a multi-sheet workbook import", () => {
  it("an upload lands one dataset per sheet, all in one workbook named after the file", async () => {
    vi.mocked(uploadFile).mockResolvedValue(workbook());
    await useApp.getState().importFiles([new File(["x"], "multi.xlsx")]);
    const st = useApp.getState();
    expect(st.datasets.map((d) => d.name)).toEqual(["multi.xlsx:First", "multi.xlsx:Second"]);
    expect(st.datasets.map((d) => d.data.values[0][0])).toEqual([10, 20]);
    expect(st.workbooks).toHaveLength(1);
    expect(st.workbooks[0].name).toBe("multi.xlsx");
    expect(st.datasets.every((d) => d.workbookId === st.workbooks[0].id)).toBe(true);
    expect(st.datasets.some((d) => "sheets" in d.data)).toBe(false);
  });

  it("a path import's workbook keeps the stem name and source", async () => {
    vi.mocked(importFile).mockResolvedValue(workbook());
    await useApp.getState().importPaths(["/data/multi.xlsx"]);
    const st = useApp.getState();
    expect(st.workbooks).toHaveLength(1);
    expect(st.workbooks[0].name).toBe("multi");
    expect(st.datasets).toHaveLength(2);
    expect(st.datasets.every((d) => d.workbookId === st.workbooks[0].id)).toBe(true);
  });

  it("a one-sheet workbook keeps the plain file name", async () => {
    vi.mocked(uploadFile).mockResolvedValue(sheet("Only", 1));
    await useApp.getState().importFiles([new File(["x"], "one.xlsx")]);
    expect(useApp.getState().datasets.map((d) => d.name)).toEqual(["one.xlsx"]);
  });
});

describe("re-importing a sheet dataset", () => {
  const ds = (name: string): Dataset => ({ id: "d1", name: `multi.xlsx:${name}`, data: sheet(name, 0) });

  it("installs the dataset's OWN sheet, not sheet 0", async () => {
    const fresh = await resolveFreshData(ds("Second"), workbook());
    expect(fresh.values[0][0]).toBe(20);
    const primary = await resolveFreshData(ds("First"), workbook());
    expect(primary.values[0][0]).toBe(10);
    expect("sheets" in primary).toBe(false);
  });

  it("refuses when the sheet is gone instead of installing another sheet's data", async () => {
    await expect(resolveFreshData(ds("Gone"), workbook())).rejects.toThrow(/sheet "Gone"/);
  });

  it("a file that is no longer multi-sheet re-imports its top level, as before", async () => {
    const fresh = await resolveFreshData(ds("Second"), sheet("Renamed", 5));
    expect(fresh.values[0][0]).toBe(5);
  });
});
