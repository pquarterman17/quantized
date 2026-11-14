// Origin-gap audit 2 #2 through the ACTUAL plot pipeline: a T1,R1,T2,R2
// sheet with T2 set as the plot X draws R1 against T1 and R2 against T2 --
// never R1 against T2 (the bug: the whole plot re-pointed to the new X).
// `fetchPlot` delegates to the real offline `buildColumns`, like
// usePlotPayload.errorRoles.test.ts. Non-monotonic X on purpose.

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

const sheet: Dataset = {
  id: "s",
  name: "T1R1T2R2",
  data: {
    time: [300, 100, 200], // T1
    values: [
      [3, 30, 33],
      [1, 10, 11],
      [2, 20, 22],
    ],
    labels: ["R1", "T2", "R2"],
    units: ["ohm", "K", "ohm"],
    metadata: { x_column_name: "T1", x_column_unit: "K" },
  },
  columnDesignations: { 1: "X" },
};

const HIDDEN = [1];
function params(overrides: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: sheet, yScale: "linear", xScale: "linear", xKey: 1, yKeys: null, groupKey: null, y2Keys: null,
    seriesOrder: null, seriesStyles: {}, seriesLabels: {}, errKeys: {}, hiddenChannels: HIDDEN, waterfall: 0,
    excludedDisplay: "hide", fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null,
    selection: null, xLim: null, ...overrides,
  };
}

/** The finite (x, y) points drawn for display series `i`. */
function drawn(p: { data: ArrayLike<unknown>[] }, i: number): [number, number][] {
  const xs = p.data[0] as ArrayLike<number | null>;
  const ys = p.data[i + 1] as ArrayLike<number | null>;
  const out: [number, number][] = [];
  for (let r = 0; r < xs.length; r++) {
    const y = ys[r];
    if (y != null && Number.isFinite(y)) out.push([xs[r] as number, y]);
  }
  return out;
}

describe("usePlotPayload — each Y on its own X (gap audit 2 #2)", () => {
  it("T2 as the plot X: R1 still draws against T1, R2 against T2, in row order", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: params() });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    const p = result.current.displayPayload!;
    expect(result.current.plotted).toEqual([0, 2]);
    expect(drawn(p, 0)).toEqual([[300, 3], [100, 1], [200, 2]]);
    expect(drawn(p, 1)).toEqual([[30, 33], [10, 11], [20, 22]]);
    expect(p.xLabel).toBe("T1 / T2");
    // The brush maps a view row back to its source row.
    expect(p.seriesXRows).toBe(3);
  });

  it("with R2 hidden the plot is R1 against T1 alone (no view)", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params({ hiddenChannels: [1, 2] }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    expect(drawn(result.current.displayPayload!, 0)).toEqual([[300, 3], [100, 1], [200, 2]]);
  });
});
