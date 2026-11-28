// Acceptance 10 W1, W2, W4 and C1, through the real entry point: a double-click
// in the axis band (AxisDropZones -> openFigureDialog), the fields, Apply, the
// store, then undo and redo through the store's own actions.
//   W1: each axis tab keeps its own draft; Apply commits every edited axis as
//       ONE undo step; Apply with nothing edited changes nothing.
//   W2: an Apply that also moves the X / Y limits undoes and redoes in ONE step.
//   W4: a Y2 scale pick no longer freezes Y2's tick format as a copy of Y's.
//   C1: the "Discard your changes?" bar sits below the scrolling fields.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FigureDialogs from "./FigureDialogs";
import AxisDropZones from "../../Stage/AxisDropZones";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";

type Ax = "x" | "y" | "y2";

const ds: Dataset = {
  id: "d",
  name: "d.csv",
  data: { time: [0, 1, 2], values: [[1, 4], [2, 5], [3, 6]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};

const rect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => "" }) as DOMRect;

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
const typeIn = (axis: Ax, label: string, value: string) => fireEvent.change(field(axis, label), { target: { value } });
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const apply = () => fireEvent.click(screen.getByRole("button", { name: "OK" })); // OK = apply and close
const pickType = (axis: Ax, value: string) => fireEvent.change(screen.getByRole("combobox", { name: `${NAME[axis]} Type` }), { target: { value } });
const app = () => useApp.getState();

beforeEach(() => {
  vi.restoreAllMocks();
  useFigureDialog.setState({ open: null });
  useApp.setState({
    ...defaultPlotView(), datasets: [ds], activeId: "d", y2Keys: [1], history: [], future: [], viewHistory: [], viewFuture: [],
    status: "", stageTab: "plot", xAxisLabel: "X0", yAxisLabel: "Y0", y2AxisLabel: "Y20",
  });
});

describe("W1: one draft per axis tab", () => {
  it("keeps the X title while the Y tab is open, and Apply commits all three as one undo step", async () => {
    renderStage();
    await openAxis("x");
    typeIn("x", "title", "Temperature");
    tab("Y");
    typeIn("y", "title", "Moment");
    tab("X");
    expect((field("x", "title") as HTMLInputElement).value).toBe("Temperature");
    tab("Y2");
    typeIn("y2", "title", "Second");
    apply();
    expect([app().xAxisLabel, app().yAxisLabel, app().y2AxisLabel]).toEqual(["Temperature", "Moment", "Second"]);
    expect(app().history).toHaveLength(1);
    app().undo();
    expect([app().xAxisLabel, app().yAxisLabel, app().y2AxisLabel]).toEqual(["X0", "Y0", "Y20"]);
  });

  it("an Apply after only looking at the tabs changes nothing", async () => {
    renderStage();
    await openAxis("y");
    tab("X");
    tab("Y2");
    tab("Y");
    apply();
    expect(app().history).toHaveLength(0);
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("an invalid draft on another tab blocks Apply and names the axis", async () => {
    renderStage();
    await openAxis("x");
    typeIn("x", "From", "abc");
    tab("Y");
    expect(screen.getByRole("alert").textContent).toContain("X axis: From must be a number");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });
});

describe("W2: an Apply that moves the limits is one undo step", () => {
  it("undo restores the title AND the limits, redo puts both back", async () => {
    renderStage();
    await openAxis("y");
    typeIn("y", "title", "Moment");
    typeIn("y", "From", "19");
    typeIn("y", "To", "30");
    apply();
    expect(app().yAxisLabel).toBe("Moment");
    expect(app().yLim).toEqual([19, 30]);
    expect(app().history).toHaveLength(1);
    app().undo();
    expect(app().yAxisLabel).toBe("Y0");
    expect(app().yLim).toBeNull();
    app().redo();
    expect(app().yAxisLabel).toBe("Moment");
    expect(app().yLim).toEqual([19, 30]);
    app().undo();
    expect(app().yLim).toBeNull();
    expect(app().yAxisLabel).toBe("Y0");
  });

  it("a zoom made after the Apply is not thrown away by undo", async () => {
    renderStage();
    await openAxis("x");
    typeIn("x", "title", "Field");
    typeIn("x", "From", "0");
    typeIn("x", "To", "2");
    apply();
    app().setXLim([0.5, 1.5]); // the user zooms in afterwards
    app().undo();
    expect(app().xAxisLabel).toBe("X0");
    expect(app().xLim).toEqual([0.5, 1.5]);
  });

  it("a title-only Apply leaves the live zoom alone on undo, as every other edit does", async () => {
    renderStage();
    app().setYLim([1, 2]);
    await openAxis("y");
    typeIn("y", "title", "Moment");
    apply();
    app().setYLim([1.2, 1.8]);
    app().undo();
    expect(app().yAxisLabel).toBe("Y0");
    expect(app().yLim).toEqual([1.2, 1.8]);
  });
});

describe("W4: a Y2 scale pick does not freeze the tick format", () => {
  it.each(["linear", "log", "reciprocal"])("%s leaves Y2 following Y's format", async (v) => {
    renderStage();
    await openAxis("y2");
    pickType("y2", v);
    apply();
    expect(app().y2Scale).toBe(v);
    expect(app().y2Fmt).toBeNull();
  });

  it("Same as Y again, after a Linear pick, leaves no frozen format", async () => {
    app().setYFmt({ mode: "sci", digits: 1 });
    useApp.setState({ history: [] });
    renderStage();
    await openAxis("y2");
    pickType("y2", "linear");
    pickType("y2", "same");
    apply();
    expect(app().y2Scale).toBeNull();
    expect(app().y2Fmt).toBeNull();
  });

  it("a scale that lives on the format (ln) gives Y2 a format of its own; Same as Y gives it back", async () => {
    renderStage();
    await openAxis("y2");
    pickType("y2", "ln");
    expect(screen.getByRole("checkbox", { name: "Y2 (right) axis Same format as Y" })).not.toBeChecked();
    pickType("y2", "same");
    expect(screen.getByRole("checkbox", { name: "Y2 (right) axis Same format as Y" })).toBeChecked();
    apply();
    expect(app().y2Scale).toBeNull();
    expect(app().y2Fmt).toBeNull();
  });

  it("a real tick-format edit still unticks Same format as Y", async () => {
    renderStage();
    await openAxis("y2");
    fireEvent.change(screen.getByRole("textbox", { name: "Y2 (right) axis Digits" }), { target: { value: "5" } });
    expect(screen.getByRole("checkbox", { name: "Y2 (right) axis Same format as Y" })).not.toBeChecked();
    apply();
    expect(app().y2Fmt).not.toBeNull();
  });
});

describe("C1: the discard bar does not cover the fields", () => {
  it("asks below the scrolling body, not over it", async () => {
    renderStage();
    await openAxis("y");
    typeIn("y", "title", "Moment");
    fireEvent.mouseDown(document.querySelector(".qz-overlay-backdrop")!);
    const bar = screen.getByRole("group", { name: "Discard your changes?" });
    const body = screen.getByTestId("figure-dialog-body");
    expect(body.contains(bar)).toBe(false);
    expect(body.contains(field("y", "Digits"))).toBe(true);
    expect(getComputedStyle(bar).position).not.toBe("sticky");
    expect(getComputedStyle(bar.parentElement!).overflow).toBe("hidden");
    expect(getComputedStyle(body).overflowY).toBe("auto");
  });
});
