// Perf audit follow-up (2026-09-29): with a Color / Symbol / Label encoding
// active, a dataset RENAME (new `active` object, same `data`) must not refetch
// or rebuild the plot. `useStageEncoding` used to key on `active` itself, so a
// rename minted a new StageEncoding, a new `plotted`, and a full round trip.
// `fetchPlot` is wrapped (network boundary only) around the REAL function, so
// the offline packer and the lazy lib/plotEncoding derivation both run.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../lib/types";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

const fetchPlotSpy = vi.fn();
vi.mock("../../lib/plotdata", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...real,
    fetchPlot: (...args: Parameters<typeof real.fetchPlot>) => {
      fetchPlotSpy(...args);
      return real.fetchPlot(...args);
    },
  };
});

const DS: Dataset = {
  id: "enc",
  name: "encoding.csv",
  data: {
    time: [0, 1, 2, 3, 4, 5],
    values: [
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 0],
      [5, 1],
      [6, 2],
    ],
    labels: ["Rxy", "sample"],
    units: ["Ohm", ""],
    metadata: {},
    cat_levels: { 1: ["S1", "S2", "S3"] },
  },
};

// Store-owned inputs keep their identity across renders in the app; so here.
const Y_KEYS = [0];
const STYLES: PlotPayloadParams["seriesStyles"] = {};
const LABELS: PlotPayloadParams["seriesLabels"] = {};
const ERR: PlotPayloadParams["errKeys"] = {};
const HIDDEN: PlotPayloadParams["hiddenChannels"] = [];

function params(o: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: DS, yScale: "linear", xScale: "linear", xKey: null, yKeys: Y_KEYS, groupKey: null,
    y2Keys: null, seriesOrder: null, seriesStyles: STYLES, seriesLabels: LABELS, errKeys: ERR,
    hiddenChannels: HIDDEN, waterfall: 0, excludedDisplay: "hide", fitOverlay: null,
    baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null, xLim: null,
    // A fresh picks object each render, as a rebuilt window document delivers it.
    encoding: { color: 1 }, ...o,
  };
}

async function mountEncoded() {
  const hook = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: params() });
  // Wait on STATE: the lazy derivation loaded and the split payload landed.
  await waitFor(() => expect(hook.result.current.displayPayload?.series).toHaveLength(3));
  return hook;
}

beforeEach(() => fetchPlotSpy.mockClear());

describe("usePlotPayload — an encoded window keys on data, not on the dataset object", () => {
  it("a rename neither refetches nor rebuilds the encoded plot", async () => {
    const { result, rerender } = await mountEncoded();
    const fetches = fetchPlotSpy.mock.calls.length;
    const before = result.current.displayPayload;
    const plotted = result.current.plotted;
    rerender(params({ active: { ...DS, name: "renamed.csv" } }));
    expect(fetchPlotSpy).toHaveBeenCalledTimes(fetches);
    expect(result.current.displayPayload).toBe(before);
    expect(result.current.plotted).toBe(plotted);
  });

  it("a data edit still refetches and redraws the split", async () => {
    const { result, rerender } = await mountEncoded();
    const fetches = fetchPlotSpy.mock.calls.length;
    const edited: Dataset = {
      ...DS,
      data: { ...DS.data, values: DS.data.values.map(([y, s]) => [y * 10, s]) },
    };
    rerender(params({ active: edited }));
    await waitFor(() => expect(result.current.displayPayload?.data[1]).toContain(10));
    expect(fetchPlotSpy.mock.calls.length).toBeGreaterThan(fetches);
    expect(fetchPlotSpy.mock.calls.at(-1)![0]).toBe(edited.data);
  });
});
