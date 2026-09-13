// P3.3: the CANVAS half of the parity gate. `exportStyles.test.ts` /
// `figureSpec.test.ts` pin that the export cycles for exactly one family of
// views; this pins that the plot-window canvases refuse the SAME ones, which is
// the half that actually matters — a screen-only dash is what got FEATURE-001
// reverted (plans/BUGS_AND_ISSUES.md).

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useStageSeriesCycle, useWindowSeriesCycle } from "./useStageSeriesCycle";
import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView, type PlotView } from "../../lib/plotview";
import { useApp } from "../../store/useApp";

const reset = () =>
  useApp.setState({
    autoSeriesStyles: false,
    groupKey: null,
    facetKey: null,
    stackMode: false,
    polarMode: false,
    statMode: false,
    plotWindows: [],
    focusedWindowId: null,
  });

afterEach(reset);

const view = (patch: Partial<PlotView> = {}): PlotView => ({ ...defaultPlotView(), ...patch });

/** A window record carrying `document`, focused — the shape `useStageSeriesCycle`
 *  reads the exact-publication-styles refusal off. */
function focusWindow(document: ReturnType<typeof createFigureDocument>): void {
  useApp.setState({
    plotWindows: [
      {
        id: "w1",
        kind: "plot",
        title: "w1",
        datasetId: null,
        x: 0,
        y: 0,
        w: 400,
        h: 300,
        z: 1,
        view: defaultPlotView(),
        document,
      },
    ] as unknown as ReturnType<typeof useApp.getState>["plotWindows"],
    focusedWindowId: "w1",
  });
}

const doc = (seriesStyles?: (Record<string, unknown> | null)[]) =>
  createFigureDocument({
    id: "f1",
    name: "f",
    datasetId: null,
    view: defaultPlotView(),
    ...(seriesStyles === undefined
      ? {}
      : { publication: { overrides: null, seriesStyles: seriesStyles as never } }),
  });

describe("useStageSeriesCycle", () => {
  it("is null with the preference off — no cycle, and no array to churn deps", () => {
    reset();
    expect(renderHook(() => useStageSeriesCycle(3)).result.current).toBeNull();
  });

  it("is plain display order for the single-panel overlay with the preference on", () => {
    useApp.setState({ autoSeriesStyles: true });
    expect(renderHook(() => useStageSeriesCycle(3)).result.current).toEqual([0, 1, 2]);
  });

  it.each([
    ["grouped", { groupKey: 4 }],
    ["faceted", { facetKey: 0 }],
    ["stacked", { stackMode: true }],
    // polar/stat: PlotStage early-returns to PolarStage/StatStage before the
    // cycled viewport exists, but `buildStageFigureSpec` is NOT gated on the
    // render mode, so with the preference on "Export figure…" used to emit
    // dashes for a figure the screen had never dashed.
    ["polar", { polarMode: true }],
    ["stat", { statMode: true }],
  ])("refuses to cycle a %s view — its export cannot reproduce one", (_n, state) => {
    useApp.setState({ autoSeriesStyles: true, ...state });
    expect(renderHook(() => useStageSeriesCycle(3)).result.current).toBeNull();
  });

  it("refuses when the focused document pins EXACT publication series styles", () => {
    // figureSpec ships such an array verbatim and never calls buildExportStyles,
    // so a cycling canvas beside it would dash lines the PDF draws solid.
    useApp.setState({ autoSeriesStyles: true });
    focusWindow(doc([{ color: "#ff0000" }, null]));
    expect(renderHook(() => useStageSeriesCycle(3)).result.current).toBeNull();
  });

  it("still cycles when the focused document has no exact publication styles", () => {
    useApp.setState({ autoSeriesStyles: true });
    focusWindow(doc());
    expect(renderHook(() => useStageSeriesCycle(3)).result.current).toEqual([0, 1, 2]);
  });

  it("stops at the plotted count, so appended overlays are not cycled", () => {
    // `payload.series` also carries the fit / baseline / peak / derivative
    // overlays; no export draws them, so their positions must not exist.
    useApp.setState({ autoSeriesStyles: true });
    expect(renderHook(() => useStageSeriesCycle(2)).result.current).toEqual([0, 1]);
  });

  it("keeps a STABLE reference across re-renders (PlotViewport rebuilds on it)", () => {
    useApp.setState({ autoSeriesStyles: true });
    const { result, rerender } = renderHook(() => useStageSeriesCycle(3));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

// A background window is a live preview tiled beside the focused one; focus is
// not a styling input. Before this, series 2/3 were dashed in the focused window
// and solid in the neighbour, and clicking either swapped them.
describe("useWindowSeriesCycle — a background window resolves the SAME positions", () => {
  it("is null with the preference off", () => {
    reset();
    expect(renderHook(() => useWindowSeriesCycle(view(), undefined, 3)).result.current).toBeNull();
  });

  it("matches the focused Stage's cycle for the same plain overlay", () => {
    useApp.setState({ autoSeriesStyles: true });
    const focused = renderHook(() => useStageSeriesCycle(3)).result.current;
    const background = renderHook(() => useWindowSeriesCycle(view(), undefined, 3)).result.current;
    expect(background).toEqual(focused);
    expect(background).toEqual([0, 1, 2]);
  });

  it.each([
    ["grouped", { groupKey: 4 }],
    ["faceted", { facetKey: 0 }],
    ["stacked", { stackMode: true }],
    ["polar", { polarMode: true }],
    ["stat", { statMode: true }],
  ])("refuses a %s view from the window's OWN view, not the live singletons", (_n, patch) => {
    // The live singletons stay plain — a background window must be judged by the
    // view it actually draws from.
    useApp.setState({ autoSeriesStyles: true });
    expect(
      renderHook(() => useWindowSeriesCycle(view(patch), undefined, 3)).result.current,
    ).toBeNull();
  });

  it("refuses when THIS window's document pins exact publication series styles", () => {
    useApp.setState({ autoSeriesStyles: true });
    expect(
      renderHook(() => useWindowSeriesCycle(view(), doc([{ color: "#0f0" }]), 3)).result.current,
    ).toBeNull();
  });

  it("keeps a STABLE reference across re-renders", () => {
    useApp.setState({ autoSeriesStyles: true });
    const { result, rerender } = renderHook(() => useWindowSeriesCycle(view(), undefined, 3));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
