// A plot's row window on the facet grid, the axis break and the spatial panel set (ROW_RANGE_CONTRACT 3.3, item 31):
// what draws on screen and what exports are exactly the window's rows, compared with a plain selection of them.
// The window is set the way the user sets it (`setPlotRowRange`), the arrangement is the real hook's
// (`useEffectiveComposition`), the figure is the Stage's own export (`buildStageFigureSpec`).
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { spatialComposition } from "../../lib/composition";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset, DataStruct } from "../../lib/types";
import { setPlotRowRange } from "../../store/plotRowRangeSet";
import { useActiveDataset, useApp } from "../../store/useApp";
import MultiPanelStage from "./MultiPanelStage";
import { useEffectiveComposition } from "./useEffectiveComposition";

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { data: unknown[][] }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 } };
    constructor(_opts: unknown, data: unknown[][]) {
      created.push({ data });
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

const N = 200;
const WINDOW = { from: 20, to: 43 };
const rowsIn = (from: number, to: number, drop: readonly number[] = []) =>
  Array.from({ length: to - from + 1 }, (_v, i) => from + i).filter((r) => !drop.includes(r));

/** x = row, with a gap after row 29 (x jumps by 100); y = 2 * row; facet level = row % 3. */
const xOf = (r: number) => (r < 30 ? r : r + 100);
const data = (): DataStruct => ({
  time: Array.from({ length: N }, (_v, r) => xOf(r)),
  values: Array.from({ length: N }, (_v, r) => [2 * r, r % 3]),
  labels: ["y", "lvl"], units: ["", ""], metadata: {},
});
const ds = (): Dataset => ({ id: "d1", name: "sheet", data: data(), excludedRows: [25] });

function Arranged() {
  const active = useActiveDataset();
  return <MultiPanelStage composition={useEffectiveComposition(active)} />;
}

function setup(extra: Record<string, unknown> = {}): void {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [ds()], activeId: "d1", xKey: null, yKeys: [0], stackMode: false, history: [], future: [],
    plotWindows: [{
      id: "w1", kind: "plot", title: "", datasetId: "d1", geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
      bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
      document: createFigureDocument({ id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView() }),
    }],
    focusedWindowId: "w1",
    excludedDisplay: "hide",
    ...extra,
  });
}

beforeEach(() => {
  created.length = 0;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => cleanup()); // unmount before anything the lazy window code might still re-render

/** The x data of the last `n` uPlot panels drawn (a render that waits for the lazy window code draws an earlier set first). */
const lastPanels = (n: number): number[][] => created.slice(-n).map((c) => c.data[0] as number[]);

const exportSpec = () => buildStageFigureSpec(useApp.getState, useApp.getState().datasets[0], "fig", { fmt: "svg", style: "default", dpi: 300, title: "" });

describe("a facet grid draws and exports only the window's rows", () => {
  const want = rowsIn(WINDOW.from, WINDOW.to, [25]); // the window, less the sheet's exclusion
  const panelsOf = (level: number) => want.filter((r) => r % 3 === level).map(xOf);

  it("on screen: one panel per level, each holding exactly that level's window rows", async () => {
    setup({ facetKey: 1 });
    await act(async () => setPlotRowRange(WINDOW));
    render(<Arranged />);
    // The window code loads lazily: until it has, nothing (never every row) is drawn, then the grid is built from the window.
    await waitFor(() => expect(lastPanels(3)).toEqual([0, 1, 2].map(panelsOf)));
    expect(lastPanels(3).flat().sort((a, b) => a - b)).toEqual(want.map(xOf));
    expect(screen.getByRole("status").textContent).toContain("rows 21-44 of 200");
    expect(screen.getByRole("status").textContent).not.toContain("draws every row");
  });

  it("with no window every row of the sheet is in the grid", async () => {
    setup({ facetKey: 1 });
    render(<Arranged />);
    await waitFor(() => expect(lastPanels(3).reduce((n, p) => n + p.length, 0)).toBe(N - 1));
  });

  it("in the export: the same panels with the same rows", () => {
    setup({ facetKey: 1 });
    act(() => void setPlotRowRange(WINDOW));
    const facets = exportSpec().facets ?? [];
    expect(facets.map((f) => f.x)).toEqual([0, 1, 2].map(panelsOf));
    expect(facets.map((f) => f.series[0].y)).toEqual([0, 1, 2].map((l) => want.filter((r) => r % 3 === l).map((r) => 2 * r)));
  });

  it("a named link that cannot be read draws no rows, and its export refuses", async () => {
    setup({ facetKey: 1 });
    useApp.setState({ rowRange: { from: 0, to: -1, named: "nr1:x", namedAs: "Base", refused: "the named range was removed" } });
    render(<Arranged />);
    expect(screen.getByRole("status").textContent).toContain("Base: no rows");
    expect(created.every((c) => (c.data[0] as number[]).length === 0)).toBe(true);
    expect(exportSpec).toThrow(/the named range was removed/);
  });
});

describe("an axis break draws and exports only the window's rows", () => {
  it("on screen and in the export: the window holds both sides of the gap, each panel its own rows", async () => {
    setup({ xKey: null });
    useApp.getState().breakAtGaps("d1", [[29, 130]]);
    await act(async () => setPlotRowRange(WINDOW));
    render(<Arranged />);
    const want = rowsIn(WINDOW.from, WINDOW.to, [25]);
    await waitFor(() => expect(lastPanels(2)).toEqual([want.filter((r) => r < 30).map(xOf), want.filter((r) => r >= 30).map(xOf)]));
    const spec = exportSpec();
    expect(spec.overrides?.x_breaks).toEqual([[29, 130]]);
    expect(spec.dataset.time).toEqual(want.map(xOf)); // the figure holds the window's rows; the renderer panels them
    expect(screen.getByRole("status").textContent).not.toContain("draws every row");
  });

  it("a window on one side of the gap leaves no break: the plot is flat, on screen and in the export", async () => {
    setup({ xKey: null });
    useApp.getState().breakAtGaps("d1", [[29, 130]]);
    await act(async () => setPlotRowRange(WINDOW)); // both sides of the gap: a break, once the window code has loaded
    const hook = renderHook(() => useEffectiveComposition(useActiveDataset()));
    await waitFor(() => expect(hook.result.current?.kind).toBe("break"));
    await act(async () => setPlotRowRange({ from: 0, to: 9 })); // one side only: nothing left to break
    await waitFor(() => expect(hook.result.current).toBeNull());
    const spec = exportSpec();
    expect(spec.overrides?.x_breaks).toBeUndefined();
    expect(spec.dataset.time).toEqual(rowsIn(0, 9, [25]).map(xOf));
  });
});

describe("a spatial panel set draws the window on the panels of its sheet", () => {
  const panel = (datasetId: string, col: number) => ({ datasetId, xKey: null, yKeys: [0], xLim: [0, 2] as [number, number], yLim: [1, 3] as [number, number], xLog: false, yLog: false, row: 0, col });

  it("cuts the panel of the windowed sheet and leaves another sheet's panel whole, saying so", async () => {
    const other: Dataset = { id: "d2", name: "other", data: { time: [0, 1, 2, 3], values: [[5], [6], [7], [8]], labels: ["z"], units: [""], metadata: {} } };
    const composition = spatialComposition([panel("d1", 0), panel("d2", 1)]);
    setup({ composition, stackMode: true });
    useApp.setState({ datasets: [ds(), other] });
    await act(async () => setPlotRowRange(WINDOW));
    render(<MultiPanelStage composition={composition} />);
    await waitFor(() => expect(created.length).toBe(2));
    // The sheet's panel holds the window's 24 rows (the excluded one is masked, not removed: its y is blank); the
    // other sheet's panel holds all 4.
    const sheet = created.find((c) => (c.data[0] as number[]).length === 24)!;
    expect(created.map((c) => (c.data[0] as number[]).length).sort((p, q) => p - q)).toEqual([4, 24]);
    expect(sheet.data[0]).toEqual(rowsIn(WINDOW.from, WINDOW.to).map(xOf));
    expect((sheet.data[1] as (number | null)[]).filter((v) => v !== null)).toEqual(rowsIn(WINDOW.from, WINDOW.to, [25]).map((r) => 2 * r));
    const chip = screen.getByRole("status").textContent ?? "";
    expect(chip).toContain("rows 21-44 of 200");
    expect(chip).toContain("panels of other sheets draw every row");
  });

  it("a set whose panels are all on the windowed sheet carries no note", async () => {
    const composition = spatialComposition([panel("d1", 0)]);
    setup({ composition, stackMode: true });
    await act(async () => setPlotRowRange(WINDOW));
    render(<MultiPanelStage composition={composition} />);
    await waitFor(() => expect(created.length).toBe(1));
    expect((created[0].data[0] as number[]).length).toBe(24);
    expect((created[0].data[1] as (number | null)[]).filter((v) => v !== null)).toHaveLength(23);
    expect(screen.getByRole("status").textContent).not.toContain("other sheets");
  });
});
