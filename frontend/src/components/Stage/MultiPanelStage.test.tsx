// Regression coverage for MultiPanelStage's FOUR render modes (plain stack,
// spatial-apply, facet-by-column, paneled x-breaks — gap #21's last
// residual). Real uPlot needs a browser canvas/layout engine neither jsdom
// nor this test cares about; the constructor is mocked to a lightweight
// recorder so the render effect (the thing actually under test — did the
// right NUMBER of panels get built, without throwing) can run headlessly.
// jsdom also has no ResizeObserver, so it's stubbed too.

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { breakPanelsOf, facetPanelsOf, spatialComposition } from "../../lib/composition";
import { buildStageFigureSpec } from "../../lib/figureSpec";
import { createFigureDocument } from "../../lib/figureDocument";
import type { SpatialPanel } from "../../lib/multipanel";
import { defaultPlotView } from "../../lib/plotview";
import type { DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import RealMultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

// L4 (review round 3): the real component no longer derives its own
// effective composition -- `PlotStage.tsx` does that once and passes it
// down as a prop (`MultiPanelStageProps.composition`). This test file's ~25
// `render(<MultiPanelStage />)` call sites all predate that split and drive
// the SAME behavior by mutating the store directly (`useApp.setState({
// composition: ... })` or `{ facetKey: ... }`), so rather than threading a
// prop through every one of them, this thin local wrapper reproduces
// PlotStage's OWN derivation (`useEffectiveComposition`) and forwards it --
// every test below keeps exercising the identical fallback logic, just via
// the same seam PlotStage itself uses instead of a copy.
function MultiPanelStage() {
  const active = useActiveDataset();
  const composition = useEffectiveComposition(active);
  return <RealMultiPanelStage composition={composition} />;
}

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
    composition: null,
    // F4.4: `facetKey` is now a durable binding a prior test's
    // `facetByColumn` call leaves set on the shared store singleton
    // (`useApp.setState` merges) -- reset it here too, or a LATER test
    // expecting plain-stack mode gets a resurrected facet grid instead
    // (`MultiPanelStage.tsx`'s `facetCompositionFromBinding` fallback).
    facetKey: null,
    // Same shared-singleton reset reasoning as `facetKey` above: the
    // BUG-014 facet-rename tests below set `seriesLabels`, and a later test
    // asserting derived labels must not inherit it (`yKeys` is already reset
    // above for the same reason).
    seriesLabels: {},
    showLegend: true,
    showAxisBox: false,
    plotTemplate: "screen",
    defaultLineWidth: 1.5,
    defaultTrace: "Line",
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

  it("applies the selected presentation template and default trace to every panel", async () => {
    useApp.setState({ plotTemplate: "poster", defaultLineWidth: 9, defaultTrace: "Line + markers" });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    for (const panel of created as { opts: { axes: { font?: string }[]; series: { width?: number; points?: { show?: boolean } }[] } }[]) {
      expect(panel.opts.axes[0].font).toContain("18px");
      // Poster owns its calibrated 3.5px fallback; the Screen-only 9px user
      // default must not leak into a named publication template.
      expect(panel.opts.series[1].width).toBe(3.5);
      expect(panel.opts.series[1].points?.show).toBe(true);
    }
  });

  it("keeps the user's fallback line width in the Screen template", async () => {
    useApp.setState({ plotTemplate: "screen", defaultLineWidth: 4, defaultTrace: "Line" });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    for (const panel of created as { opts: { axes: { font?: string }[]; series: { width?: number }[] } }[]) {
      expect(panel.opts.axes[0].font).toContain("12px");
      expect(panel.opts.series[1].width).toBe(4);
    }
  });

  it("facet-by-column mode still renders (regression)", async () => {
    useApp.getState().facetByColumn("d1", 0);
    const expected = facetPanelsOf(useApp.getState().composition)?.length ?? 0;
    expect(expected).toBeGreaterThan(0);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(expected));
  });

  // BUG-014 (review round), SCREEN half. Before this, the facet branch called
  // `buildOpts` with NO `seriesLabels` at all, so a renamed channel read its
  // derived "Signal (au)" in every facet panel while the flat plot beside it
  // read "Loop 1" -- and the facet EXPORT produced a third string again
  // ("Loop 1 (au)", BUG-014's own symptom). The export half is pinned in
  // `lib/figureSpecFacets.test.ts`; this asserts the string the real
  // `buildOpts` puts on the real uPlot options object.
  it("a legend rename reaches every facet panel's legend, verbatim", async () => {
    const UNITS: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [1, 100],
        [1, 200],
        [2, 300],
        [2, 400],
      ],
      labels: ["batch", "Signal"],
      units: ["", "au"],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "ds1", data: UNITS }],
      activeId: "d1",
      yKeys: [1],
      seriesLabels: { 1: "Loop 1" },
    });
    useApp.getState().facetByColumn("d1", 0);
    const expected = facetPanelsOf(useApp.getState().composition)?.length ?? 0;
    expect(expected).toBe(2);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(expected));
    const labels = (created as { opts: { series: { label?: string }[] } }[]).map(
      (panel) => panel.opts.series[1].label,
    );
    expect(labels).toEqual(["Loop 1", "Loop 1"]);
  });

  it("a facet panel with NO rename still reads its derived 'label (unit)'", async () => {
    const UNITS: DataStruct = {
      time: [0, 1, 2, 3],
      values: [
        [1, 100],
        [1, 200],
        [2, 300],
        [2, 400],
      ],
      labels: ["batch", "Signal"],
      units: ["", "au"],
      metadata: {},
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "ds1", data: UNITS }],
      activeId: "d1",
      yKeys: [1],
      seriesLabels: {},
    });
    useApp.getState().facetByColumn("d1", 0);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(2));
    const labels = (created as { opts: { series: { label?: string }[] } }[]).map(
      (panel) => panel.opts.series[1].label,
    );
    expect(labels).toEqual(["Signal (au)", "Signal (au)"]);
  });

  // FIGURE_AUTHORING_WORKFLOW_PLAN F4.4: `composition` (the immediate render
  // cache `facetByColumn` fills in) is gone -- exactly the state a focus
  // switch, a workspace reopen, or a resolved recipe's freshly-focused window
  // leaves behind -- yet the facet grid renders anyway, rebuilt from the
  // durable `facetKey` binding alone. This is the actual proof a facet
  // arrangement is "editable on Stage" after a restore, not just a store-side
  // field check.
  it("rebuilds the facet grid from facetKey ALONE when composition is null (post-restore/focus-switch)", async () => {
    // Build once (for the expected panel count), then drop `composition` --
    // exactly the state a focus switch/workspace reopen/recipe-apply leaves
    // behind -- and confirm the SAME grid still renders from `facetKey` alone.
    useApp.getState().facetByColumn("d1", 0);
    const expected = facetPanelsOf(useApp.getState().composition)?.length ?? 0;
    expect(expected).toBeGreaterThan(0);
    useApp.setState({ composition: null });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(expected));
  });

  it("spatial-apply mode still renders (regression)", async () => {
    useApp.setState({
      composition: spatialComposition([
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
      ]),
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
      composition: spatialComposition([
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
      ]),
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const opts = created[0] as { opts: { plugins: unknown[] } };
    expect(opts.opts.plugins.length).toBe(1);
  });

  it("threads a panel's decoded region bands into the behind-data shade plugin", async () => {
    useApp.setState({
      composition: spatialComposition([
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
          regionShades: [
            { id: "shade-1", x1: 0.5, x2: 1.5, y1: 10, y2: 30, fill: "#99AABB" },
          ],
        },
      ]),
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const opts = created[0] as {
      opts: { plugins: { hooks?: { drawClear?: unknown[] } }[] };
    };
    expect(opts.opts.plugins).toHaveLength(1);
    expect(opts.opts.plugins[0].hooks?.drawClear).toHaveLength(1);
  });

  // Fix #4: a spatial panel's decoded legend label overrides the series name.
  it("spatial-apply mode threads a panel's seriesLabels through to the series label", async () => {
    useApp.setState({
      composition: spatialComposition([
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
      ]),
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const opts = created[0] as { opts: { series: { label?: string }[] } };
    expect(opts.opts.series[1].label).toBe("Field-cooled");
  });

  it("renders a panel-local static legend with the decoded title, position, and line+marker swatch", async () => {
    useApp.setState({
      composition: spatialComposition([
        {
          sourceFigureIds: ["fig-1"],
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
          seriesStyles: { 0: { width: 2, marker: true, markerShape: "circle" } },
          legendTitle: "Cooling sweep",
          legendFrameXY: [0.2, 0.3],
        },
      ]),
    });
    const { container } = render(<MultiPanelStage />);
    await waitFor(() => expect(container.querySelector(".qzk-spatial-legend")).not.toBeNull());
    expect(container.textContent).toContain("Cooling sweep");
    expect(container.textContent).toContain("Field-cooled");
    const sample = container.querySelector(".qzk-spatial-legend .qzk-legend-sample");
    expect(sample?.getAttribute("data-line")).toBe("true");
    expect(sample?.getAttribute("data-marker")).toBe("circle");
    const legend = container.querySelector<HTMLElement>(".qzk-spatial-legend");
    expect(legend?.style.left).toContain("--qz-frame-left");
    expect(legend?.style.top).toContain("--qz-frame-top");
  });

  it("does not invent a spatial legend when no layer legend text decoded", async () => {
    useApp.setState({
      composition: spatialComposition([
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
      ]),
    });
    const { container } = render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    expect(container.querySelector(".qzk-spatial-legend")).toBeNull();
  });

  // Fix #2: a panel's decoded step drives fixed log-axis ticks.
  it("spatial-apply mode threads a panel's yStep through to the y-axis splits", async () => {
    useApp.setState({
      composition: spatialComposition([
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
      ]),
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const opts = created[0] as { opts: { axes: { splits?: unknown }[] } };
    expect(typeof opts.opts.axes[1].splits).toBe("function");
  });

  it("spatial log panels retain 2-9 minor splits and decade-only labels", async () => {
    useApp.setState({
      composition: spatialComposition([
        {
          datasetId: "d1",
          xKey: null,
          yKeys: [0],
          xLim: [0, 3],
          yLim: [0.001, 0.1],
          xLog: false,
          yLog: true,
          row: 0,
          col: 0,
        },
      ]),
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(1));
    const axis = (created[0] as {
      opts: { axes: {
        splits?: (u: unknown, i: number, min: number, max: number) => number[];
        filter?: (u: unknown, splits: number[]) => (number | null)[];
      }[] };
    }).opts.axes[1];
    const splits = axis.splits?.(null, 1, 0.001, 0.1) ?? [];
    expect(splits).toContain(0.002);
    const labels = axis.filter?.(null, splits) ?? splits;
    expect(labels.filter((v) => v != null)).toEqual([0.001, 0.01, 0.1]);
  });

  it("paneled x-break mode renders one uPlot per segment (gap #21 residual)", async () => {
    useApp.getState().breakAtGaps("d1", [[1, 2]]);
    const expected = breakPanelsOf(useApp.getState().composition)?.length ?? 0;
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
      composition: spatialComposition([
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
      ]),
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
    const expected = facetPanelsOf(useApp.getState().composition)?.length ?? 0;
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(expected));
    for (const c of created as { opts: { plugins: unknown[] } }[]) {
      expect(c.opts.plugins.length).toBe(1);
    }
  });

  it("adds no axis-box plugin when showAxisBox is off", async () => {
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
      composition: spatialComposition([
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
      ]),
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
      composition: spatialComposition([
        { datasetId: "d1", xKey: null, yKeys: [0], xLim: [0, 3], yLim: [0, 40], xLog: false, yLog: false, row: 0, col: 0 },
      ]),
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
    useApp.setState({ composition: spatialComposition(sharedXPanels) });
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

  // R9 (POST_SPRINT_INDEPENDENT_REVIEW): useMultiPanelStage.ts's two fetch
  // effects call `ensureBookData` imperatively but deliberately exclude it
  // from their dependency arrays (it's a stable Zustand-store action
  // reference — see the hook's own `ensureBookData` param doc). These pin
  // down that the lazy-book fetch trigger this exclusion doc promises still
  // fires, in both the plain-stack and spatial-apply paths, so a future
  // change can't silently drop the trigger while "fixing" the lint warning.
  it("triggers ensureBookData for a pending active dataset in plain-stack mode", async () => {
    // R9 code-review F4: `vi.spyOn` + `mockRestore()` (the same idiom
    // WindowCanvas.test.tsx/WorksheetPane.test.tsx/useApp.test.ts use for
    // this exact action), not `useApp.setState({ ensureBookData: vi.fn() })`
    // — the latter permanently overwrites the shared store's real action
    // with a no-op for every LATER test in this file (the shared
    // `beforeEach` above never restores it), silently breaking any future
    // test that depends on the real fetch-trigger behavior.
    const ensureBookData = vi.spyOn(useApp.getState(), "ensureBookData").mockImplementation(() => {});
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "ds1",
          data: DATA,
          pending: { kind: "path", bookId: "book-1", rows: 4, cols: 2 },
        },
      ],
    });
    render(<MultiPanelStage />);
    // `ensureBookData` is called synchronously inside the fetch effect
    // (before its `fetchPlot(...).then(...)`), so it's already true once
    // `render` (act-wrapped) returns — no need to wait on the mock call
    // itself (TEST_DETERMINISM_PLAN #6's weak-wait ratchet).
    expect(ensureBookData).toHaveBeenCalledWith("d1");
    // Let the fetch-driven render effect finish too, so no ResizeObserver
    // construction is left dangling past this test's own afterEach unstub.
    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    ensureBookData.mockRestore();
  });

  it("triggers ensureBookData for each pending panel dataset in spatial-apply mode", async () => {
    const ensureBookData = vi.spyOn(useApp.getState(), "ensureBookData").mockImplementation(() => {});
    useApp.setState({
      datasets: [
        {
          id: "d1",
          name: "ds1",
          data: DATA,
          pending: { kind: "path", bookId: "book-1", rows: 4, cols: 2 },
        },
      ],
      composition: spatialComposition([
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
      ]),
    });
    render(<MultiPanelStage />);
    // Same synchronous-call reasoning as the plain-stack test above.
    expect(ensureBookData).toHaveBeenCalledWith("d1");
    await waitFor(() => expect(created.length).toBeGreaterThan(0));
    ensureBookData.mockRestore();
  });

  it("does NOT suppress independent (non-shared-x) panels — same-shape grid, different x-ranges", async () => {
    useApp.setState({
      composition: spatialComposition([
        { ...sharedXPanels[0] },
        { ...sharedXPanels[1], xLim: [0, 999] }, // no longer shares the top panel's x-range
      ]),
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

// BUG-012: the DOM half of the durable x-break fallback. The store is shaped
// like a just-reopened workspace — the focused window's document carries
// `plot.axisBreaks.x`, `composition` is null — and the component under test is
// the SAME wrapper every test above uses, i.e. the real
// `useEffectiveComposition` feeding the real `MultiPanelStage`. Before the fix
// this rendered ONE panel (an unbroken line); the paneled-break unit coverage
// lives in `useEffectiveComposition.test.tsx`.
describe("MultiPanelStage — a reopened document's saved x-break (BUG-012)", () => {
  it("renders one uPlot per segment from the document alone, with no live gesture", async () => {
    useApp.setState({
      plotWindows: [
        {
          id: "w1", kind: "plot", title: "", datasetId: "d1",
          geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
          bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
          document: createFigureDocument({
            id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView(),
            axisBreaks: { x: [[1, 2]] },
          }),
        },
      ],
      focusedWindowId: "w1",
      composition: null,
    });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created.length).toBe(2));
    // Non-vacuous: the plain per-channel stack ALSO makes two panels here (two
    // channels, stackMode on), so the count alone proves nothing. A break
    // panel is an x-SLICE carrying every channel — DATA's x is 0,1 | 2,3
    // around the [1, 2] break — while a stack panel carries the full x with
    // one channel. Assert the slicing.
    const [left, right] = created as { data: number[][] }[];
    expect(left.data[0]).toEqual([0, 1]);
    expect(right.data[0]).toEqual([2, 3]);
    expect(left.data).toHaveLength(3); // x + both channels, not one
  });
});


// BUG-014 round 4. The facet grid was fixed in round 3; the OTHER two
// multi-panel legs (plain per-channel stack, paneled x-breaks) still called
// `buildOpts` with no `seriesLabels`. That matters because `buildOpts` sets
// `legend: { show: false }` and `PlotStage.tsx` mounts `MultiPanelStage`
// INSTEAD of `PlotViewport` + `PlotLegend`: the only slot a series' resolved
// name appears in is the panel's Y-AXIS LABEL (`uplotOpts`' `soloLabel`), so
// these assert `opts.axes[1].label` — the thing on screen — not only the
// series label. The EXPORT of both views already carried the rename
// (`figureSpec.ts`'s `series_styles[i].legend`; a stack or break view exports
// as the flat figure), so before this the two disagreed.
const RENAME_DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [10, 100],
    [20, 200],
    [30, 300],
    [40, 400],
  ],
  labels: ["Field", "Signal"],
  units: ["T", "au"],
  metadata: {},
};

/** Every panel's y-axis label — the one visible label slot in a multi-panel
 *  mode — in panel order. */
function yAxisLabels(): (string | undefined)[] {
  return (created as { opts: { axes: { label?: string }[] } }[]).map((p) => p.opts.axes[1]?.label);
}

const RENDER_OPTS = { fmt: "pdf", style: "default", dpi: 300, title: "" };

describe("MultiPanelStage — a legend rename in the stack and break legs (BUG-014 round 4)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [{ id: "d1", name: "ds1", data: RENAME_DATA }],
      activeId: "d1",
      // Shared-store hygiene, the same reason the file's own `beforeEach`
      // resets `facetKey`/`seriesLabels`: the BUG-012 describe above leaves a
      // focused window whose DOCUMENT carries `plot.axisBreaks.x`, which
      // `useEffectiveComposition`'s durable fallback would turn into a break
      // arrangement under the stack tests below — and which
      // `buildStageFigureSpec` would export THROUGH (a document-routed spec
      // carries the document's view, not the live renames).
      plotWindows: [],
      focusedWindowId: null,
    });
  });

  it("reaches the renamed channel's STACK panel verbatim, leaving the other panel's derived label alone", async () => {
    useApp.setState({ seriesLabels: { 1: "Loop 1" } });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    // Non-vacuous: panel 0 is NOT renamed and must still read "label (unit)",
    // so this pins the rename to the right panel rather than "any override".
    expect(yAxisLabels()).toEqual(["Field (T)", "Loop 1"]);
    const seriesLabels = (created as { opts: { series: { label?: string }[] } }[]).map(
      (p) => p.opts.series[1].label,
    );
    expect(seriesLabels).toEqual(["Field (T)", "Loop 1"]);
  });

  it("leaves an un-renamed STACK view reading its derived labels", async () => {
    useApp.setState({ seriesLabels: {} });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(yAxisLabels()).toEqual(["Field (T)", "Signal (au)"]);
  });

  // The twin of `figureSpecFacets.test.ts`'s "keys renames by CHANNEL, not by
  // series position": yKeys [1, 0] puts channel 1 in the FIRST panel, so
  // indexing the rename map by panel position instead of by channel would put
  // "Loop 1" on the wrong panel (and nothing on the right one).
  it("keys a STACK rename by CHANNEL, not by panel position", async () => {
    useApp.setState({ yKeys: [1, 0], seriesLabels: { 1: "Loop 1" } });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(yAxisLabels()).toEqual(["Loop 1", "Field (T)"]);
  });

  it("reaches EVERY x-break panel verbatim", async () => {
    useApp.setState({ yKeys: [1], seriesLabels: { 1: "Loop 1" } });
    useApp.getState().breakAtGaps("d1", [[1, 2]]);
    expect(breakPanelsOf(useApp.getState().composition)).toHaveLength(2);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(yAxisLabels()).toEqual(["Loop 1", "Loop 1"]);
  });

  it("leaves an un-renamed x-break view reading its derived label", async () => {
    useApp.setState({ yKeys: [1], seriesLabels: {} });
    useApp.getState().breakAtGaps("d1", [[1, 2]]);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(yAxisLabels()).toEqual(["Signal (au)", "Signal (au)"]);
  });

  // Fail-closed half of the break projection: a break panel carries no
  // channel list of its own (unlike a `FacetPanel`), so the hook re-derives
  // it the way `lib/facet.breakPayloads` did. Here the composition was built
  // from one channel and the view now selects two — the derivation no longer
  // describes the panels, so NO renames are passed rather than one landing on
  // the wrong series by position.
  it("passes no renames at all when the view's channel selection no longer matches the built panels", async () => {
    useApp.setState({ yKeys: [1], seriesLabels: { 0: "WRONG", 1: "Loop 1" } });
    useApp.getState().breakAtGaps("d1", [[1, 2]]);
    useApp.setState({ yKeys: [0, 1] });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    expect(yAxisLabels()).toEqual(["Signal (au)", "Signal (au)"]);
  });

  // The parity the bug is actually about: the string on screen and the string
  // the export wire carries for the SAME channel, in the SAME view.
  it("SCREEN label == EXPORT legend for a renamed channel in a stack view", async () => {
    useApp.setState({ seriesLabels: { 1: "Loop 1" } });
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    const spec = buildStageFigureSpec(
      useApp.getState,
      { id: "d1", name: "ds1", data: RENAME_DATA },
      "fig",
      RENDER_OPTS,
    );
    const legend = spec.series_styles?.[1]?.legend;
    expect(legend).toBe("Loop 1");
    expect(yAxisLabels()[1]).toBe(legend);
  });

  it("SCREEN label == EXPORT legend for a renamed channel in an x-break view", async () => {
    useApp.setState({ yKeys: [1], seriesLabels: { 1: "Loop 1" } });
    useApp.getState().breakAtGaps("d1", [[1, 2]]);
    render(<MultiPanelStage />);
    await waitFor(() => expect(created).toHaveLength(2));
    const spec = buildStageFigureSpec(
      useApp.getState,
      { id: "d1", name: "ds1", data: RENAME_DATA },
      "fig",
      RENDER_OPTS,
    );
    const legend = spec.series_styles?.[0]?.legend;
    expect(legend).toBe("Loop 1");
    expect(yAxisLabels()).toEqual([legend, legend]);
  });
});
