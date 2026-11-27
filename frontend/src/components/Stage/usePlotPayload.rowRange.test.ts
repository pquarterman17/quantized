// R2 through the real usePlotPayload pipeline: a window of rows 21-44 of 200
// draws 24 points; a fit overlay, an error bar and a waterfall stay aligned; a
// range that does not fit the sheet is not applied.
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Dataset, FitOverlay } from "../../lib/types";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

vi.mock("../../lib/plotdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...actual,
    fetchPlot: async (
      ds: Parameters<typeof actual.buildColumns>[0], _yLog: boolean, _xLog: boolean,
      yKeys: number[] | null, y2Keys: number[] | null, xKey: number | null,
    ) => actual.buildColumns(ds, y2Keys, xKey, yKeys),
  };
});

const N = 200;
const ds: Dataset = {
  id: "d", name: "d",
  data: {
    time: Array.from({ length: N }, (_v, i) => i),
    values: Array.from({ length: N }, (_v, i) => [100 + i, 1 + (i % 3)]),
    labels: ["M", "err"], units: ["", ""], metadata: {},
  },
};
const params = (over: Partial<PlotPayloadParams> = {}): PlotPayloadParams => ({
  active: ds, yScale: "linear", xScale: "linear", xKey: null, yKeys: [0], groupKey: null, y2Keys: null, seriesOrder: null,
  seriesStyles: {}, seriesLabels: {}, errKeys: { 0: 1 }, hiddenChannels: [], waterfall: 0, excludedDisplay: "hide",
  fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null, xLim: null, ...over,
});
async function run(p: PlotPayloadParams) {
  const { result } = renderHook(() => usePlotPayload(p));
  await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
  return result.current;
}
const drawn = (x: unknown) => (x as (number | null)[]).flatMap((v, r) => (v == null ? [] : [r]));

describe("usePlotPayload with a plot row range", () => {
  it("rows 21-44 of 200 draw 24 points, every row keeps its index", async () => {
    const r = await run(params({ rowRange: { from: 20, to: 43 } }));
    const d = r.displayPayload!;
    expect(d.data[0]).toHaveLength(N);
    expect(drawn(d.data[0])).toEqual(Array.from({ length: 24 }, (_v, i) => 20 + i));
    expect(drawn(d.data[1])).toEqual(drawn(d.data[0]));
    expect((d.data[1] as number[])[30]).toBe(130);
  });

  it("a fit overlay, the error bars and a waterfall stay aligned with the same rows", async () => {
    const fit: FitOverlay = { datasetId: "d", binding: { yKey: 0, xKey: null }, y: Array.from({ length: N }, (_v, i) => 100 + i + 0.5) };
    const whole = await run(params({ fitOverlay: fit, waterfall: 0.5 }));
    const win = await run(params({ fitOverlay: fit, waterfall: 0.5, rowRange: { from: 20, to: 43 } }));
    const fitCol = win.displayPayload!.series.findIndex((s) => s.label === "fit") + 1;
    expect(fitCol).toBeGreaterThan(1);
    expect(drawn(win.displayPayload!.data[fitCol])).toEqual(drawn(win.displayPayload!.data[0]));
    for (const r of [20, 31, 43]) {
      expect((win.displayPayload!.data[1] as number[])[r]).toBe((whole.displayPayload!.data[1] as number[])[r]); // waterfall offset unchanged
      expect((win.displayPayload!.data[fitCol] as number[])[r]).toBe((whole.displayPayload!.data[fitCol] as number[])[r]);
    }
    // The error bar arrays are row-indexed on the full sheet: untouched, so still aligned.
    expect([...win.errorBars.values()][0]).toHaveLength(N);
    expect([...win.errorBars.values()][0]).toEqual([...whole.errorBars.values()][0]);
  });

  it("a range past the sheet's end is not applied: every row draws", async () => {
    const r = await run(params({ rowRange: { from: 20, to: 999 } }));
    expect(drawn(r.displayPayload!.data[0])).toHaveLength(N);
  });
});
