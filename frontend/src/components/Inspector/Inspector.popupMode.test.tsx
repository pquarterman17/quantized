// Plan item 50 (OG23, E1/E2/E4/E9): with `objectEditorMode` at "popup" the right
// panel stops offering a second copy of an axis, a curve or the legend. It names
// the selection and shows one Edit… button; the Axes card keeps its plot-wide
// settings and gains launchers; Titles & labels keeps the plot title; the
// Series style card is not mounted. The panel-mode twin of every claim here is
// pinned by the existing Inspector / TitlesCard tests, which mock "panel".

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import FigureDialogs from "../overlays/figuredialogs/FigureDialogs";
import AxisDropZones from "../Stage/AxisDropZones";
import { defaultPlotView } from "../../lib/plotview";
import type { DataStruct } from "../../lib/types";
import { INSPECTOR_CARDS_KEY, useInspectorCards } from "../../store/inspectorCards";
import { useFigureDialog, type FigureDialog } from "../../store/figureDialogs";
import { usePlotSelection, type PlotSelection } from "../../store/plotSelection";
import { useApp } from "../../store/useApp";
import AxesCard from "./AxesCard";
import Inspector from "./Inspector";
import TitlesCard from "./TitlesCard";

const data: DataStruct = {
  time: [1, 2, 3],
  values: [[10, 1], [20, 2], [30, 3]],
  labels: ["Moment", "Field"],
  units: ["emu", "Oe"],
  metadata: { sample: "A" },
};
const st = () => useApp.getState();

beforeEach(() => {
  localStorage.removeItem(INSPECTOR_CARDS_KEY);
  useInspectorCards.setState({ open: {} });
  usePlotSelection.setState({ sel: null, onCanvas: true });
  useFigureDialog.setState({ open: null });
  useApp.setState({
    ...defaultPlotView(),
    datasets: [{ id: "d1", name: "sample", data }],
    activeId: "d1",
    folders: [],
    stageTab: "plot",
    yKeys: [0, 1],
    y2Keys: [],
    yAxes: [],
    showLegend: true,
    annotations: [{ id: "a1", x: 1, y: 1, text: "peak" }] as never,
    shapes: [],
    selectedAnnotationId: null,
    selectedShapeId: null,
    history: [],
    future: [],
  });
});

const select = (sel: PlotSelection | null) => act(() => usePlotSelection.setState({ sel }));
const card = (title: string) => document.querySelector<HTMLDetailsElement>(`.qzk-inspector details.qz-card[data-card-id="${title}"]`);
const selectionSection = () => screen.getByRole("region", { name: "Selection" });
const edit = () => within(selectionSection()).getByRole("button", { name: "Edit…" });

describe("Selection section: name plus Edit…", () => {
  const cases: [string, PlotSelection, string, FigureDialog][] = [
    ["a curve", { kind: "series", channel: 1 }, "Curve: Field", { kind: "plotDetails", channel: 1 }],
    ["the X axis", { kind: "axis", axis: "x" }, "X axis", { kind: "axis", axis: "x" }],
    ["the Y axis", { kind: "axis", axis: "y" }, "Y axis", { kind: "axis", axis: "y" }],
    ["the Y2 axis", { kind: "axis", axis: "y2" }, "Y2 (right) axis", { kind: "axis", axis: "y2" }],
    ["the legend", { kind: "legend" }, "Legend", { kind: "legend" }],
  ];
  it.each(cases)("%s: names it and Edit… opens its popup", (_n, sel, name, dialog) => {
    render(<Inspector />);
    select(sel);
    expect(selectionSection()).toHaveTextContent(name);
    fireEvent.click(edit());
    expect(useFigureDialog.getState().open).toEqual(dialog);
  });

  it("shows no editable field for an axis, a curve or the legend", () => {
    useApp.setState({ y2Keys: [1] });
    render(<Inspector />);
    for (const sel of [{ kind: "axis", axis: "x" }, { kind: "axis", axis: "y2" }, { kind: "series", channel: 0 }, { kind: "legend" }] as PlotSelection[]) {
      select(sel);
      const section = selectionSection();
      expect(within(section).queryByRole("textbox")).toBeNull();
      expect(within(section).queryByRole("combobox", { name: /^Selected / })).toBeNull();
      expect(within(section).queryByRole("checkbox")).toBeNull();
      expect(within(section).queryByLabelText("Legend position")).toBeNull();
    }
    expect(screen.queryByLabelText(/Selected [XY]2? axis/)).toBeNull();
  });

  it("hoists no card for a curve or an axis, and the Series style card is not mounted", () => {
    render(<Inspector />);
    expect(card("Series style")).toBeNull();
    select({ kind: "series", channel: 1 });
    expect(card("Series style")).toBeNull();
    expect(card("Axes")?.open).toBe(false);
    select({ kind: "axis", axis: "y" });
    expect(card("Axes")?.open).toBe(false);
    expect(document.querySelector(".qzk-inspector details.qz-card")?.getAttribute("data-card-id")).not.toBe("Axes");
  });

  it("an annotation still hoists its own card and has no Edit… (no popup twin)", () => {
    render(<Inspector />);
    act(() => useApp.setState({ selectedAnnotationId: "a1" }));
    expect(document.querySelector(".qzk-inspector details.qz-card")?.getAttribute("data-card-id")).toBe("Annotations");
    expect(within(selectionSection()).queryByRole("button", { name: "Edit…" })).toBeNull();
  });

  it("nothing selected: no Edit…, and the hint points at the popup", () => {
    render(<Inspector />);
    expect(within(selectionSection()).queryByRole("button", { name: "Edit…" })).toBeNull();
    expect(selectionSection()).toHaveTextContent("then Edit…");
  });
});

describe("Axes card: plot-wide settings stay, per-axis controls become launchers", () => {
  it("hides the per-axis controls", () => {
    render(<AxesCard />);
    expect(screen.queryByLabelText(/scale/i)).toBeNull();
    expect(screen.queryByLabelText(/axis minimum/)).toBeNull();
    expect(screen.queryByLabelText(/axis maximum/)).toBeNull();
    expect(screen.queryByLabelText("Reverse X")).toBeNull();
    expect(screen.queryByLabelText("X date/time format")).toBeNull();
    expect(screen.queryByLabelText("Legend position")).toBeNull();
  });

  it("keeps grid lines, the axis box, the template and the legend toggle working", () => {
    render(<AxesCard />);
    const grid = st().showGrid;
    fireEvent.click(screen.getByLabelText("Grid lines"));
    expect(st().showGrid).toBe(!grid);
    const box = st().showAxisBox;
    fireEvent.click(screen.getByLabelText("Axis box (frame)"));
    expect(st().showAxisBox).toBe(!box);
    expect(screen.getByLabelText("Plot template")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Legend"));
    expect(st().showLegend).toBe(false);
    expect(screen.queryByLabelText("Legend position")).toBeNull();
  });

  it("X axis… and Y axis… open their popups; Y2 and Y3+ only when drawn", () => {
    render(<AxesCard />);
    expect(screen.queryByRole("button", { name: "Y2 axis…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Y3+ axes…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "X axis…" }));
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "x" });
    fireEvent.click(screen.getByRole("button", { name: "Y axis…" }));
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y" });
  });

  it("Y2 axis… appears with a Y2 curve and opens the Y2 popup", () => {
    useApp.setState({ y2Keys: [1] });
    render(<AxesCard />);
    fireEvent.click(screen.getByRole("button", { name: "Y2 axis…" }));
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y2" });
  });

  it("one launcher reaches the Y3+ axes' existing popup", async () => {
    useApp.setState({ yAxes: [{ label: "", scale: null, lim: null, step: null, fmt: null, color: null }] as never });
    render(<AxesCard />);
    fireEvent.click(screen.getByRole("button", { name: "Y3+ axes…" }));
    // editExtraYAxes asks through the shared parameter dialog.
    const { useParamDialog } = await import("../../store/paramDialog");
    await waitFor(() => expect(useParamDialog.getState().title).toBe("Y3 Axis"));
    useParamDialog.getState().resolve?.(null); // cancel
    act(() => useParamDialog.getState().close());
  });
});

describe("Titles & labels card", () => {
  it("keeps the plot title and drops the axis titles (they are in the Axis popup)", () => {
    useApp.setState({ y2Keys: [1] });
    render(<TitlesCard />);
    expect(screen.getByRole("textbox", { name: "Plot title" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Plot X label" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Plot Y label" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Plot Y2 label" })).toBeNull();
  });
});

describe("through the real entry points", () => {
  const dialog = () => screen.findByRole("dialog");

  it("keyboard path: pick in the picker, Edit…, the popup takes focus; Apply writes the store", async () => {
    render(
      <>
        <Inspector />
        <FigureDialogs />
      </>,
    );
    fireEvent.change(screen.getByLabelText("Select plot object"), { target: { value: "axis:y" } });
    expect(usePlotSelection.getState().sel).toEqual({ kind: "axis", axis: "y" });
    fireEvent.click(edit());
    const dlg = await dialog();
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Y axis From" }), { target: { value: "2" } });
    fireEvent.change(within(dlg).getByRole("textbox", { name: "Y axis To" }), { target: { value: "9" } });
    expect(st().yLim).toBeNull(); // a draft until Apply
    fireEvent.click(within(dlg).getByRole("button", { name: "OK" }));
    expect(st().yLim).toEqual([2, 9]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a curve: Edit… opens Plot details; Apply recolours it, Cancel does not", async () => {
    render(
      <>
        <Inspector />
        <FigureDialogs />
      </>,
    );
    fireEvent.change(screen.getByLabelText("Select plot object"), { target: { value: "series:1" } });
    fireEvent.click(edit());
    let dlg = await screen.findByRole("dialog", { name: "Plot details" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Black" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(st().seriesStyles[1]?.color).toBeUndefined();
    fireEvent.click(edit());
    dlg = await screen.findByRole("dialog", { name: "Plot details" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Black" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Apply" }));
    expect(st().seriesStyles[1]?.color).toBeDefined();
  });

  it("the legend: Edit… opens the Legend popup; Apply moves the corner", async () => {
    useApp.setState({ legendPos: "ne" });
    render(
      <>
        <Inspector />
        <FigureDialogs />
      </>,
    );
    fireEvent.change(screen.getByLabelText("Select plot object"), { target: { value: "legend" } });
    fireEvent.click(edit());
    const dlg = await screen.findByRole("dialog", { name: "Legend" });
    fireEvent.change(within(dlg).getByLabelText("Legend position"), { target: { value: "sw" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Apply" }));
    expect(st().legendPos).toBe("sw");
  });

  it("the owner's report: double-clicking an axis leaves ONE editor, the popup; the panel shows its name and Edit…", async () => {
    const rect = (l: number, t: number, r: number, b: number) =>
      ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t, toJSON: () => "" }) as DOMRect;
    render(
      <>
        <Inspector />
        <AxisDropZones className="qzk-stage" onContextMenu={() => {}} onAxisDrop={() => {}}>
          <div className="uplot" data-testid="chart">
            <div className="u-over" data-testid="over" />
          </div>
        </AxisDropZones>
        <FigureDialogs />
      </>,
    );
    const chart = screen.getByTestId("chart");
    chart.getBoundingClientRect = () => rect(0, 0, 400, 300);
    screen.getByTestId("over").getBoundingClientRect = () => rect(50, 10, 350, 250);
    select({ kind: "axis", axis: "x" }); // the first click of the double-click selects the axis
    fireEvent.doubleClick(chart, { clientX: 200, clientY: 280 });
    await screen.findByRole("textbox", { name: "X axis title" });
    // The title field exists exactly once, in the popup; the panel has none.
    expect(screen.getAllByRole("textbox", { name: "X axis title" })).toHaveLength(1);
    expect(within(selectionSection()).queryByRole("textbox")).toBeNull();
    expect(within(selectionSection()).queryByRole("combobox", { name: /^Selected / })).toBeNull();
    expect(selectionSection()).toHaveTextContent("X axis");
    expect(edit()).toBeInTheDocument();
  });
});
