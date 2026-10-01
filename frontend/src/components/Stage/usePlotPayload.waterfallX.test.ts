// Waterfall X offset on the live canvas: `usePlotPayload` hands the renderer
// the X-block layout (`lib/waterfallX.ts`, loaded lazily the first time a
// step is set) — the display payload AND its row-aligned companions (error
// bars here), so a bar stays on its own shifted point. Refused for a group
// split, exactly as the export wire refuses it (`waterfallWire`), and off at
// zero. `fetchPlot` is mocked at the network boundary (usePlotPayload.test.ts's
// pattern); waits are on returned STATE, never on a mock call.
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildColumns } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

vi.mock("../../lib/plotdata", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...real,
    fetchPlot: (data: Dataset["data"], _yl: boolean, _xl: boolean, ch: number[], y2: number[] | null, xKey: number | null) =>
      Promise.resolve(real.buildColumns(data, y2, xKey, ch)),
  };
});

const DATASET: Dataset = {
  id: "d1",
  name: "wf",
  data: {
    time: [0, 1, 2],
    values: [[1, 10, 0.5, 1], [2, 20, 0.5, 1], [3, 30, 0.5, 2]],
    labels: ["A", "B", "dA", "g"],
    units: ["", "", "", ""],
    metadata: {},
  },
};
const STYLES = {};
const LABELS = {};
const ERR = { 0: 2 };
const HIDDEN: number[] = [];
const Y_KEYS = [0, 1];

function params(o: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: DATASET, yScale: "linear", xScale: "linear", xKey: null, yKeys: Y_KEYS, groupKey: null,
    y2Keys: null, seriesOrder: null, seriesStyles: STYLES, seriesLabels: LABELS, errKeys: ERR,
    hiddenChannels: HIDDEN, waterfall: 0, excludedDisplay: "hide", fitOverlay: null, baselineOverlay: null,
    peakOverlay: null, derivOverlay: null, selection: null, xLim: null, ...o,
  };
}

describe("usePlotPayload — waterfall X offset", () => {
  it("draws each series in its own shifted x block, error bars included", async () => {
    const { result } = renderHook(() => usePlotPayload(params({ waterfallDx: 0.5 })));
    await waitFor(() => expect(result.current.displayPayload?.blockRows).toBe(3));
    const [x, a, b] = result.current.displayPayload!.data as unknown as (number | null)[][];
    expect(x).toEqual([0, 1, 2, 1, 2, 3]);
    expect(a).toEqual([1, 2, 3, null, null, null]);
    expect(b).toEqual([null, null, null, 10, 20, 30]);
    expect(result.current.errorBars.get(1)).toEqual([0.5, 0.5, 0.5, null, null, null]);
    expect(buildColumns(DATASET.data, null, null, Y_KEYS).data[0]).toEqual([0, 1, 2]); // the data is untouched
  });

  it("is off at zero, and refused for a group split (the export refuses it too)", async () => {
    const off = renderHook(() => usePlotPayload(params({ waterfallDx: 0 })));
    await waitFor(() => expect(off.result.current.displayPayload).not.toBeNull());
    expect(off.result.current.displayPayload!.blockRows).toBeUndefined();
    expect(off.result.current.displayPayload!.data[0]).toEqual([0, 1, 2]);

    const grouped = renderHook(() => usePlotPayload(params({ waterfallDx: 0.5, groupKey: 3 })));
    await waitFor(() => expect(grouped.result.current.displayPayload).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20)); // give a (wrong) lazy expansion the chance to land
    expect(grouped.result.current.displayPayload!.blockRows).toBeUndefined();
  });
});
