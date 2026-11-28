// Plan item 44 (Origin's Plot Details): the figure popups' Apply, OK and
// Cancel. Each popup is opened the way a user opens it (a double-click on the
// axis band, on the curve, on the legend box) and driven through its buttons:
//   Apply  writes the plot and keeps the popup open;
//   OK     applies and closes;
//   Cancel and Esc close and KEEP what was applied, dropping only later edits;
//   one undo step per popup session, however many Applies it held;
//   an outside click asks only about edits made after the last Apply.

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import AxisDropZones from "../../Stage/AxisDropZones";
import PlotLegend from "../../Stage/PlotLegend";
import { usePlotStageActions } from "../../Stage/usePlotStageActions";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import FigureDialogs from "./FigureDialogs";

const ds: Dataset = {
  id: "d",
  name: "d.csv",
  data: { time: [0, 1, 2], values: [[1, 4], [2, 5], [3, 6]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};
const st = () => useApp.getState();
const rect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => "" }) as DOMRect;

interface Driver {
  name: string;
  dialog: string;
  open: () => Promise<void>;
  /** Type `v` into the popup's field. */
  edit: (v: string) => void;
  /** What the store holds for that field. */
  read: () => unknown;
  /** `read()` once `v` is applied. */
  stored: (v: string) => unknown;
}

const axis: Driver = {
  name: "Axis popup",
  dialog: "Axis",
  async open() {
    render(
      <>
        <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={() => {}}>
          <div className="uplot" data-testid="chart"><div className="u-over" data-testid="over" /></div>
        </AxisDropZones>
        <FigureDialogs />
      </>,
    );
    vi.spyOn(screen.getByTestId("chart"), "getBoundingClientRect").mockReturnValue(rect(0, 0, 400, 300));
    vi.spyOn(screen.getByTestId("over"), "getBoundingClientRect").mockReturnValue(rect(50, 10, 350, 250));
    fireEvent.doubleClick(screen.getByTestId("chart"), { clientX: 200, clientY: 280 });
    await screen.findByRole("textbox", { name: "X axis title" });
  },
  edit: (v) => fireEvent.change(screen.getByRole("textbox", { name: "X axis title" }), { target: { value: v } }),
  read: () => st().xAxisLabel,
  stored: (v) => v,
};

const plotDetails: Driver = {
  name: "Plot details",
  dialog: "Plot details",
  async open() {
    const over = document.createElement("div");
    over.getBoundingClientRect = () => rect(100, 100, 500, 400);
    document.body.appendChild(over);
    const plot = {
      over, data: [[0, 100, 200, 300], [10, 20, 150, 40]], series: [{}, { scale: "y" }],
      posToVal: (px: number) => px, valToPos: (v: number) => v,
    } as unknown as uPlot;
    renderHook(() => usePlotStageActions({ current: plot }, null, null, undefined, [0, 9]));
    over.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 300, clientY: 250 }));
    await waitFor(() => expect(useFigureDialog.getState().open).toEqual({ kind: "plotDetails", channel: 0 }));
    render(<FigureDialogs />);
  },
  edit: (v) => fireEvent.change(screen.getByLabelText("Line width"), { target: { value: v } }),
  read: () => st().seriesStyles[0]?.width,
  stored: (v) => Number(v),
};

const legend: Driver = {
  name: "Legend popup",
  dialog: "Legend",
  async open() {
    const { container } = render(
      <>
        <PlotLegend series={[{ label: "A", unit: "" }, { label: "B", unit: "" }]} plotted={[0, 1]} hidden={[false, false]} />
        <FigureDialogs />
      </>,
    );
    fireEvent.doubleClick(container.querySelector(".qzk-legend") as HTMLElement);
    await screen.findByRole("dialog", { name: "Legend" });
  },
  edit: (v) => fireEvent.change(screen.getByLabelText("Legend entry for A"), { target: { value: v } }),
  read: () => st().seriesLabels[0],
  stored: (v) => v,
};

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({
    ...defaultPlotView(), datasets: [ds], activeId: "d", yKeys: null, xKey: null, seriesLabels: {}, seriesStyles: {},
    errKeys: {}, showLegend: true, legendPos: "sw", legendXY: null, legendFrameXY: null, plotTool: "pointer",
    plotWindows: [], focusedWindowId: null, autoSeriesStyles: false, history: [], future: [],
  });
});

const button = (name: string) => screen.getByRole("button", { name });
const backdrop = () => document.querySelector(".qz-overlay-backdrop") as HTMLElement;
const question = () => screen.queryByRole("group", { name: "Discard your changes?" });
const isOpen = () => useFigureDialog.getState().open !== null;

describe.each([axis, plotDetails, legend])("$name: Apply, OK and Cancel", (d) => {
  it("Apply writes the store and keeps the popup open", async () => {
    const was = d.read();
    await d.open();
    d.edit("3");
    expect(d.read()).toEqual(was); // a draft until Apply
    fireEvent.click(button("Apply"));
    expect(d.read()).toEqual(d.stored("3"));
    expect(isOpen()).toBe(true);
    expect(screen.getByRole("dialog", { name: d.dialog })).toBeInTheDocument();
  });

  it.each(["Cancel", "Esc"])("Apply, edit again, then %s: the applied edit stays, the later one is dropped", async (how) => {
    await d.open();
    d.edit("3");
    fireEvent.click(button("Apply"));
    d.edit("5");
    if (how === "Cancel") fireEvent.click(button("Cancel"));
    else act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    expect(isOpen()).toBe(false);
    expect(d.read()).toEqual(d.stored("3"));
  });

  it("two Applies then OK is ONE undo step; redo brings the session back", async () => {
    const was = d.read();
    await d.open();
    d.edit("3");
    fireEvent.click(button("Apply"));
    d.edit("5");
    fireEvent.click(button("Apply"));
    fireEvent.click(button("OK"));
    expect(isOpen()).toBe(false);
    expect(d.read()).toEqual(d.stored("5"));
    expect(st().history).toHaveLength(1);
    act(() => st().undo());
    expect(d.read()).toEqual(was);
    expect(st().history).toHaveLength(0);
    act(() => st().redo());
    expect(d.read()).toEqual(d.stored("5"));
  });

  it("OK without a prior Apply applies and closes in one step", async () => {
    await d.open();
    d.edit("4");
    fireEvent.click(button("OK"));
    expect(isOpen()).toBe(false);
    expect(d.read()).toEqual(d.stored("4"));
    expect(st().history).toHaveLength(1);
  });

  it("Cancel with no edits adds no history entry", async () => {
    const was = d.read();
    await d.open();
    fireEvent.click(button("Cancel"));
    expect(isOpen()).toBe(false);
    expect(st().history).toHaveLength(0);
    expect(d.read()).toEqual(was);
  });

  it("an Apply with nothing edited, then Cancel, adds no history entry", async () => {
    await d.open();
    fireEvent.click(button("Apply"));
    fireEvent.click(button("Cancel"));
    expect(st().history).toHaveLength(0);
  });

  it("an outside click after an Apply with no further edits closes without asking", async () => {
    await d.open();
    d.edit("3");
    fireEvent.click(button("Apply"));
    fireEvent.mouseDown(backdrop());
    expect(question()).toBeNull();
    expect(isOpen()).toBe(false);
    expect(d.read()).toEqual(d.stored("3"));
  });

  it("an outside click after an edit following an Apply asks; Discard keeps only the applied edit", async () => {
    await d.open();
    d.edit("3");
    fireEvent.click(button("Apply"));
    d.edit("5");
    fireEvent.mouseDown(backdrop());
    expect(question()).toBeInTheDocument();
    expect(isOpen()).toBe(true);
    fireEvent.click(button("Discard"));
    expect(isOpen()).toBe(false);
    expect(d.read()).toEqual(d.stored("3"));
    expect(st().history).toHaveLength(1);
  });
});

describe("Axis popup: limits in a session undo and redo as one step", () => {
  it("Apply From/To, Apply again, OK, then one undo restores the limits", async () => {
    useApp.setState({ xLim: null });
    await axis.open();
    fireEvent.change(screen.getByRole("textbox", { name: "X axis From" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: "X axis To" }), { target: { value: "2" } });
    fireEvent.click(button("Apply"));
    expect(st().xLim).toEqual([1, 2]);
    fireEvent.change(screen.getByRole("textbox", { name: "X axis To" }), { target: { value: "3" } });
    fireEvent.click(button("OK"));
    expect(st().xLim).toEqual([1, 3]);
    expect(st().history).toHaveLength(1);
    act(() => st().undo());
    expect(st().xLim).toBeNull();
    act(() => st().redo());
    expect(st().xLim).toEqual([1, 3]);
  });
});
