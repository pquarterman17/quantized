// BUGS_AND_ISSUES BUG-001, automated-test checklist items 1-3, end to end
// through the ACTUAL render pipeline (not just the pure helpers `lib/plotdata
// .test.ts` and `lib/errorbars.test.ts` already pin in isolation): an NCNR
// reductus `.refl` import's declared roles -- `metadata.default_value_channels`
// (parser) feeding `Dataset.errorRoles` (`store/importErrorRoles.ts`'s
// `parserErrorRoles`) -- must, once this hook renders them, produce (1) only
// the measured channel as a plotted series, (2) no standalone uncertainty/
// resolution series, and (3) a vertical (y) span for the uncertainty and a
// horizontal (x) span for the resolution, on that one plotted column.
//
// `fetchPlot` is mocked to delegate to the REAL `buildColumns` -- the same
// offline fallback a backend-less run already exercises -- so this isolates
// the hook's OWN wiring (effectiveChannels -> plotted -> buildErrorSpans) from
// network variance, matching the established pattern in
// `usePlotPayload.quickFigureParity.test.ts`.

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ErrorBinding } from "../../lib/errorRoles";
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

// The EXACT shape `quantized.io.ncnr._refl_role_metadata` declares for a
// reductus `.refl`: Qz -> time, three value channels, only the first
// (Intensity) in `default_value_channels`, symmetric Y error on it from
// `uncertainty`, symmetric X error (Q resolution) from `resolution`.
const errorRoles: ErrorBinding[] = [
  { channel: 1, target: 0, axis: "y", side: "both" },
  { channel: 2, target: -1, axis: "x", side: "both" },
];

const refl: Dataset = {
  id: "refl-1",
  name: "S3_6500e_From700mT.refl",
  data: {
    time: [0.01, 0.02, 0.03],
    values: [
      [100, 5, 0.001],
      [90, 4.5, 0.001],
      [80, 4, 0.001],
    ],
    labels: ["Intensity", "uncertainty", "resolution"],
    units: ["counts", "counts", "1/Ang"],
    metadata: { default_value_channels: [0] },
  },
  errorRoles,
};

function params(overrides: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: refl,
    yScale: "log", // reflectometry is always plotted log-Y
    xScale: "linear",
    xKey: null,
    yKeys: null, // untouched default -- must resolve via defaultDenseChannels
    groupKey: null,
    y2Keys: null,
    seriesOrder: null,
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    hiddenChannels: [],
    waterfall: 0,
    excludedDisplay: "hide",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
    xLim: null,
    ...overrides,
  };
}

describe("usePlotPayload — NCNR .refl declared roles render correctly (BUG-001)", () => {
  it("plots only the measured channel; uncertainty/resolution never appear as series", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params(),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    expect(result.current.plotted).toEqual([0]);
    expect(result.current.displayPayload!.series).toEqual([
      { label: "Intensity", unit: "counts", axis: 0 },
    ]);
    const labels = result.current.displayPayload!.series.map((s) => s.label);
    expect(labels).not.toContain("uncertainty");
    expect(labels).not.toContain("resolution");
  });

  it("draws a VERTICAL span from the uncertainty binding and a HORIZONTAL span from the resolution binding", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params(),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    // Column 1 = uPlot's index for the sole plotted series (column 0 is x).
    const spans = result.current.errorSpans.get(1);
    expect(spans).toBeDefined();
    const y = spans!.find((s) => s.axis === "y");
    const x = spans!.find((s) => s.axis === "x");
    expect(y).toBeDefined(); // vertical whisker
    expect(x).toBeDefined(); // horizontal whisker
    expect(y!.plus).toEqual([5, 4.5, 4]); // the uncertainty column's own values
    expect(x!.plus).toEqual([0.001, 0.001, 0.001]); // the resolution column's own values
  });

  it("keeps the log-Y scale request intact -- the uncertainty binding never alters the underlying data", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: params(),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    // The measured channel's own plotted values are exactly the source data,
    // untouched by the fact that a vertical whisker will extend below some of
    // these points on a log axis (the plugin, not this hook, decides how a
    // non-positive whisker end is drawn -- see uplotOverlays.test.ts).
    expect(result.current.displayPayload!.data[1]).toEqual([100, 90, 80]);
  });
});
