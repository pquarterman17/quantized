// BackgroundPlotWindow renders a background (unfocused) window's LIVE data
// through the same usePlotPayload/PlotViewport core the focused PlotStage
// uses, driven by the window's OWN PlotView rather than the live singleton
// store fields, and with NO tool plugins/overlays (MULTI_PLOT_PLAN item 4,
// Key Decision 2). Item 15 makes it the render-MODE dispatcher too: the
// view's polar/stat/stack flags pick the content while the live singletons
// hold whatever the FOCUSED window is doing — proven per mode below. Real
// uPlot needs a browser canvas/layout engine neither jsdom nor this test
// cares about, so the constructor is mocked to a lightweight recorder (same
// pattern as MultiPanelStage.test.tsx); statRender.draw is mocked to a
// recorder likewise (Canvas2D has no queryable output in jsdom).

import { render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotView } from "../../lib/plotview";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import BackgroundPlotWindow from "./BackgroundPlotWindow";

const { created, MockUPlot, statDrawCalls } = vi.hoisted(() => {
  const created: { opts: unknown; data: unknown }[] = [];
  const statDrawCalls: unknown[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(opts: unknown, data: unknown) {
      created.push({ opts, data });
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot, statDrawCalls };
});
vi.mock("uplot", () => ({ default: MockUPlot }));
// The statistics core delegates every paint to statRender.draw — record the
// StatDrawData it was handed (jsdom's canvas has no 2d context to inspect).
vi.mock("../Stage/statRender", () => ({
  draw: (_canvas: unknown, _host: unknown, data: unknown) => {
    statDrawCalls.push(data);
  },
}));

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

// Two value channels — enough for the stack mode's ≥2-plotted gate.
const DATA2: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [10, 100],
    [20, 200],
    [30, 300],
    [40, 400],
  ],
  labels: ["a", "b"],
  units: ["", ""],
  metadata: {},
};

const DATASET2: Dataset = { id: "d2", name: "ds2", data: DATA2 };

// Stubbed for the WHOLE file (not per-test) — see WindowCanvas.test.tsx's
// identical comment for why a per-test stub/unstub risks a stray late-
// resolving fetchPlot promise throwing between tests.
beforeAll(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  created.length = 0;
  statDrawCalls.length = 0;
});
afterEach(() =>
  useApp.setState({
    fitOverlay: null,
    datasets: [],
    polarMode: false,
    statMode: false,
    stackMode: false,
    insetMode: false,
  }),
);

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

  it("reflects the window's OWN view (e.g. yScale) rather than the live singleton", async () => {
    const view = { ...defaultPlotView(), yScale: "log" as const };
    render(<BackgroundPlotWindow dataset={DATASET} view={view} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const opts = created[0].opts as { scales: { y: { distr: number } } };
    expect(opts.scales.y.distr).toBe(3); // uPlot's log-scale distr code
  });

  it("a linkGroup joins the uPlot cursor-sync group + x-range sync hook (item 13); no group = no sync patch", async () => {
    render(<BackgroundPlotWindow dataset={DATASET} view={defaultPlotView()} linkGroup={2} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const linked = created[0].opts as {
      cursor: { sync?: { key: string } };
      hooks?: { setScale?: unknown[] };
    };
    expect(linked.cursor.sync?.key).toBe("qz-win-link-2");
    expect(linked.hooks?.setScale).toHaveLength(1);

    created.length = 0;
    render(<BackgroundPlotWindow dataset={DATASET} view={defaultPlotView()} linkGroup={null} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const unlinked = created[0].opts as {
      cursor: { sync?: unknown };
      hooks?: { setScale?: unknown[] };
    };
    expect(unlinked.cursor.sync).toBeUndefined();
    expect(unlinked.hooks?.setScale).toBeUndefined();
  });
});

// Item 15 — alternate render modes from the window's OWN view. Each proof
// pins the corresponding live singleton to the OPPOSITE state, so a pass can
// only come from the view-driven dispatch.

/** Mirrors WindowCanvas's dataset binding (datasets.find by the window's
 *  datasetId): a store row-state toggle replaces the dataset object and
 *  re-renders the window with the fresh reference — the rowstate-chokepoint
 *  propagation path the row-exclusion test below exercises. */
function StoreBoundWindow({ id, view }: { id: string; view: PlotView }) {
  const dataset = useApp((s) => s.datasets.find((d) => d.id === id) ?? null);
  return <BackgroundPlotWindow dataset={dataset} view={view} />;
}

describe("BackgroundPlotWindow — item 15 alternate render modes", () => {
  it("view.polarMode renders the polar Canvas2D core while the live singleton polarMode is false", async () => {
    expect(useApp.getState().polarMode).toBe(false);
    const view = { ...defaultPlotView(), polarMode: true };
    const { container } = render(<BackgroundPlotWindow dataset={DATASET} view={view} />);
    // Polar is a Canvas2D renderer: a real <canvas>, and neither an XY uPlot
    // instance nor a stat draw call.
    expect(container.querySelector("canvas")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 10)); // let any stray XY fetch land
    expect(created).toHaveLength(0);
    expect(statDrawCalls.filter((d) => d != null)).toHaveLength(0);
  });

  it("live singleton mode flags are IGNORED — the dispatch reads the window's own view", async () => {
    // Every alternate flag lit on the singletons (as if the FOCUSED window
    // were showing polar/stat/stack/inset) — this window's view says plain XY.
    useApp.setState({ polarMode: true, statMode: true, stackMode: true, insetMode: true });
    render(<BackgroundPlotWindow dataset={DATASET} view={defaultPlotView()} />);
    await waitFor(() => expect(created).toHaveLength(1)); // the plain XY viewport…
    await new Promise((r) => setTimeout(r, 10));
    expect(created).toHaveLength(1); // …and no inset joined it either
    expect(statDrawCalls.filter((d) => d != null)).toHaveLength(0);
  });

  it("view.statMode renders the statistics core; a live row-exclusion toggle propagates (rowstate chokepoint)", async () => {
    useApp.setState({ datasets: [DATASET] });
    expect(useApp.getState().statMode).toBe(false);
    const view = { ...defaultPlotView(), statMode: true };
    render(<StoreBoundWindow id="d1" view={view} />);
    // Offline box-stats fallback (no backend in jsdom): one box per plotted
    // channel over all 4 rows.
    await waitFor(() => {
      const last = statDrawCalls.at(-1) as { mode: string; boxes: { n: number }[] } | null;
      expect(last?.mode).toBe("box");
      expect(last?.boxes[0]?.n).toBe(4);
    });
    expect(created).toHaveLength(0); // Canvas2D — no uPlot instance at all

    // The row-state proof: exclusion flows through lib/rowstate.analysisData
    // (useStatStage's chokepoint) into the background window's stats.
    useApp.getState().toggleRowExcluded("d1", 0);
    await waitFor(() => {
      const last = statDrawCalls.at(-1) as { boxes: { n: number }[] } | null;
      expect(last?.boxes[0]?.n).toBe(3);
    });
  });

  it("view.stackMode renders one uPlot panel per channel — per-window sync key, no tool plugins", async () => {
    expect(useApp.getState().stackMode).toBe(false);
    const view = { ...defaultPlotView(), stackMode: true };
    render(<BackgroundPlotWindow dataset={DATASET2} view={view} />);
    await waitFor(() => expect(created).toHaveLength(2)); // one panel per channel
    for (const c of created) {
      const opts = c.opts as { plugins: unknown[]; cursor: { sync?: { key: string } } };
      expect(opts.plugins).toHaveLength(0); // non-interactive (Key Decision 2)
      // This window's panels sync among THEMSELVES — never with the focused
      // stage's "qz-multipanel" group or another window's panels.
      expect(opts.cursor.sync?.key).toMatch(/^qz-win-stack-/);
    }
  });

  it("view.stackMode with a single plotted channel falls back to the plain XY path (PlotStage's own gate)", async () => {
    const view = { ...defaultPlotView(), stackMode: true };
    render(<BackgroundPlotWindow dataset={DATASET} view={view} />);
    await waitFor(() => expect(created).toHaveLength(1));
    const opts = created[0].opts as { cursor: { sync?: unknown } };
    expect(opts.cursor.sync).toBeUndefined(); // the XY path, unlinked
  });

  it("view.insetMode renders the magnifier inset alongside the XY viewport (previously dropped while unfocused)", async () => {
    expect(useApp.getState().insetMode).toBe(false);
    const view = { ...defaultPlotView(), insetMode: true };
    render(<BackgroundPlotWindow dataset={DATASET} view={view} />);
    await waitFor(() => expect(created).toHaveLength(2)); // main viewport + inset
  });
});
