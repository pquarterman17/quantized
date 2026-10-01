// Waterfall X offset × the zoom re-fetch (P3.4 windowed refetch). A committed
// zoom is in SHIFTED (display) x, but `/api/plot/series` windows RAW x
// (routes/plot.py, before decimation; the backend knows nothing of the
// stagger). Slot k draws raw x at x + k·step, so it needs raw
// [lo − k·step, hi − k·step] — fetching [lo, hi] lost every shifted series'
// rows near the window edges. The step itself must also stay the full-range
// one: measured over the windowed x it shrank on every zoom. `fetchPlot` is
// mocked at the network boundary and windows/decimates like the route
// (decimation itself is irrelevant here, so it keeps every row); waits are on
// returned STATE, never on a mock call.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import type { Dataset } from "../../lib/types";
import { waterfallXSpanOf } from "../../lib/waterfallOffset";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

const fetchPlotMock = vi.fn();
vi.mock("../../lib/plotdata", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...real,
    fetchPlot: (...args: unknown[]) => fetchPlotMock(real, ...args),
  };
});

type Real = typeof import("../../lib/plotdata");
type Col = (number | null)[];

/** The route's contract: window RAW x to [xMin, xMax] (inclusive), report
 *  `decimated` for this big dataset, echo the window. */
function routeLike(real: Real, data: Dataset["data"], _yl: boolean, _xl: boolean, ch: number[], y2: number[] | null,
  xKey: number | null, _w: number | null, xMin?: number | null, xMax?: number | null): Promise<PlotPayload> {
  const full = real.buildColumns(data, y2, xKey, ch);
  const cols = full.data as unknown as Col[];
  const keep = cols[0].map((x, r) => (xMin == null || xMax == null || (x! >= xMin && x! <= xMax) ? r : -1)).filter((r) => r >= 0);
  const data2 = cols.map((c) => keep.map((r) => c[r])) as unknown as PlotPayload["data"];
  const window = xMin != null && xMax != null ? ([xMin, xMax] as [number, number]) : null;
  return Promise.resolve({ ...full, data: data2, decimated: true, window });
}

const N = 20_000; // above DECIMATE_MIN_POINTS: the base comes back "decimated"
const DATASET: Dataset = {
  id: "d1",
  name: "wfz",
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => [Math.sin(i / 50), Math.cos(i / 50), i % 7]),
    labels: ["A", "B", "C"],
    units: ["", "", ""],
    metadata: {},
  },
};
const STYLES = {};
const LABELS = {};
const ERR = {};
const HIDDEN: number[] = [];
const Y_KEYS = [0, 1, 2];
const LIM: [number, number] = [5000, 6000];

function params(o: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: DATASET, yScale: "linear", xScale: "linear", xKey: null, yKeys: Y_KEYS, groupKey: null,
    y2Keys: null, seriesOrder: null, seriesStyles: STYLES, seriesLabels: LABELS, errKeys: ERR,
    hiddenChannels: HIDDEN, waterfall: 0, excludedDisplay: "hide", fitOverlay: null, baselineOverlay: null,
    peakOverlay: null, derivOverlay: null, selection: null, xLim: null, ...o,
  };
}

/** Series k's drawn points inside the display window, as sorted "x:y" keys. */
function visible(p: PlotPayload, k: number, [lo, hi]: [number, number]): string[] {
  const [x, ...ys] = p.data as unknown as Col[];
  const out: string[] = [];
  x.forEach((v, r) => {
    const y = ys[k][r];
    if (v != null && y != null && v >= lo && v <= hi) out.push(`${v.toFixed(6)}:${y}`);
  });
  return out.sort();
}

beforeEach(() => {
  fetchPlotMock.mockReset();
  fetchPlotMock.mockImplementation(routeLike);
});

async function zoomed(dx: number) {
  const hook = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: params({ waterfallDx: dx }) });
  await waitFor(() => expect(hook.result.current.payload?.decimated).toBe(true));
  if (dx) await waitFor(() => expect(hook.result.current.displayPayload?.blockRows).toBe(N));
  const full = hook.result.current.displayPayload!;
  hook.rerender(params({ waterfallDx: dx, xLim: LIM }));
  await waitFor(() => expect(hook.result.current.payload?.window).not.toBeFalsy());
  if (dx) await waitFor(() => expect(hook.result.current.displayPayload?.blockRows).toBeDefined());
  return { full, hook };
}

describe("usePlotPayload — waterfall X offset across a zoom re-fetch", () => {
  it.each([0.05, -0.05])("every shifted series keeps all its points in the visible window (dx %s)", async (dx) => {
    const { full, hook } = await zoomed(dx);
    const shown = hook.result.current.displayPayload!;
    // The step's basis stays the full range — the canvas' and the live export span's
    // (`Stage/useLiveSnapshotPublish` publishes `waterfallXSpanOf` the fetched payload).
    expect(waterfallXSpanOf(hook.result.current.payload!)).toBe(N - 1);
    for (let k = 0; k < Y_KEYS.length; k++) {
      const want = visible(full, k, LIM);
      expect(want.length).toBeGreaterThan(900); // every slot does reach into the window
      expect(visible(shown, k, LIM)).toEqual(want);
    }
  });

  it("a non-waterfall plot windows exactly the committed limits, as before", async () => {
    const { full, hook } = await zoomed(0);
    const [, , , , , , , , xMin, xMax] = fetchPlotMock.mock.calls[1] as unknown[]; // [0] is the real module
    expect([xMin, xMax]).toEqual(LIM);
    const shown = hook.result.current.displayPayload!;
    expect(shown.blockRows).toBeUndefined();
    for (let k = 0; k < Y_KEYS.length; k++) expect(visible(shown, k, LIM)).toEqual(visible(full, k, LIM));
  });
});
