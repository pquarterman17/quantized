// Item 22 through the real store path: browse buttons, the axis scroller (one
// drag = one Back-view step), the filter (an ordinary Data Filter, one undo)
// and the Pick list becoming a worksheet.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { pickPlugin } from "../../../lib/uplotLasso";
import type { Dataset } from "../../../lib/types";
import { makePickedWorksheet, usePickedPoints } from "../../../store/pickedPoints";
import { useApp } from "../../../store/useApp";
import GraphBrowserPanel from "./GraphBrowserPanel";

const sheet = (id: string): Dataset => ({
  id, name: `S${id}`,
  data: { time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], values: Array.from({ length: 11 }, (_, i) => [i, 10 * i, 100 * i]), labels: ["P", "Q", "R"], units: ["", "", ""], metadata: {} },
});

beforeEach(() => {
  useApp.setState({
    datasets: [sheet("a"), sheet("b")], activeId: "a", selectedIds: [], history: [], future: [], viewHistory: [], viewFuture: [],
    xKey: null, yKeys: [0], hiddenChannels: [], seriesOrder: [], seriesStyles: {}, seriesLabels: {}, workbooks: [],
    xLim: null, yLim: null, xScale: "linear", yScale: "linear", plotTool: "pointer",
  });
  usePickedPoints.getState().clear();
});

const open = (name: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));

describe("Graph browser", () => {
  it("steps the column with the Next button", async () => {
    render(<GraphBrowserPanel />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Next column" })));
    const g = useApp.getState().datasets.find((d) => d.linkedCurves);
    expect(g?.linkedCurves?.[0]).toMatchObject({ datasetId: "a", yKey: 1 });
  });

  it("scrolls the zoomed X axis; a drag is ONE Back-view step", () => {
    useApp.setState({ xLim: [2, 4] });
    render(<GraphBrowserPanel />);
    open("Scroll an axis");
    const slider = screen.getByLabelText("Scroll the X axis") as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    fireEvent.change(slider, { target: { value: "500" } });
    fireEvent.change(slider, { target: { value: "1000" } });
    fireEvent.pointerUp(slider);
    expect(useApp.getState().xLim).toEqual([8, 10]);
    expect(useApp.getState().viewHistory).toHaveLength(1);
    useApp.getState().backView();
    expect(useApp.getState().xLim).toEqual([2, 4]);
  });

  it("disables the scroller on an auto axis and says why", () => {
    render(<GraphBrowserPanel />);
    open("Scroll an axis");
    expect((screen.getByLabelText("Scroll the X axis") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByText(/zoom in first/).length).toBe(2);
  });

  it("filters to the plotted range through the Data Filter, undoable", () => {
    useApp.setState({ xLim: [2, 4] });
    render(<GraphBrowserPanel />);
    open("Filter to the plotted range");
    fireEvent.click(screen.getByRole("button", { name: "Keep only these rows" }));
    const a = () => useApp.getState().datasets.find((d) => d.id === "a")!;
    expect(a().filter).toEqual([{ col: -1, kind: "range", min: 2, max: 4 }]);
    useApp.getState().undo();
    expect(a().filter).toBeUndefined();
  });
});

describe("Pick points", () => {
  it("arms the Pick tool, and the list becomes a worksheet with provenance (one undo step)", () => {
    render(<GraphBrowserPanel />);
    open("Pick points");
    fireEvent.click(screen.getByRole("button", { name: "Pick points", pressed: false }));
    expect(useApp.getState().plotTool).toBe("pick");
    const a = sheet("a");
    usePickedPoints.getState().add({ datasetId: "a", datasetName: "Sa", row: 3, xKey: null, yKey: 1, x: 3, y: 30, xLabel: "X", yLabel: "Q" });
    const before = useApp.getState().datasets.length;
    const id = makePickedWorksheet("picks");
    expect(useApp.getState().datasets).toHaveLength(before + 1);
    expect(useApp.getState().datasets.find((d) => d.id === id)?.data.values).toEqual([[30, 4]]);
    expect(usePickedPoints.getState().points).toHaveLength(0);
    expect(a.id).toBe("a");
  });

  it("the plugin hands a click over as a one-vertex outline", () => {
    const calls: unknown[] = [];
    const over = document.createElement("div");
    over.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    const plugin = pickPlugin((_u, poly) => calls.push(poly));
    (plugin.hooks.ready as (u: unknown) => void)({ over });
    over.dispatchEvent(new MouseEvent("click", { clientX: 15, clientY: 28, button: 0 }));
    expect(calls).toEqual([[[5, 8]]]);
  });
});
