// Worksheet audit #6/#8: ⧉ Copy and the file exports dropped text columns,
// wrote a date X as epoch seconds and put text after every number. The
// worksheet-as-a-table plan now carries every column in the FILE's order.

import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { worksheetTableColumns, worksheetTableWire, worksheetTsvTable } from "./worksheetTable";

const T0 = Date.UTC(2026, 2, 1, 12, 0, 0) / 1000;

function mixed(extra: Partial<Dataset> = {}, meta: Record<string, unknown> = {}): Dataset {
  return {
    id: "d1",
    name: "mixed.csv",
    data: {
      time: [10, 15, 20],
      values: [[0.1, 1], [0.2, 2], [Number.NaN, 3]],
      labels: ["Signal", "Ref"],
      units: ["mV", "mV"],
      metadata: {
        x_column_name: "Temp",
        x_column_unit: "K",
        all_column_names: ["Temp (K)", "Signal (mV)", "Sample", "Ref (mV)", "Date"],
        text_columns: { Sample: ["S0", "S1", "S2"], Date: ["2026-03-01", "2026-03-02", "2026-03-03"] },
        ...meta,
      },
    },
    ...extra,
  } as Dataset;
}

describe("the worksheet as a table", () => {
  it("keeps text columns, in the file's own column order", () => {
    expect(worksheetTableColumns(mixed()).map((c) => c.name)).toEqual(["Temp", "Signal", "Sample", "Ref", "Date"]);
  });

  it("copies every column, text included, with a Name (unit) header", () => {
    const { headers, data } = worksheetTsvTable(mixed(), [0, 2]);
    expect(headers).toEqual(["Temp (K)", "Signal (mV)", "Sample", "Ref (mV)", "Date"]);
    expect(data).toEqual([
      ["10", "0.1", "S0", "1", "2026-03-01"],
      ["20", "", "S2", "3", "2026-03-03"],
    ]);
  });

  it("exports typed cells: numbers, null blanks, text, and a date X as a datetime column", () => {
    const ds = mixed({}, { time_is_datetime: true, x_column_name: "Logged", x_column_unit: "", all_column_names: undefined });
    ds.data.time = [T0, T0 + 60, T0 + 120];
    const wire = worksheetTableWire(ds, [0, 2]);
    expect(wire.map((c) => [c.name, c.kind])).toEqual([
      ["Logged", "datetime"], ["Signal", "number"], ["Ref", "number"], ["Date", "text"], ["Sample", "text"],
    ]);
    expect(wire[0].cells).toEqual([T0, T0 + 120]);
    expect(wire[1].cells).toEqual([0.1, null]);
    expect(wire[4].cells).toEqual(["S0", "S2"]); // (no recorded file order: text after numbers)
    expect(worksheetTsvTable(ds, [1]).data[0][0]).toBe("2026-03-01 12:01:00");
  });

  it("leaves out Disregard columns only when asked", () => {
    const ds = mixed({ columnDesignations: { 1: "disregard" } });
    expect(worksheetTableWire(ds, [0]).map((c) => c.name)).toContain("Ref");
    expect(worksheetTableWire(ds, [0], true).map((c) => c.name)).not.toContain("Ref");
  });
});
