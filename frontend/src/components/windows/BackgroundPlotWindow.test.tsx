// BackgroundPlotWindow renders a background (unfocused) window's LIVE data
// through the same usePlotPayload/PlotViewport core the focused PlotStage
// uses, driven by the window's OWN PlotView rather than the live singleton
// store fields, and with NO tool plugins/overlays (MULTI_PLOT_PLAN item 4,
// Key Decision 2). Real uPlot needs a browser canvas/layout engine neither
// jsdom nor this test cares about, so the constructor is mocked to a
// lightweight recorder (same pattern as MultiPanelStage.test.tsx).

import { render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView } from "../../lib/plotview";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import BackgroundPlotWindow from "./BackgroundPlotWindow";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { opts: unknown; data: unknown }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: unknown, data: unknown) {
      created.push({ opts, data });
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["a"],
  units: [""],
  metadata: {},
};

const DATASET: Dataset = { id: "d1", name: "ds1", data: DATA };

// Stubbed for the WHOLE file (not per-test) — see WindowCanvas.test.tsx's
// identical comment for why a per-test stub/unstub risks a stray late-
// resolving fetchPlot promise throwing between tests.
beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  created.length = 0;
});
afterEach(() => useApp.setState({ fitOverlay: null }));

describe("BackgroundPlotWindow", () => {
  it("with no bound dataset, shows an empty state and builds no uPlot instance", () => {
    render(<BackgroundPlotWindow dataset={null} view={defaultPlotView()} />);
    expect(created).toHaveLength(0);
  });

  it("with a bound dataset, renders the SAME live data pipeline as the focused window (no tool plugin)", async () => {
    render(<BackgroundPlotWindow dataset={DATASET} view={defaultPlotView()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const opts = created[0].opts as { plugins: unknown[] };
    // tool="zoom" + no refLines/annotations/errorBars/wheelZoom/peakWizardEdit
    // activates none of buildOpts's tool/decoration plugins.
    expect(opts.plugins).toHaveLength(0);
  });

  it("ignores the singleton store's tool overlays entirely (decision #2 — focused-window-only)", async () => {
    // A background window must NEVER show a fit/peak/baseline/deriv overlay
    // even if the LIVE singleton happens to have one set (e.g. from whatever
    // the focused window is doing) — it always passes null regardless.
    useApp.setState({ fitOverlay: { datasetId: "d1", y: [1, 2, 3, 4] } });
    render(<BackgroundPlotWindow dataset={DATASET} view={defaultPlotView()} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const data = created[0].data as unknown[][];
    // Only x + the one data channel — no extra "fit" series column appended.
    expect(data).toHaveLength(2);
  });

  it("reflects the window's OWN view (e.g. yLog) rather than the live singleton", async () => {
    const view = { ...defaultPlotView(), yLog: true };
    render(<BackgroundPlotWindow dataset={DATASET} view={view} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const opts = created[0].opts as { scales: { y: { distr: number } } };
    expect(opts.scales.y.distr).toBe(3); // uPlot's log-scale distr code
  });
});
