// Regression coverage for MultiPanelStage's FOUR render modes (plain stack,
// spatial-apply, facet-by-column, paneled x-breaks — gap #21's last
// residual). Real uPlot needs a browser canvas/layout engine neither jsdom
// nor this test cares about; the constructor is mocked to a lightweight
// recorder so the render effect (the thing actually under test — did the
// right NUMBER of panels get built, without throwing) can run headlessly.
// jsdom also has no ResizeObserver, so it's stubbed too.

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpatialPanel } from "../../lib/multipanel";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";

// vi.mock's factory is hoisted above imports, so the recorder + mock class
// must be created through vi.hoisted rather than referenced as plain
// module-scope variables (they'd otherwise be "used before initialization").
const { created, MockUPlot } = vi.hoisted(() => {
  const created: unknown[] = [];
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

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    seriesOrder: null,
    stackMode: true,
    spatialPanels: null,
    facetPanels: null,
    breakPanels: null,
    showAxisBox: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MultiPanelStage — mode regressions", () => {
  it("plain per-channel stack mode renders without throwing", async () => {
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    // Both channels (a, b) plot by default -> one panel each.
    expect(created).toHaveLength(2);
  });

  it("facet-by-column mode still renders (regression)", async () => {
    useApp.getState().facetByColumn("d1", 0);
    const expected = useApp.getState().facetPanels?.length ?? 0;
    expect(expected).toBeGreaterThan(0);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(expected));
  });

  it("spatial-apply mode still renders (regression)", async () => {
    useApp.setState({
      spatialPanels: [
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 3],
          yLim: [0, 40],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
        },
      ],
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
  });

  // Fix #5: a spatial panel's OWN annotation marks must render (previously
  // silently dropped by the multi-panel apply path). The default "pointer"
  // tool (MAIN #18) with no `annotationEdit` bridge (MultiPanelStage doesn't
  // wire one — pointer-mode direct manipulation is a PlotStage-only surface)
  // adds zero plugins on its own, same as "zoom" did, so one plugin present
  // is exactly the annotation plugin buildOpts adds for a non-empty
  // `annotations` list.
  it("spatial-apply mode threads a panel's OWN annotations through (fix #5)", async () => {
    useApp.setState({
      spatialPanels: [
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 3],
          yLim: [0, 40],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
          annotations: [{ id: "a1", x: 1, y: 20, text: "peak" }],
        },
      ],
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const opts = created[0] as { opts: { plugins: unknown[] } };
    expect(opts.opts.plugins.length).toBe(1);
  });

  // Fix #4: a spatial panel's decoded legend label overrides the series name.
  it("spatial-apply mode threads a panel's seriesLabels through to the series label", async () => {
    useApp.setState({
      spatialPanels: [
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 3],
          yLim: [0, 40],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
          seriesLabels: { 0: "Field-cooled" },
        },
      ],
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const opts = created[0] as { opts: { series: { label?: string }[] } };
    expect(opts.opts.series[1].label).toBe("Field-cooled");
  });

  // Fix #2: a panel's decoded step drives fixed log-axis ticks.
  it("spatial-apply mode threads a panel's yStep through to the y-axis splits", async () => {
    useApp.setState({
      spatialPanels: [
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 3],
          yLim: [0.7139, 1.2732],
          xLog: false,
          yLog: true,
          row: 0,
          col: 0,
          yStep: 0.1,
        },
      ],
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const opts = created[0] as { opts: { axes: { splits?: unknown }[] } };
    expect(typeof opts.opts.axes[1].splits).toBe("function");
  });

  it("paneled x-break mode renders one uPlot per segment (gap #21 residual)", async () => {
    useApp.getState().breakAtGaps("d1", [[1, 2]]);
    const expected = useApp.getState().breakPanels?.length ?? 0;
    expect(expected).toBe(2);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(expected));
  });
});

// Owner-routing item 4 ("none of the sub plots are boxed in"): the singleton
// `showAxisBox` flag must reach EVERY panel mode's `buildOpts` call, not just
// the single-plot PlotStage. Same "one plugin = the thing under test" idiom
// as the fix #5 annotations regression above — the default "pointer" tool
// (MAIN #18) with no other decorations adds zero plugins on its own, same as
// "zoom" did, so a bare boolean flip isolates exactly the axis-box plugin.
describe("MultiPanelStage — per-panel axis box (item 4)", () => {
  it("plain per-channel stack mode adds the axis-box plugin to every panel when showAxisBox is on", async () => {
    useApp.setState({ showAxisBox: true });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(2));
    for (const c of created as { opts: { plugins: unknown[] } }[]) {
      expect(c.opts.plugins.length).toBe(1);
    }
  });

  it("spatial-apply mode adds the axis-box plugin per panel when showAxisBox is on", async () => {
    useApp.setState({
      showAxisBox: true,
      spatialPanels: [
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 3],
          yLim: [0, 40],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
        },
      ],
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const opts = created[0] as { opts: { plugins: unknown[] } };
    expect(opts.opts.plugins.length).toBe(1);
  });

  it("paneled x-break mode adds the axis-box plugin per panel when showAxisBox is on", async () => {
    useApp.setState({ showAxisBox: true });
    useApp.getState().breakAtGaps("d1", [[1, 2]]);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(2));
    for (const c of created as { opts: { plugins: unknown[] } }[]) {
      expect(c.opts.plugins.length).toBe(1);
    }
  });

  it("facet-by-column mode adds the axis-box plugin per panel when showAxisBox is on", async () => {
    useApp.setState({ showAxisBox: true });
    useApp.getState().facetByColumn("d1", 0);
    const expected = useApp.getState().facetPanels?.length ?? 0;
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(expected));
    for (const c of created as { opts: { plugins: unknown[] } }[]) {
      expect(c.opts.plugins.length).toBe(1);
    }
  });

  it("adds no axis-box plugin when showAxisBox is off (default)", async () => {
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(2));
    for (const c of created as { opts: { plugins: unknown[] } }[]) {
      expect(c.opts.plugins.length).toBe(0);
    }
  });
});

// Item A (PNR.opj Book14 Graph11 repro): a "Y-error"-designated column (e.g.
// dSA) must never render as its own spurious series in the spatial
// multi-panel path — it's dropped from the plotted set and instead drives
// error-bar whiskers on its paired Y channel.
describe("MultiPanelStage — spatial error bars (item A)", () => {
  it("drops a hidden (Y-error) channel from the panel's series and draws whiskers instead", async () => {
    useApp.setState({
      spatialPanels: [
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0, 1], // channel 1 ("b") is dSA — Y-error for channel 0
          xLim: [0, 3],
          yLim: [0, 400],
          xLog: false,
          yLog: false,
          row: 0,
          col: 0,
          hiddenChannels: [1],
          errKeys: { 0: 1 },
        },
      ],
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const c = created[0] as { opts: { series: unknown[]; plugins: unknown[] }; data: unknown[] };
    // Only ONE real series (channel 0) — channel 1 (hidden) never became its
    // own series. `opts.series` is [x-descriptor, ...dataSeries].
    expect(c.opts.series).toHaveLength(2);
    expect(c.data).toHaveLength(2); // x column + 1 plotted column
    // The errorBarsPlugin is the only plugin (tool defaults to no-op here,
    // showAxisBox is off) — same "one plugin = the thing under test" idiom
    // the fix #5 annotations regression above uses.
    expect(c.opts.plugins.length).toBe(1);
  });

  it("draws no error-bar plugin when the panel has no errKeys (regression: today's behaviour unaffected)", async () => {
    useApp.setState({
      spatialPanels: [
        { datasetId: "d1", xKey: null, yKeys: [0], xLim: [0, 3], yLim: [0, 40], xLog: false, yLog: false, row: 0, col: 0 },
      ],
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const c = created[0] as { opts: { plugins: unknown[] } };
    expect(c.opts.plugins.length).toBe(0);
  });
});

// Item B (decode-plan #36 residual, PNR.opj Graph11): panels vertically
// adjacent in the same grid column that share an x-range sit flush, with x
// tick values/title shown ONLY on the bottom panel of the run.
describe("MultiPanelStage — shared-x flush stacking (item B)", () => {
  const sharedXPanels: SpatialPanel[] = [
    { datasetId: "d1", xKey: null, yKeys: [0], xLim: [0, 3], yLim: [0, 40], xLog: false, yLog: false, row: 0, col: 0 },
    { datasetId: "d1", xKey: null, yKeys: [1], xLim: [0, 3], yLim: [0, 400], xLog: false, yLog: false, row: 1, col: 0 },
  ];

  it("suppresses x tick values on the TOP panel of a flush run, keeps the BOTTOM panel's default ticks", async () => {
    useApp.setState({ spatialPanels: sharedXPanels });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(2));
    const [top, bottom] = created as { opts: { axes: { label?: string; values?: unknown }[] } }[];
    expect(top.opts.axes[0].label).toBeUndefined();
    expect(typeof top.opts.axes[0].values).toBe("function"); // forced-blank formatter
    expect((top.opts.axes[0].values as (u: unknown, s: unknown[]) => unknown[])(null, [1, 2, 3])).toEqual([
      "",
      "",
      "",
    ]);
    // The bottom panel keeps buildOpts's own default x formatting — the
    // increment-aware auto override (MAIN #20), not the item-B blank
    // formatter the top panel gets (a DIFFERENT, later override — see
    // useMultiPanelStage.ts's flush-run block).
    expect(typeof bottom.opts.axes[0].values).toBe("function");
    expect((bottom.opts.axes[0].values as (u: unknown, s: unknown[]) => unknown[])(null, [1, 2, 3])).not.toEqual([
      "",
      "",
      "",
    ]);
  });

  it("does NOT suppress independent (non-shared-x) panels — same-shape grid, different x-ranges", async () => {
    useApp.setState({
      spatialPanels: [
        { ...sharedXPanels[0] },
        { ...sharedXPanels[1], xLim: [0, 999] }, // no longer shares the top panel's x-range
      ],
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(2));
    const [top, bottom] = created as { opts: { axes: { values?: unknown }[] } }[];
    // Neither panel is flush-stacked here, so both keep buildOpts's own
    // increment-aware auto formatter (MAIN #20) rather than the item-B
    // blank-label override (which only applies to a shared-x flush run) —
    // assert on BEHAVIOUR, not just "is a function" (the blank override is
    // also a function), so this stays a real suppression regression check.
    for (const panel of [top, bottom]) {
      const fn = panel.opts.axes[0].values as (u: unknown, s: unknown[]) => unknown[];
      expect(fn(null, [1, 2, 3])).not.toEqual(["", "", ""]);
    }
  });
});
