// Plot audit round 4, measured on NCNR PNR (Rpp, Rmm, SA with dR and dQ) in a
// stack: the canvas drew only legacy vertical bars (no dQ whiskers, which the
// flat canvas and the export draw), and put a y2-tagged channel's one-series
// panel on a RIGHT axis, so its plot area no longer lined up with the others'
// x. A stack panel holds one series: it draws on the left like the rest, and
// with the same error spans as the flat plot.
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import type { BuildOptsArgs } from "../../lib/uplotOpts";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";

const { built, MockUPlot } = vi.hoisted(() => {
  const built: { payload: PlotPayload; args: BuildOptsArgs }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { built, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));
vi.mock("../../lib/uplotOpts", async (orig) => {
  const real = await orig<typeof import("../../lib/uplotOpts")>();
  return {
    ...real,
    buildOpts: (payload: PlotPayload, args: BuildOptsArgs) => {
      built.push({ payload, args });
      return real.buildOpts(payload, args);
    },
  };
});

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: [0.01, 0.02, 0.03],
  values: [[1, 0.1, 0.5, 0.001], [0.5, 0.05, 0.3, 0.001], [0.1, 0.01, 0.2, 0.002]],
  labels: ["R", "dR", "SA", "dQ"],
  units: ["", "", "", ""],
  metadata: {},
};

beforeEach(() => {
  built.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  useApp.setState({
    datasets: [{
      id: "d1", name: "pnr.refl", data: DATA,
      errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }, { channel: 3, target: -1, axis: "x", side: "both" }],
    }],
    activeId: "d1", xKey: null, yKeys: [0, 2], y2Keys: [2], seriesOrder: null, hiddenChannels: [], composition: null,
    facetKey: null, groupKey: null, seriesStyles: {}, seriesLabels: {}, plotWindows: [], focusedWindowId: null,
    polarMode: false, statMode: false, stackMode: true, errKeys: {},
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useApp.setState({ stackMode: false, y2Keys: null, errKeys: {} });
});

describe("MultiPanelStage — stack panels match the flat plot", () => {
  it("draws every panel on the left axis, a y2 channel's too", async () => {
    render(<MultiPanelStage composition={null} />);
    await waitFor(() => expect(built).toHaveLength(2));
    expect(built.map((b) => b.payload.series[0].axis ?? 0)).toEqual([0, 0]);
  });

  it("draws the dataset's error spans, x whiskers included", async () => {
    render(<MultiPanelStage composition={null} />);
    await waitFor(() => expect(built).toHaveLength(2));
    const axes = built.map((b) => (b.args.errorSpans?.get(1) ?? []).map((s) => s.axis).sort());
    expect(axes).toEqual([["x", "y"], ["x"]]);
  });
});
