// Figures-audit #6 (Axis dialog) and #8 (plot-type gallery): the models and
// the lazily mounted dialog host.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import FigureDialogs from "./FigureDialogs";
import { buildPlotCommands } from "../../../commands/plotCommands";
import { axisDraft, axisDraftErrors, axisPatch } from "../../../lib/axisDialogModel";
import { plotTypePatch, plotTypeUnavailable } from "../../../lib/plotTypes";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { openFigureDialog, useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";

function csv(labels: string[], time: number[], rows: number[][]): Dataset {
  return { id: "d", name: "d.csv", data: { time, values: rows, labels, units: labels.map(() => ""), metadata: {} } };
}

const sweep = csv(["A", "B"], [0, 1, 2, 3], [[1, 5], [2, 6], [3, 7], [4, 8]]);
const xyz = csv(["Y", "Z"], [0, 0, 1, 1], [[0, 1], [1, 2], [0, 3], [1, 4]]);

beforeEach(() => {
  useFigureDialog.setState({ open: null });
  useApp.setState({ ...defaultPlotView(), datasets: [sweep], activeId: "d", history: [], future: [], status: "", stageTab: "plot" });
});

describe("plot-type gallery model (#8)", () => {
  it("restyles only the plotted series for the XY types", () => {
    const view = { seriesStyles: { 0: { color: "#123456", width: 3 } }, statPicks: {} };
    expect(plotTypePatch("scatter", view, [0, 1]).seriesStyles).toEqual({
      0: { color: "#123456", width: 0, marker: true, step: undefined },
      1: { width: 0, marker: true, step: undefined },
    });
    expect(plotTypePatch("area", view, [0]).seriesStyles?.[0].fill).toBe("under");
    expect(plotTypePatch("line", { seriesStyles: { 0: { fill: "under" } }, statPicks: {} }, [0]).seriesStyles?.[0].fill).toBeUndefined();
  });

  it("switches column / stacked column / box / histogram to the Stat Stage", () => {
    expect(plotTypePatch("column", { seriesStyles: {}, statPicks: {} }, [0])).toEqual({ statMode: true, statPicks: { mode: "bar", barStack: false } });
    expect(plotTypePatch("stackedColumn", { seriesStyles: {}, statPicks: {} }, [0]).statPicks).toEqual({ mode: "bar", barStack: true });
    expect(plotTypePatch("histogram", { seriesStyles: {}, statPicks: {} }, [0]).statPicks).toEqual({ mode: "histogram" });
  });

  it("offers contour only for map-shaped (XYZ) data, and says why not", () => {
    expect(plotTypeUnavailable("contour", sweep)).toMatch(/X, Y and Z/);
    expect(plotTypeUnavailable("contour", xyz)).toBeNull();
    expect(plotTypeUnavailable("line", null)).toMatch(/Select a dataset/);
  });

  it("the gallery applies a type as one undo step and closes", () => {
    openFigureDialog({ kind: "plotType" });
    render(<FigureDialogs />);
    expect(screen.getByRole("dialog", { name: "Plot type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contour / Heatmap" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Column / Bar" }));
    expect(useApp.getState().statMode).toBe(true);
    expect(useApp.getState().statPicks.mode).toBe("bar");
    expect(useApp.getState().history).toHaveLength(1);
    expect(useFigureDialog.getState().open).toBeNull();
  });
});

describe("Axis dialog model (#6)", () => {
  it("round-trips an axis' settings, and Ln is log + base e", () => {
    const view = { ...defaultPlotView(), yScale: "log" as const, yFmt: { mode: "auto" as const, digits: 2, base: "e" as const, minor: 4 } };
    const d = axisDraft(view, "y");
    expect(d.scale).toBe("ln");
    expect(d.minor).toBe("4");
    const patch = axisPatch(view, "y", { ...d, divide: "0.001", ticks: "in", from: "1", to: "100", increment: "", titleSize: "14" });
    expect(patch.yScale).toBe("log");
    expect(patch.yFmt).toEqual({ mode: "auto", digits: 2, divide: 0.001, minor: 4, ticks: "in", base: "e" });
    expect(patch.yLim).toEqual([1, 100]);
    expect(patch.axisLabelStyles?.y?.size).toBe(14);
  });

  it("validates before Apply", () => {
    const d = axisDraft(defaultPlotView(), "x");
    expect(axisDraftErrors({ ...d, scale: "log", from: "-1" }, "x").join(" ")).toMatch(/positive limits/);
    expect(axisDraftErrors({ ...d, from: "1" }, "y2").join(" ")).toMatch(/both limits/);
    expect(axisDraftErrors({ ...d, minor: "2.5" }, "x").join(" ")).toMatch(/whole number/);
    expect(axisDraftErrors(d, "x")).toEqual([]);
  });

  it("edits the Y2 axis's own scale and limits (the Stage had no control for them)", () => {
    const patch = axisPatch(defaultPlotView(), "y2", { ...axisDraft(defaultPlotView(), "y2"), scale: "log", from: "1", to: "10" });
    expect(patch).toMatchObject({ y2Scale: "log", y2Lim: [1, 10] });
  });

  it("the dialog applies one undo step; Y2 is offered only with a right-axis series", () => {
    openFigureDialog({ kind: "axis", axis: "x" });
    render(<FigureDialogs />);
    expect(screen.queryByRole("tab", { name: "Y2" })).toBeNull();
    expect(screen.getByText(/No Y2 axis yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "X axis Minor ticks" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("combobox", { name: "X axis Direction" }), { target: { value: "both" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().xFmt).toMatchObject({ minor: 3, ticks: "both" });
    expect(useApp.getState().history).toHaveLength(1);
  });
});

describe("Axis dialog — Apply with nothing edited (review finding)", () => {
  it("changes nothing: no undo step, no empty title style, Y2 still inherits", () => {
    useApp.setState({ y2Keys: [1] });
    const before = useApp.getState();
    openFigureDialog({ kind: "axis", axis: "y2" });
    render(<FigureDialogs />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().axisLabelStyles).toEqual(before.axisLabelStyles);
    expect(useApp.getState().y2Fmt).toBe(before.y2Fmt);
  });

  it("an edit that sets no title size stores no empty title style", () => {
    const patch = axisPatch(defaultPlotView(), "x", { ...axisDraft(defaultPlotView(), "x"), minor: "2" });
    expect(patch.axisLabelStyles).toEqual({});
  });
});

describe("Axis dialog — Y-axis break rows", () => {
  it("the Y tab breaks the axis in one undo step, and blanking both rows removes it", () => {
    openFigureDialog({ kind: "axis", axis: "y" });
    const { unmount } = render(<FigureDialogs />);
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Break from" }), { target: { value: "3" } });
    expect(screen.getByRole("alert")).toHaveTextContent("An axis break needs both Break from and Break to.");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Break to" }), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().yFmt.breaks).toEqual([[3, 6]]);
    expect(useApp.getState().history).toHaveLength(1);
    unmount();

    openFigureDialog({ kind: "axis", axis: "y" });
    render(<FigureDialogs />);
    expect(screen.getByRole("textbox", { name: "Y axis Break from" })).toHaveValue("3");
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Break from" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Break to" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useApp.getState().yFmt.breaks).toBeUndefined();
  });

  it("refuses a break on a log axis before Apply", () => {
    openFigureDialog({ kind: "axis", axis: "y" });
    render(<FigureDialogs />);
    fireEvent.change(screen.getByRole("combobox", { name: "Y axis Type" }), { target: { value: "log" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Break from" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Y axis Break to" }), { target: { value: "6" } });
    expect(screen.getByRole("alert")).toHaveTextContent("An axis break needs a linear scale.");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("the X tab has no Break rows and points to the X-break command instead", () => {
    openFigureDialog({ kind: "axis", axis: "x" });
    render(<FigureDialogs />);
    expect(screen.queryByRole("textbox", { name: /Break from/ })).toBeNull();
    expect(screen.getByText(/Break x-axis at gaps/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Y" }));
    expect(screen.getByRole("textbox", { name: "Y axis Break from" })).toBeInTheDocument();
  });

  it("Plot ▸ Break y-axis… opens the Axis dialog on the Y tab", () => {
    const cmd = buildPlotCommands(useApp.getState).find((c) => c.id === "break-y-axis");
    expect(cmd?.label).toBe("Break y-axis…");
    void cmd?.run();
    expect(useFigureDialog.getState().open).toEqual({ kind: "axis", axis: "y" });
  });
});
