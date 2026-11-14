// Worksheet audit #7: a CSV whose first column holds dates imported with X in
// epoch seconds (`metadata.time_is_datetime`), and both the plot ticks and the
// worksheet cells showed raw numbers ("1,772,368,000"). With the X format on
// `auto`, a timestamp X now reads as calendar dates on the canvas, in the
// grid, and in the cell editor; an explicit format still wins. The export
// applies the same rule server-side (tests/test_export_date_x_axis.py).

import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { dateAwareXFmt } from "./axisFormat";
import { buildColumns, type PlotPayload } from "./plotdata";
import type { DataStruct } from "./types";
import { buildOpts } from "./uplotOpts";
import { fmtDateCell, gridFormatters } from "../components/Stage/worksheet/cellFormat";
import { parseDateCell } from "../components/Stage/worksheet/useCellEdit";

const T0 = Date.UTC(2026, 2, 1, 12, 0, 0) / 1000; // 2026-03-01 12:00:00 UTC

function ds(timeIsDatetime: boolean): DataStruct {
  return {
    time: [T0, T0 + 3600, T0 + 7200],
    values: [[20.1], [21.5], [22.0]],
    labels: ["Temp"],
    units: ["C"],
    metadata: timeIsDatetime ? { time_is_datetime: true, x_column_name: "Date" } : { x_column_name: "Date" },
  } as DataStruct;
}

describe("a timestamp X column", () => {
  it("marks its plot payload, and only for the dataset's own axis", () => {
    expect(buildColumns(ds(true)).xIsDate).toBe(true);
    expect(buildColumns(ds(false)).xIsDate).toBeUndefined();
    expect(buildColumns(ds(true), null, 0, []).xIsDate).toBeUndefined(); // a channel as X
  });

  it("draws date ticks on an auto X format (uPlot time scale + a calendar label)", () => {
    const payload: PlotPayload = buildColumns(ds(true));
    const opts = buildOpts(payload, {
      width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
      xFmt: { mode: "auto", digits: 2 },
    });
    expect(opts.scales?.x?.time).toBe(true);
    const values = opts.axes?.[0]?.values as (u: uPlot, s: number[], a: number, f: number, i: number) => (string | null)[];
    const [label] = values({} as uPlot, [T0], 0, 0, 3600);
    expect(label).toMatch(/2026/);
    expect(label).not.toMatch(/1,?772/);
  });

  it("keeps an explicit format, and leaves a numeric X alone", () => {
    expect(dateAwareXFmt({ mode: "fixed", digits: 1 }, true)).toEqual({ mode: "fixed", digits: 1 });
    expect(dateAwareXFmt({ mode: "auto", digits: 2 }, false)).toEqual({ mode: "auto", digits: 2 });
    expect(dateAwareXFmt({ mode: "auto", digits: 2 }, true)).toEqual({ mode: "datetime", digits: 2 });
    expect(dateAwareXFmt(undefined, true)).toEqual({ mode: "datetime", digits: 2 });
  });

  it("shows and edits as a date in the worksheet", () => {
    expect(gridFormatters(ds(true).time, ds(true).values, true)(-1)(T0)).toBe("2026-03-01 12:00:00");
    expect(gridFormatters(ds(true).time, ds(true).values)(-1)(T0)).not.toMatch(/2026/);
    expect(fmtDateCell(T0 + 0.5)).toBe("2026-03-01 12:00:00.500");
    expect(fmtDateCell(Number.NaN)).toBe("—");
    expect(parseDateCell("2026-03-01 12:00:00")).toBe(T0);
    expect(parseDateCell("2026-03-01T13:00Z")).toBe(T0 + 3600);
    expect(parseDateCell(String(T0))).toBe(T0);
    expect(parseDateCell("not a date")).toBeNaN();
    expect(parseDateCell("")).toBeNaN();
  });
});
