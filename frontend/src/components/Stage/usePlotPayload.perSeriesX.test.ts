// Origin gap audit 2, #2: a sheet laid out T1,R1,T2,R2 with T2 "Set As X"
// must draw R1 against T1 and R2 against T2 -- never R1 against T2, never a
// sorted X union. T2 is NON-MONOTONIC (a hysteresis-style down/up sweep), so
// the rows must keep their acquisition order. `fetchPlot` delegates to the
// real offline `buildColumns`, so this exercises the live Stage pipeline.

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../lib/types";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

vi.mock("../../lib/plotdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...actual,
    fetchPlot: async (
      ds: Parameters<typeof actual.buildColumns>[0],
      _yLog: boolean,
      _xLog: boolean,
      yKeys: number[] | null,
      y2Keys: number[] | null,
      xKey: number | null,
    ) => actual.buildColumns(ds, y2Keys, xKey, yKeys),
  };
});

// time = T1; channels R1, T2 (Set As X), R2. T2 sweeps 5 -> 3 -> 9.
const sheet: Dataset = {
  id: "mx",
  name: "multix.csv",
  data: {
    time: [1, 2, 3],
    values: [
      [10, 5, 100],
      [20, 3, 200],
      [30, 9, 300],
    ],
    labels: ["R1", "T2", "R2"],
    units: ["ohm", "K", "ohm"],
    metadata: { x_column_name: "T1", x_column_unit: "K" },
  },
  columnDesignations: { 1: "X" },
  excludedRows: [1],
};

const HIDDEN = [1]; // T2 is an X column, never a curve
const NONE = {};

function params(over: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: sheet, yScale: "linear", xScale: "linear", xKey: null, yKeys: null, groupKey: null,
    y2Keys: null, seriesOrder: null, seriesStyles: NONE, seriesLabels: NONE, errKeys: NONE,
    hiddenChannels: HIDDEN, waterfall: 0, excludedDisplay: "hide", fitOverlay: null, baselineOverlay: null,
    peakOverlay: null, derivOverlay: null, selection: null, xLim: null, ...over,
  };
}

describe("per-series X on the live plot", () => {
  it("draws R1 against T1 and R2 against T2, in row order, with the mask in every block", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: params() });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    const p = result.current.displayPayload!;
    const label = (s: string) => p.series.findIndex((x) => x.label === s) + 1;
    // Block 1 = T1 rows, block 2 = T2 rows in acquisition order (5, 3, 9).
    expect(p.data[0]).toEqual([1, 2, 3, 5, 3, 9]);
    // Row 1 is excluded: masked in BOTH blocks.
    expect(p.data[label("R1")]).toEqual([10, null, 30, null, null, null]);
    expect(p.data[label("R2")]).toEqual([null, null, null, 100, null, 300]);
    expect(p.blockRows).toBe(3);
    expect(p.xLabel).toBe("T1 / T2");
    expect(result.current.hidden).toEqual(p.series.map((s) => s.label === "T2"));
  });

  it("keeps R1 on T1 even when the plot's X was pointed at T2", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: params({ xKey: 1 }) });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    const p = result.current.displayPayload!;
    const r1 = p.series.findIndex((x) => x.label === "R1") + 1;
    const r2 = p.series.findIndex((x) => x.label === "R2") + 1;
    const pairs = (c: number) =>
      (p.data[0] as (number | null)[]).flatMap((x, i) => (p.data[c][i] == null ? [] : [[x, p.data[c][i]]]));
    expect(pairs(r1)).toEqual([[1, 10], [3, 30]]);
    expect(pairs(r2)).toEqual([[5, 100], [9, 300]]);
  });

  it("R2 hidden: the X is T1 alone -- no T2 block, no widened title", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({ hiddenChannels: [1, 2] }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    const p = result.current.displayPayload!;
    expect(p.data[0]).toEqual([1, 2, 3]);
    expect(p.xLabel).toBe("T1");
    expect(p.blockRows).toBeUndefined();
  });

  it("a selection is echoed in every block", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({ selection: { datasetId: "mx", rows: [2] } }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    const p = result.current.displayPayload!;
    const sel = p.series.findIndex((x) => x.label === "R2 (selected)") + 1;
    expect(p.data[sel]).toEqual([null, null, null, null, null, 300]);
  });

  // Overlays are built at the source's 3 rows for ONE Y; the plot has 2 blocks x 3 rows.
  // Until overlays carry an explicit (yKey, xKey) binding they are dropped, never misdrawn.
  it("a fit overlay is NOT drawn on a multi-X view (no series at wrong coordinates)", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({
        seriesOrder: [2, 0],
        fitOverlay: { datasetId: "mx", y: [1, 2, 3], band: [{ label: "lo", y: [0, 1, 2] }] },
      }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    const p = result.current.displayPayload!;
    expect(p.data[0]).toHaveLength(6);
    const labels = p.series.map((x) => x.label);
    expect(labels).toEqual(expect.arrayContaining(["R1", "R2"]));
    expect(labels).not.toContain("fit");
    expect(labels).not.toContain("lo");
  });
});
