// "Export worksheet…" (worksheet audit #8): the sheet goes out with every
// column — text included — in the chosen format; several selected sheets
// become one Excel workbook (a tab each); masked rows and Disregard columns
// are left out only when asked.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { askParams } from "../components/overlays/ParamDialog";
import { exportWorksheetTable } from "../lib/api/worksheetExport";
import type { Dataset } from "../lib/types";
import { useApp } from "../store/useApp";
import { runExportWorksheet } from "./worksheetExport";

vi.mock("../components/overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../lib/api/worksheetExport", () => ({ exportWorksheetTable: vi.fn() }));

function sheet(id: string, extra: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name: `${id}.csv`,
    data: {
      time: [1, 2, 3],
      values: [[10], [20], [30]],
      labels: ["R"],
      units: ["Ohm"],
      metadata: { x_column_name: "T", x_column_unit: "K", text_columns: { Sample: ["a", "b", "c"] } },
    },
    ...extra,
  } as Dataset;
}

const answer = (format: string, more: Record<string, boolean> = {}) => ({
  format, header: true, skipMasked: false, skipDisregard: false, ...more,
});

beforeEach(() => {
  vi.mocked(exportWorksheetTable).mockReset().mockResolvedValue(undefined);
  vi.mocked(askParams).mockReset();
});

describe("runExportWorksheet", () => {
  it("exports the active sheet's every column, text included", async () => {
    useApp.setState({ datasets: [sheet("a")], activeId: "a", selectedIds: [] });
    vi.mocked(askParams).mockResolvedValue(answer("CSV (comma-separated)"));
    await runExportWorksheet(useApp.getState);
    const body = vi.mocked(exportWorksheetTable).mock.calls[0][0];
    expect(body.fmt).toBe("csv");
    expect(body.filename).toBe("a");
    expect(body.sheets[0].columns.map((c) => [c.name, c.unit, c.cells])).toEqual([
      ["T", "K", [1, 2, 3]],
      ["R", "Ohm", [10, 20, 30]],
      ["Sample", "", ["a", "b", "c"]],
    ]);
  });

  it("puts several selected sheets into ONE Excel workbook, leaving masked rows out when asked", async () => {
    useApp.setState({ datasets: [sheet("a", { excludedRows: [1] }), sheet("b")], activeId: "a", selectedIds: ["a", "b"] });
    vi.mocked(askParams).mockResolvedValue(answer("Excel workbook (.xlsx)", { skipMasked: true }));
    await runExportWorksheet(useApp.getState);
    expect(exportWorksheetTable).toHaveBeenCalledTimes(1);
    const body = vi.mocked(exportWorksheetTable).mock.calls[0][0];
    expect(body.fmt).toBe("xlsx");
    expect(body.sheets.map((s) => s.name)).toEqual(["a", "b"]);
    expect(body.sheets[0].columns[0].cells).toEqual([1, 3]);
    expect(body.sheets[1].columns[0].cells).toEqual([1, 2, 3]);
  });

  it("exports only the worksheet's selected rows when it passes them", async () => {
    useApp.setState({ datasets: [sheet("a")], activeId: "a", selectedIds: [] });
    vi.mocked(askParams).mockResolvedValue(answer("TSV (tab-separated)"));
    await runExportWorksheet(useApp.getState, { ids: ["a"], rows: [2, 0] });
    const body = vi.mocked(exportWorksheetTable).mock.calls[0][0];
    expect(body.fmt).toBe("tsv");
    expect(body.sheets[0].columns[2].cells).toEqual(["c", "a"]);
  });

  it("does nothing on Cancel", async () => {
    useApp.setState({ datasets: [sheet("a")], activeId: "a", selectedIds: [] });
    vi.mocked(askParams).mockResolvedValue(null);
    await runExportWorksheet(useApp.getState);
    expect(exportWorksheetTable).not.toHaveBeenCalled();
  });
});
