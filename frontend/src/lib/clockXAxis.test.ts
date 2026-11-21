// A time-of-day X (the Import Wizard's "Time of day" format:
// `metadata.time_is_clock`, seconds since midnight): its plot payload is
// marked, an auto X format draws a clock axis (HH:MM, never a 1970 date),
// the plot asks for the chunk that draws it, and the tick controls never
// offer a calendar mode for it.

import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { plotDecorNeeds } from "../components/Stage/useLazyPlotParts";
import { dateAwareXFmt } from "./axisFormat";
import { loadAxisExtras } from "./axisExtrasHook";
import { buildColumns, type PlotPayload } from "./plotdata";
import { xAxisIsDate } from "./tickFormat";
import type { DataStruct } from "./types";
import { buildOpts } from "./uplotOpts";

function ds(clock: boolean): DataStruct {
  return {
    time: [82_800, 86_400, 90_000],
    values: [[1], [2], [3]],
    labels: ["Temp"],
    units: ["K"],
    metadata: clock ? { time_is_clock: true, x_column_name: "Time" } : { x_column_name: "Time" },
  } as DataStruct;
}

const ARGS = { width: 800, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn() } as const;

describe("a time-of-day X column", () => {
  it("marks its plot payload, only for the dataset's own axis", () => {
    expect(buildColumns(ds(true)).xIsDate).toBe("clock");
    expect(buildColumns(ds(false)).xIsDate).toBeUndefined();
    expect(buildColumns(ds(true), null, 0, []).xIsDate).toBeUndefined();
  });

  it("an auto X format becomes clock; an explicit one is kept", () => {
    expect(dateAwareXFmt({ mode: "auto", digits: 2 }, "clock")).toEqual({ mode: "clock", digits: 2 });
    expect(dateAwareXFmt(undefined, "clock")).toEqual({ mode: "clock", digits: 2 });
    expect(dateAwareXFmt({ mode: "fixed", digits: 1 }, "clock")).toEqual({ mode: "fixed", digits: 1 });
    expect(dateAwareXFmt({ mode: "auto", digits: 2 }, true)).toEqual({ mode: "datetime", digits: 2 });
  });

  it("draws HH:MM ticks once the axis chunk is in, on a numeric (not time) scale", async () => {
    await loadAxisExtras();
    const payload: PlotPayload = buildColumns(ds(true));
    const opts = buildOpts(payload, { ...ARGS, xFmt: { mode: "auto", digits: 2 } });
    expect(opts.scales?.x?.time).toBe(false);
    const axis = opts.axes?.[0];
    const splits = (axis?.splits as (u: uPlot, i: number, a: number, b: number, incr: number, space: number) => number[])(
      {} as uPlot, 0, 82_800, 90_000, 3600, 100,
    );
    const labels = (axis?.values as (u: uPlot, s: number[]) => string[])({} as uPlot, splits);
    expect(labels).toEqual(["23:00", "00:00", "01:00"]);
    expect(labels.join(" ")).not.toMatch(/1970|Jan/);
  });

  it("asks for the axis chunk that draws the clock", () => {
    expect(plotDecorNeeds([], buildColumns(ds(true)), null, 0).clock).toBe(true);
    expect(plotDecorNeeds([], buildColumns(ds(false)), null, 0).clock).toBeUndefined();
  });

  it("never offers the calendar tick modes (seconds since midnight would read as 1970)", () => {
    expect(xAxisIsDate({ time_is_clock: true }, "auto")).toBe(false);
  });
});
