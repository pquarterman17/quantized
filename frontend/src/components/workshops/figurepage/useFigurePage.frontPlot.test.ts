// Plot > Multi-panel export… opens with the plot in front as panel 1, and "Add this plot again" makes a
// second panel from the same file (acceptance pass 6 usability 3, pass 7 usability 5). Through the real hook
// and store: a panel is a plot WINDOW, one window per slot, so the second panel is a duplicated window.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFigureDocument } from "../../../lib/figureDocument";
import { createPageDocument } from "../../../lib/pageDocumentActions";
import { defaultPlotView, type PlotWindow } from "../../../lib/plotview";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFigurePage } from "./useFigurePage";

vi.mock("../../../lib/api", () => ({
  exportFigurePage: vi.fn().mockResolvedValue(undefined),
  renderFigurePageBlob: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
  fetchBookData: vi.fn(),
}));
vi.mock("../../../lib/clipboard", () => ({ clipboardImageSupported: vi.fn(() => true), clipboardSvgSupported: vi.fn(() => true) }));
vi.mock("../../../lib/officeClipboard", () => ({ copyOfficeGraphicFormats: vi.fn().mockResolvedValue([]) }));

const DATA: DataStruct = { time: [0, 1, 2], values: [[1, 9], [2, 8], [3, 7]], labels: ["A", "B"], units: ["u", "v"], metadata: {} };

function win(over: Partial<PlotWindow>): PlotWindow {
  const base: PlotWindow = {
    id: "w1", kind: "plot", title: "", datasetId: "d1", geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 0,
    winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, ...over,
  };
  if (base.kind === "plot") base.document = createFigureDocument({ id: `figure-${base.id}`, name: base.title, datasetId: base.datasetId, view: base.view });
  return base;
}

const plotWindows = () => useApp.getState().plotWindows;

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: DATA }],
    activeId: "d1",
    focusedWindowId: "w1",
    plotWindows: [win({ id: "w1", title: "Loop A" }), win({ id: "w2", title: "Unbound", datasetId: null }), win({ id: "w3", kind: "worksheet", title: "Sheet" })],
    figureDocs: [],
    editableFigures: [],
    pageDocSeed: null,
    status: "",
  });
});

describe("Multi-panel export opens with the plot in front", () => {
  it("fills panel 1 with the focused plot window and leaves the rest empty", () => {
    const { result } = renderHook(() => useFigurePage());
    expect(result.current.slots.map((s) => s.source)).toEqual([{ kind: "window", id: "w1", name: "Loop A" }, null]);
    expect(result.current.labels).toEqual(["(a)", ""]);
    expect(result.current.rows).toBe(1);
    expect(result.current.cols).toBe(2);
  });

  it("starts empty when the window in front is not a plot, has no dataset, or none is focused", () => {
    for (const focused of ["w3", "w2", null]) {
      useApp.setState({ focusedWindowId: focused });
      const { result, unmount } = renderHook(() => useFigurePage());
      expect(result.current.slots.every((s) => s.source === null)).toBe(true);
      unmount();
    }
  });

  it("leaves a page being reopened to its own saved panels", () => {
    useApp.setState({ pageDocSeed: createPageDocument({ id: "p1", name: "Saved", rows: 1, cols: 2 }) });
    const { result } = renderHook(() => useFigurePage());
    expect(result.current.slots.every((s) => s.source === null)).toBe(true);
  });
});

describe("clicking a source that is already a panel", () => {
  it("selects its panel and leaves it where it is, so the page keeps its order", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.assignToNext({ kind: "window", id: "w1", name: "Loop A" }));
    expect(result.current.slots.map((s) => s.source?.id)).toEqual(["w1", undefined]);
    expect(result.current.selected).toBe(0);
  });
});

describe("Add this plot again", () => {
  it("copies the panel's plot window and puts the copy in the next slot", () => {
    const { result } = renderHook(() => useFigurePage());
    expect(result.current.canAddPlotAgain).toBe(true);
    act(() => result.current.addPlotAgain());
    expect(plotWindows()).toHaveLength(4);
    const copy = plotWindows().find((w) => !["w1", "w2", "w3"].includes(w.id))!;
    expect(copy.datasetId).toBe("d1"); // the same file, a second plot window of it
    const [first, second] = result.current.slots.map((s) => s.source);
    expect(first).toMatchObject({ kind: "window", id: "w1" });
    expect(second).toMatchObject({ kind: "window", id: copy.id });
    expect(result.current.labels).toEqual(["(a)", "(b)"]);
  });

  it("copies the SELECTED window panel, not the first", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.addPlotAgain()); // slot 1 = the copy
    act(() => result.current.setSelected(1));
    const before = plotWindows().length;
    act(() => result.current.addPlotAgain()); // the auto grid grows to take it
    expect(plotWindows()).toHaveLength(before + 1);
    expect(result.current.slots.filter((s) => s.source !== null)).toHaveLength(3);
  });

  it("with the grid fixed and full it says so and opens nothing", () => {
    const { result } = renderHook(() => useFigurePage());
    act(() => result.current.setGrid(1, 2)); // the user's own grid: no auto-grow
    act(() => result.current.addPlotAgain());
    const windows = plotWindows().length;
    act(() => result.current.addPlotAgain());
    expect(plotWindows()).toHaveLength(windows);
    expect(useApp.getState().status).toMatch(/every slot is full/);
    expect(result.current.slots.map((s) => s.source?.id)).toHaveLength(2);
  });

  it("is unavailable until a plot window is on the page", () => {
    useApp.setState({ focusedWindowId: null });
    const { result } = renderHook(() => useFigurePage());
    expect(result.current.canAddPlotAgain).toBe(false);
    act(() => result.current.addPlotAgain());
    expect(plotWindows()).toHaveLength(3);
  });
});
