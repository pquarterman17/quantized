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
});
