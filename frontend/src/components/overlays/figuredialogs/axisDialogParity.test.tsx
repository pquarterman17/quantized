// Plan item 50 (OG23, E3/E9): the Axis dialog holds every per-axis control the
// right panel had -- title text, scale (Y2's "Same as Y" included), limits,
// reverse, tick format (X date / clock modes included) and Y2 following Y's
// tick format. Every test goes in through the real entry point: a double-click
// in the axis band (AxisDropZones -> axisAtPoint -> openFigureDialog), then
// the field, then Apply, then the store.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FigureDialogs from "./FigureDialogs";
import AxisDropZones from "../../Stage/AxisDropZones";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";

type Ax = "x" | "y" | "y2";

const mk = (metadata: Record<string, unknown> = {}): Dataset => ({
  id: "d",
  name: "d.csv",
  data: { time: [0, 1, 2], values: [[1, 4], [2, 5], [3, 6]], labels: ["A", "B"], units: ["", ""], metadata },
});

const rect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => "" }) as DOMRect;

/** The Stage with a fake uPlot (jsdom has no layout): chart box 0..400 x 0..300, plot area 50..350 x 10..250. */
function renderStage() {
  render(
    <>
      <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={() => {}}>
        <div className="uplot" data-testid="chart">
          <div className="u-over" data-testid="over" />
        </div>
      </AxisDropZones>
      <FigureDialogs />
    </>,
  );
  vi.spyOn(screen.getByTestId("chart"), "getBoundingClientRect").mockReturnValue(rect(0, 0, 400, 300));
  vi.spyOn(screen.getByTestId("over"), "getBoundingClientRect").mockReturnValue(rect(50, 10, 350, 250));
}

const POINT = { x: { clientX: 200, clientY: 280 }, y: { clientX: 20, clientY: 100 }, y2: { clientX: 380, clientY: 100 } } as const;
const NAME: Record<Ax, string> = { x: "X axis", y: "Y axis", y2: "Y2 (right) axis" };

async function openAxis(axis: Ax) {
  fireEvent.doubleClick(screen.getByTestId("chart"), POINT[axis]);
  await screen.findByRole("textbox", { name: `${NAME[axis]} title` });
}

const field = (axis: Ax, label: string) => screen.getByRole("textbox", { name: `${NAME[axis]} ${label}` });
const combo = (axis: Ax, label: string) => screen.getByRole("combobox", { name: `${NAME[axis]} ${label}` });
const optionValues = (el: HTMLElement) => [...el.querySelectorAll("option")].map((o) => o.value);
const apply = () => fireEvent.click(screen.getByRole("button", { name: "Apply" }));
const cancel = () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

beforeEach(() => {
  vi.restoreAllMocks();
  useFigureDialog.setState({ open: null });
  useApp.setState({ ...defaultPlotView(), datasets: [mk()], activeId: "d", y2Keys: [1], history: [], future: [], status: "", stageTab: "plot" });
});

describe("Axis popup: the axis title", () => {
  it.each(["x", "y", "y2"] as const)("typing the %s title and pressing Apply changes only that axis, as one undo step", async (axis) => {
    useApp.setState({ xAxisLabel: "X0", yAxisLabel: "Y0", y2AxisLabel: "Y20" });
    renderStage();
    await openAxis(axis);
    fireEvent.change(field(axis, "title"), { target: { value: "New $T_{c}$" } });
    expect(useApp.getState().history).toHaveLength(0); // a draft until Apply
    expect(useApp.getState()[`${axis}AxisLabel` as const]).not.toBe("New $T_{c}$");
    apply();
    const s = useApp.getState();
    const want: Record<Ax, string> = { x: "X0", y: "Y0", y2: "Y20" };
    want[axis] = "New $T_{c}$";
    expect([s.xAxisLabel, s.yAxisLabel, s.y2AxisLabel]).toEqual([want.x, want.y, want.y2]);
    expect(s.history).toHaveLength(1);
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("shows the stored title, and Apply with nothing edited changes nothing", async () => {
    useApp.setState({ xAxisLabel: "Field (T)" });
    renderStage();
    await openAxis("x");
    expect(field("x", "title")).toHaveValue("Field (T)");
    apply();
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().xAxisLabel).toBe("Field (T)");
  });

  it("clearing the title restores the auto label", async () => {
    useApp.setState({ yAxisLabel: "Moment" });
    renderStage();
    await openAxis("y");
    fireEvent.change(field("y", "title"), { target: { value: "" } });
    apply();
    expect(useApp.getState().yAxisLabel).toBe("");
  });

  it("Cancel leaves the title unchanged", async () => {
    useApp.setState({ xAxisLabel: "keep" });
    renderStage();
    await openAxis("x");
    fireEvent.change(field("x", "title"), { target: { value: "lost" } });
    cancel();
    expect(useApp.getState().xAxisLabel).toBe("keep");
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("Esc leaves the title unchanged", async () => {
    useApp.setState({ xAxisLabel: "keep" });
    renderStage();
    await openAxis("x");
    fireEvent.change(field("x", "title"), { target: { value: "lost" } });
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    await waitFor(() => expect(useFigureDialog.getState().open).toBeNull());
    expect(useApp.getState().xAxisLabel).toBe("keep");
    expect(useApp.getState().history).toHaveLength(0);
  });
});

describe("Axis popup: the panel's scale, limits, reverse and tick format", () => {
  it("X: scale, half-open limits, reverse, tick mode and digits", async () => {
    renderStage();
    await openAxis("x");
    fireEvent.change(combo("x", "Type"), { target: { value: "log" } });
    fireEvent.change(field("x", "From"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "X axis Reverse" }));
    fireEvent.change(combo("x", "Number format"), { target: { value: "sci" } });
    fireEvent.change(field("x", "Digits"), { target: { value: "3" } });
    apply();
    const s = useApp.getState();
    expect([s.xScale, s.xLim, s.xReversed]).toEqual(["log", [1, null], true]);
    expect(s.xFmt).toMatchObject({ mode: "sci", digits: 3 });
    expect(s.history).toHaveLength(1);
  });

  it("Y: scale, limits, tick mode and digits; Cancel changes nothing", async () => {
    renderStage();
    await openAxis("y");
    fireEvent.change(combo("y", "Type"), { target: { value: "reciprocal" } });
    fireEvent.change(field("y", "From"), { target: { value: "2" } });
    cancel();
    expect(useApp.getState().yLim).toBeNull();
    expect(useApp.getState().yScale).toBe("linear");
    expect(useApp.getState().history).toHaveLength(0);
    await openAxis("y");
    fireEvent.change(combo("y", "Type"), { target: { value: "reciprocal" } });
    fireEvent.change(field("y", "From"), { target: { value: "2" } });
    fireEvent.change(field("y", "To"), { target: { value: "8" } });
    fireEvent.change(combo("y", "Number format"), { target: { value: "eng" } });
    apply();
    const s = useApp.getState();
    expect([s.yScale, s.yLim]).toEqual(["reciprocal", [2, 8]]);
    expect(s.yFmt.mode).toBe("eng");
  });

  it("Y2: its own scale and limits (Y2 takes both limits or neither)", async () => {
    renderStage();
    await openAxis("y2");
    fireEvent.change(combo("y2", "Type"), { target: { value: "log" } });
    fireEvent.change(field("y2", "From"), { target: { value: "1" } });
    expect(screen.getByRole("alert")).toHaveTextContent("both limits or neither");
    fireEvent.change(field("y2", "To"), { target: { value: "100" } });
    apply();
    expect([useApp.getState().y2Scale, useApp.getState().y2Lim]).toEqual(["log", [1, 100]]);
  });

  it("Y2 'Same as Y' scale: written as no scale of its own, and kept by a later edit", async () => {
    useApp.setState({ y2Scale: "log" });
    renderStage();
    await openAxis("y2");
    expect(combo("y2", "Type")).toHaveValue("log");
    fireEvent.change(combo("y2", "Type"), { target: { value: "same" } });
    apply();
    expect(useApp.getState().y2Scale).toBeNull();
    await openAxis("y2");
    expect(combo("y2", "Type")).toHaveValue("same");
    fireEvent.change(field("y2", "title"), { target: { value: "Right" } });
    apply();
    expect(useApp.getState().y2Scale).toBeNull();
    expect(useApp.getState().y2AxisLabel).toBe("Right");
  });

  it("Y2 'Same format as Y': ticking writes no format of its own; editing a tick field drops it", async () => {
    useApp.setState({ yFmt: { mode: "sci", digits: 4 }, y2Fmt: { mode: "fixed", digits: 1 } });
    renderStage();
    await openAxis("y2");
    const box = () => screen.getByRole("checkbox", { name: "Y2 (right) axis Same format as Y" });
    expect(box()).not.toBeChecked();
    fireEvent.click(box());
    expect(combo("y2", "Number format")).toHaveValue("sci"); // reset to Y's
    apply();
    expect(useApp.getState().y2Fmt).toBeNull();
    await openAxis("y2");
    expect(box()).toBeChecked();
    fireEvent.change(combo("y2", "Number format"), { target: { value: "eng" } });
    expect(box()).not.toBeChecked();
    apply();
    expect(useApp.getState().y2Fmt).toMatchObject({ mode: "eng" });
  });

  it("X date / clock tick modes appear only for a timestamp / time-of-day X column", async () => {
    renderStage();
    await openAxis("x");
    expect(optionValues(combo("x", "Number format"))).toEqual(["auto", "fixed", "sci", "eng"]);
    cancel();

    useApp.setState({ datasets: [mk({ time_is_datetime: true, time_is_clock: true })] });
    await openAxis("x");
    expect(optionValues(combo("x", "Number format"))).toEqual(["auto", "fixed", "sci", "eng", "clock", "date", "time", "datetime"]);
    fireEvent.change(combo("x", "Number format"), { target: { value: "datetime" } });
    apply();
    expect(useApp.getState().xFmt.mode).toBe("datetime");
    // Never stranded: a saved date mode stays switchable back on a plain column.
    useApp.setState({ datasets: [mk()] });
    await openAxis("x");
    expect(optionValues(combo("x", "Number format"))).toContain("datetime");
  });
});
