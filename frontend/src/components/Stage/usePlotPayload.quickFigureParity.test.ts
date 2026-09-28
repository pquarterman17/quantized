// G4 review round, FIX 3 (P2, coverage): the reviewer's end-to-end parity
// test. Two independent paths render the SAME (dataset, mapping, style):
//
//  1. `quickFigurePreview` -- the Quick Figure Builder's live preview.
//  2. `createQuickFigureFromMapping` -> `figureDocumentToPlotView` ->
//     `usePlotPayload` -- the actual store action, the canonical document it
//     produces, and the render pipeline every ordinary plot window runs.
//
// They must agree: labels, x-axis, error-span columns and magnitudes, mark,
// and the marker flag. `fetchPlot` is mocked to delegate to the REAL
// `buildColumns` (the same offline-fallback function `quickFigurePreview`
// itself calls) so this test exercises the GLUE — document conversion +
// param threading (xKey/yKeys/documentErrors) — without a network
// dependency; it is not testing `buildColumns` twice.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { figureDocumentToPlotView } from "../../lib/figureDocument";
import { quickFigurePreview } from "../../lib/quickFigurePreview";
import type { QuickFigureMapping } from "../../lib/quickFigureMapping";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

vi.mock("../../lib/plotdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/plotdata")>();
  return {
    ...actual,
    // Mirrors fetchPlot's own no-backend fallback (lib/plotdata.ts:655) --
    // the SAME function `quickFigurePreview` calls, so this isolates the
    // GLUE under test from network/backend variance.
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

const dataset: Dataset = {
  id: "parity-1",
  name: "parity.csv",
  data: {
    time: [0, 1, 2, 3],
    values: [
      [10, 100, 1000, 5, 3],
      [11, 101, 1001, 6, 4],
      [12, 102, 1002, 7, 2],
      [13, 103, 1003, 8, 1],
    ],
    labels: ["altX", "Y1", "Y2", "eplus", "eminus"],
    units: ["s", "V", "A", "V", "V"],
    metadata: {},
  },
};

// Alternate X (channel 0, not the acquisition axis), 2 Y series, one
// asymmetric pair on Y1, line-symbol style.
const mapping: QuickFigureMapping = {
  xKey: 0,
  yKeys: [1, 2],
  errorBindings: [
    { channel: 3, target: 1, axis: "y", side: "+" },
    { channel: 4, target: 1, axis: "y", side: "-" },
  ],
  ignoredKeys: [],
};

beforeEach(() => {
  useApp.setState({
    datasets: [dataset],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    techniqueViewMemory: {},
    history: [],
    future: [],
    status: "",
  });
});

describe("Quick Figure Builder preview vs the created figure's render pipeline (FIX 3 parity)", () => {
  it("agree on labels, x-axis, error-span columns/magnitudes, mark, and the marker flag", async () => {
    const preview = quickFigurePreview(dataset.data, mapping, "line-symbol", dataset.channelRoles);
    expect(preview.kind).toBe("xy");
    if (preview.kind !== "xy") return;

    const created = useApp.getState().createQuickFigureFromMapping(dataset.id, mapping, "line-symbol");
    expect(created).toBe(true);
    const document = useApp.getState().editableFigures[0];
    expect(document).toBeDefined();
    const view = figureDocumentToPlotView(document);

    const params: PlotPayloadParams = {
      active: dataset,
      yScale: "linear",
      xScale: "linear",
      xKey: view.xKey,
      yKeys: view.yKeys,
      groupKey: view.groupKey,
      y2Keys: view.y2Keys,
      seriesOrder: view.seriesOrder,
      seriesStyles: view.seriesStyles,
      seriesLabels: view.seriesLabels,
      errKeys: view.errKeys,
      documentErrors: document.bindings.errors,
      hiddenChannels: view.hiddenChannels,
      waterfall: view.waterfall,
      excludedDisplay: "hide",
      fitOverlay: null,
      baselineOverlay: null,
      peakOverlay: null,
      derivOverlay: null,
      selection: null,
      xLim: null,
    };
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: params });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    // Labels.
    expect(result.current.displayPayload!.series.map((s) => s.label)).toEqual(
      preview.payload.series.map((s) => s.label),
    );
    // X-axis.
    expect(result.current.displayPayload!.xLabel).toBe(preview.payload.xLabel);
    expect(result.current.displayPayload!.xUnit).toBe(preview.payload.xUnit);
    expect(result.current.displayPayload!.data[0]).toEqual(preview.payload.data[0]);

    // Error-span columns and magnitudes.
    expect(Array.from(result.current.errorSpans.entries())).toEqual(
      Array.from((preview.errorSpans ?? new Map()).entries()),
    );

    // Mark.
    expect(document.plot.mark).toBe(preview.mark);
    expect(document.plot.mark).toBe("line");

    // Marker flag: line-symbol sets `marker: true` on every plotted Y series
    // in the document's own seriesStyles (view.seriesStyles, keyed by
    // dataset channel) AND `quickFigurePreview`'s `showMarkers`.
    expect(preview.showMarkers).toBe(true);
    for (const ch of mapping.yKeys) {
      expect(view.seriesStyles[ch]?.marker).toBe(true);
    }
    // Reflected in the actual render's per-series style list too.
    expect(result.current.styleList?.every((s) => s?.marker === true)).toBe(true);
  });

  // Grouping role (LIBRARY_WORKBOOK_UX_PLAN six-role builder): the group
  // split must reach the CREATED figure's legend, not just the mapping --
  // the Stage's legend rows are `displayPayload.series` labels.
  it("a Grouping role renders the SAME per-level legend entries and columns in the created figure as in the preview", async () => {
    const grouped: Dataset = {
      id: "parity-g",
      name: "grouped.csv",
      data: {
        time: [0, 1, 2, 3],
        values: [[1, 0, 0.1], [2, 1, 0.2], [3, 0, 0.3], [4, 1, 0.4]],
        labels: ["R", "sample", "dR"],
        units: ["Ω", "", "Ω"],
        metadata: {},
        cat_levels: { 1: ["A", "B"] },
      },
    };
    useApp.setState({ datasets: [grouped] });
    const groupedMapping: QuickFigureMapping = {
      xKey: null,
      yKeys: [0],
      errorBindings: [{ channel: 2, target: 0, axis: "y", side: "both" }],
      ignoredKeys: [],
      groupKey: 1,
    };
    const preview = quickFigurePreview(grouped.data, groupedMapping, "scatter");
    expect(preview.kind).toBe("xy");
    if (preview.kind !== "xy") return;

    expect(useApp.getState().createQuickFigureFromMapping(grouped.id, groupedMapping, "scatter")).toBe(true);
    const document = useApp.getState().editableFigures[0];
    const view = figureDocumentToPlotView(document);
    expect(view.groupKey).toBe(1);

    const params: PlotPayloadParams = {
      active: grouped, yScale: "linear", xScale: "linear",
      xKey: view.xKey, yKeys: view.yKeys, groupKey: view.groupKey, y2Keys: view.y2Keys,
      seriesOrder: view.seriesOrder, seriesStyles: view.seriesStyles, seriesLabels: view.seriesLabels,
      errKeys: view.errKeys, documentErrors: document.bindings.errors, hiddenChannels: view.hiddenChannels,
      waterfall: view.waterfall, excludedDisplay: "hide", fitOverlay: null, baselineOverlay: null,
      peakOverlay: null, derivOverlay: null, selection: null, xLim: null,
    };
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: params });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    const legend = result.current.displayPayload!.series.map((s) => s.label);
    expect(legend).toEqual(["R (sample=A)", "R (sample=B)"]);
    expect(legend).toEqual(preview.payload.series.map((s) => s.label));
    expect(result.current.displayPayload!.data).toEqual(preview.payload.data);
    // Neither side draws error spans for a grouped view.
    expect(result.current.errorSpans.size).toBe(0);
    expect(preview.errorSpans).toBeUndefined();
  });

  // Per-series X (`X1,Y1,X2,Y2`, X2 a non-monotonic loop): the created figure
  // renders its overlay dataset through the ordinary pipeline, and must draw
  // exactly the preview's points -- each series on its own X, in row order.
  it("per-series X: the created figure draws the SAME points, X order, and error spans as the preview", async () => {
    const xyxy: Dataset = {
      id: "parity-x",
      name: "xyxy.csv",
      data: {
        time: [0, 1, 2, 3],
        values: [[5, 0, 50, 0.5], [6, 2, 60, 0.6], [7, 0, 70, 0.7], [8, -2, 80, 0.8]],
        labels: ["Y1", "X2", "Y2", "dY2"],
        units: ["V", "Oe", "V", "V"],
        metadata: {},
      },
    };
    useApp.setState({ datasets: [xyxy] });
    const ownX: QuickFigureMapping = {
      xKey: null,
      xKeyByY: { 2: 1 },
      yKeys: [0, 2],
      errorBindings: [{ channel: 3, target: 2, axis: "y", side: "both" }],
      ignoredKeys: [],
    };
    const preview = quickFigurePreview(xyxy.data, ownX, "line");
    if (preview.kind !== "xy") throw new Error("expected an xy preview");
    expect(preview.payload.data[0]).toEqual([0, 1, 2, 3, 0, 2, 0, -2]); // unsorted loop
    expect(preview.errorSpans?.get(2)?.[0].plus).toEqual([null, null, null, null, 0.5, 0.6, 0.7, 0.8]);

    expect(useApp.getState().createQuickFigureFromMapping(xyxy.id, ownX, "line")).toBe(true);
    const document = useApp.getState().editableFigures[0];
    const overlay = useApp.getState().datasets.find((d) => d.id === document.bindings.datasetId)!;
    expect(overlay.id).not.toBe(xyxy.id);
    const view = figureDocumentToPlotView(document);
    const params: PlotPayloadParams = {
      active: overlay, yScale: "linear", xScale: "linear",
      xKey: view.xKey, yKeys: view.yKeys, groupKey: view.groupKey, y2Keys: view.y2Keys,
      seriesOrder: view.seriesOrder, seriesStyles: view.seriesStyles, seriesLabels: view.seriesLabels,
      errKeys: view.errKeys, documentErrors: document.bindings.errors, hiddenChannels: view.hiddenChannels,
      waterfall: view.waterfall, excludedDisplay: "hide", fitOverlay: null, baselineOverlay: null,
      peakOverlay: null, derivOverlay: null, selection: null, xLim: null,
    };
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), { initialProps: params });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());

    const shown = result.current.displayPayload!;
    expect(shown.series.map((s) => s.label)).toEqual(["Y1", "Y2"]);
    expect(shown.series.map((s) => s.label)).toEqual(preview.payload.series.map((s) => s.label));
    expect(shown.xLabel).toBe(preview.payload.xLabel);
    expect(shown.data).toEqual(preview.payload.data);
    expect(Array.from(result.current.errorSpans.entries())).toEqual(Array.from((preview.errorSpans ?? new Map()).entries()));
  });
});
