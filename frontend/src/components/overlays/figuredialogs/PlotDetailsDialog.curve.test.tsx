// Plan item 50 / OG23 (contract E7, E9): Plot details is the WHOLE curve
// editor. Every test enters the way the user does: a double-click on a curve
// on the Stage (`usePlotStageActions` -> `plotDoubleClick` -> the dialog host),
// changes a field in a tab, and presses Apply; then asserts the store. The
// assertions of the Series style card's tests are re-homed here (the card's
// own tests stay, lane D hides the card behind the switch).

import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type uPlot from "uplot";

import { usePlotStageActions } from "../../Stage/usePlotStageActions";
import { buildExportStyles } from "../../../lib/exportStyles";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import FigureDialogs from "./FigureDialogs";

const DS: Dataset = {
  id: "d1",
  name: "ds",
  data: {
    time: [0, 1, 2],
    values: [[1, 0.1, 5, 7], [2, 0.1, 6, 8], [3, 0.1, 7, 9]],
    labels: ["Y", "Y err", "Other", "Third"],
    units: ["", "", "", ""],
    metadata: { error_channels: { 0: 1 } },
  },
};

function fakePlot(over: HTMLElement): uPlot {
  return {
    over,
    data: [[0, 100, 200, 300], [10, 20, 150, 40], [10, 20, 300, 40]],
    series: [{}, { scale: "y" }, { scale: "y" }],
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

let over: HTMLDivElement;
beforeEach(() => {
  over = document.createElement("div");
  over.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400 }) as DOMRect;
  document.body.appendChild(over);
  useFigureDialog.setState({ open: null });
  useApp.setState({
    ...defaultPlotView(), datasets: [DS], activeId: "d1", errKeys: {}, seriesStyles: {}, history: [], future: [],
    plotWindows: [], focusedWindowId: null, autoSeriesStyles: false,
  });
});
afterEach(() => over.remove());

/** Double-click the curve for `channel` on the Stage and mount the dialog host. */
async function openByDoubleClick(channel: number) {
  renderHook(() => usePlotStageActions({ current: fakePlot(over) }, null, null, undefined, [channel, 9]));
  over.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 300, clientY: 250 }));
  await waitFor(() => expect(useFigureDialog.getState().open).toEqual({ kind: "plotDetails", channel }));
  render(<FigureDialogs />);
  return screen.getByRole("dialog", { name: "Plot details" });
}
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const apply = () => fireEvent.click(screen.getByRole("button", { name: "OK" })); // OK = apply and close
const styles = () => useApp.getState().seriesStyles;
const dlg = () => screen.getByRole("dialog", { name: "Plot details" });
const select = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Plot details: the Line tab", () => {
  it("edits trace, colour, width, dash, gap and double line; Apply is one undo step", async () => {
    await openByDoubleClick(0);
    expect(screen.getByText("Y")).toBeInTheDocument();
    fireEvent.click(within(dlg()).getByRole("radio", { name: "Both" }));
    fireEvent.click(screen.getByRole("button", { name: "Black" }));
    fireEvent.change(screen.getByLabelText("Line width"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("radio", { name: "Dashed" }));
    fireEvent.change(screen.getByLabelText("Gap between line and symbol"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Double line separation"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("radio", { name: "Line in front of the symbols" }));
    expect(styles()[0]).toBeUndefined(); // nothing before Apply
    apply();
    expect(styles()[0]).toMatchObject({
      marker: true, color: "#000000", width: 3, line: "dashed", symbolGap: 2, doubleLine: 1.5, lineFront: true,
    });
    expect(useApp.getState().history).toHaveLength(1);
    expect(useFigureDialog.getState().open).toBeNull();
    useApp.getState().undo();
    expect(styles()[0]).toBeUndefined();
  });

  it("Scatter stores width 0 and a marker; a custom colour is stored as hex", async () => {
    await openByDoubleClick(0);
    fireEvent.click(within(dlg()).getByRole("radio", { name: "Scatter" }));
    fireEvent.change(screen.getByLabelText("Custom color"), { target: { value: "#112233" } });
    apply();
    expect(styles()[0]).toMatchObject({ width: 0, marker: true, color: "#112233" });
  });

  it("shows the DRAWN dash under the auto cycle, marked auto; picking it stores it", async () => {
    useApp.setState({ autoSeriesStyles: true, yKeys: null });
    await openByDoubleClick(1);
    expect(screen.getByText("Dashed (auto)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Dashed" }));
    apply();
    expect(styles()[1]?.line).toBe("dashed");
  });
});

describe("Plot details: cancel paths", () => {
  it("Cancel leaves the store and history untouched", async () => {
    await openByDoubleClick(0);
    fireEvent.click(screen.getByRole("button", { name: "Black" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(styles()).toEqual({});
    expect(useApp.getState().history).toHaveLength(0);
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("Esc leaves the store and history untouched", async () => {
    await openByDoubleClick(0);
    fireEvent.click(screen.getByRole("button", { name: "Black" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useFigureDialog.getState().open).toBeNull();
    expect(styles()).toEqual({});
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("Apply with nothing edited changes nothing", async () => {
    useApp.setState({ seriesStyles: { 0: { width: 2 } } });
    await openByDoubleClick(0);
    apply();
    expect(styles()).toEqual({ 0: { width: 2 } });
    expect(useApp.getState().history).toHaveLength(0);
    expect(useFigureDialog.getState().open).toBeNull();
  });

  it("Reset style clears the curve's style on Apply, in one undo step", async () => {
    useApp.setState({ seriesStyles: { 0: { width: 2, color: "#ff0000" }, 1: { width: 4 } } });
    await openByDoubleClick(0);
    fireEvent.click(screen.getByRole("button", { name: "Reset style" }));
    expect(styles()[0]).toEqual({ width: 2, color: "#ff0000" }); // draft only
    apply();
    expect(styles()).toEqual({ 1: { width: 4 } });
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(styles()[0]).toEqual({ width: 2, color: "#ff0000" });
  });
});

describe("Plot details: the Symbol tab", () => {
  it("edits symbols, fill, edge, opacity, every-N and the text symbol", async () => {
    await openByDoubleClick(0);
    tab("Symbol");
    expect(screen.getByLabelText("Symbol shape")).toBeDisabled();
    fireEvent.click(screen.getByText("Show symbols"));
    select("Symbol shape", "square");
    fireEvent.change(screen.getByLabelText("Symbol size"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("radio", { name: "Open symbol" }));
    fireEvent.change(screen.getByLabelText("Symbol edge color"), { target: { value: "#ff0000" } });
    fireEvent.change(screen.getByLabelText("Symbol fill opacity"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Symbol every N points"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Text symbol"), { target: { value: "x" } });
    select("Text symbol source", "rows");
    apply();
    expect(styles()[0]).toMatchObject({
      marker: true, markerShape: "square", markerSize: 8, markerFill: "hollow", markerEdge: "#ff0000",
      markerAlpha: 0.5, markerEvery: 3, markerText: "x", markerTextFrom: "rows",
    });
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("shows the cycled glyph marked auto, and picking it stores it", async () => {
    useApp.setState({ autoSeriesStyles: true, seriesStyles: { 1: { marker: true } } });
    await openByDoubleClick(1);
    tab("Symbol");
    const sel = screen.getByLabelText("Symbol shape") as HTMLSelectElement;
    expect(sel.selectedOptions[0].textContent).toMatch(/square \(auto\)/);
    select("Symbol shape", "square");
    apply();
    expect(styles()[1]?.markerShape).toBe("square");
  });
});

describe("Plot details: the Error bars tab", () => {
  it("is on when the Y error is bound only through error roles, and unticking clears both homes", async () => {
    useApp.getState().setErrorRoles("d1", [{ channel: 1, target: 0, axis: "y", side: "both" }]);
    useApp.setState({ history: [] });
    await openByDoubleClick(0);
    tab("Error bars");
    const box = screen.getByRole("checkbox", { name: "Show error bars" });
    expect(box).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Box/ })).toBeInTheDocument();
    fireEvent.click(box);
    expect(useApp.getState().datasets[0].errorRoles).toHaveLength(1); // not before Apply
    apply();
    expect(useApp.getState().datasets[0].errorRoles).toEqual([]);
    expect(useApp.getState().errKeys).toEqual({});
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().datasets[0].errorRoles).toHaveLength(1);
  });

  it("ticking binds the dataset's default error column and one undo step covers it with the look", async () => {
    await openByDoubleClick(0);
    tab("Error bars");
    fireEvent.click(screen.getByRole("checkbox", { name: "Show error bars" }));
    fireEvent.click(screen.getByRole("radio", { name: /shaded band/ }));
    fireEvent.change(screen.getByLabelText("Error bar cap size"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Error bar line width"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Error bar color"), { target: { value: "#00ff00" } });
    apply();
    expect(useApp.getState().errKeys).toEqual({ 0: 1 });
    expect(styles()[0]).toMatchObject({ errorBar: { band: true, cap: 4, width: 2, color: "#00ff00" } });
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().errKeys).toEqual({});
    expect(styles()[0]).toBeUndefined();
  });

  it("is disabled when no error column exists for the curve, but a column can still be picked (acceptance 10 U1)", async () => {
    await openByDoubleClick(2);
    tab("Error bars");
    expect(screen.getByRole("checkbox", { name: "Show error bars" })).toBeDisabled();
    const picker = screen.getByRole("combobox", { name: "Error column" }) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["± none", "± Y", "± Y err", "± Third"]); // not the curve itself
    fireEvent.change(picker, { target: { value: "3" } });
    expect(useApp.getState().errKeys).toEqual({}); // a draft until Apply
    expect(screen.getByRole("checkbox", { name: "Show error bars" })).toBeChecked();
    apply();
    expect(useApp.getState().errKeys).toEqual({ 2: 3 });
    expect(useApp.getState().datasets[0].errorRoles).toEqual([expect.objectContaining({ channel: 3, target: 2 })]);
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().errKeys).toEqual({});
  });

  it("the picker shows the bound column, switches it, and none clears it", async () => {
    await openByDoubleClick(0);
    tab("Error bars");
    const picker = () => screen.getByRole("combobox", { name: "Error column" }) as HTMLSelectElement;
    expect(picker().value).toBe(""); // nothing bound yet
    fireEvent.change(picker(), { target: { value: "1" } });
    apply();
    expect(useApp.getState().errKeys).toEqual({ 0: 1 });
    act(() => useFigureDialog.setState({ open: { kind: "plotDetails", channel: 0 } })); // reopen on the mounted host
    tab("Error bars");
    expect(picker().value).toBe("1");
    fireEvent.change(picker(), { target: { value: "" } });
    apply();
    expect(useApp.getState().errKeys).toEqual({});
  });
});

describe("Plot details: the Fill and bars tab", () => {
  it("edits fill, colour-by, row states and bars", async () => {
    await openByDoubleClick(0);
    tab("Fill and bars");
    select("Fill", "under");
    fireEvent.click(screen.getByText("Color by"));
    fireEvent.change(screen.getByTitle("Colormap"), { target: { value: "magma" } });
    fireEvent.click(screen.getByText("Use row states"));
    apply();
    expect(styles()[0]).toMatchObject({ fill: "under", colorBy: 1, colormap: "magma", rowStates: true });
  });

  it("bars clear the markers and fill, as the card does", async () => {
    useApp.setState({ seriesStyles: { 0: { marker: true, fill: "under" } } });
    await openByDoubleClick(0);
    tab("Fill and bars");
    select("Bars", "horizontal");
    apply();
    expect(styles()[0]).toMatchObject({ bars: "horizontal", marker: false });
    expect(styles()[0]?.fill).toBeUndefined();
  });

  it("a floating bar writes the series above too, still one undo step", async () => {
    useApp.setState({ seriesStyles: { 0: { marker: true }, 1: { bars: true } }, yKeys: [0, 1], autoSeriesStyles: true });
    await openByDoubleClick(1);
    tab("Fill and bars");
    fireEvent.click(screen.getByRole("checkbox", { name: /Floats from the series above/ }));
    expect(styles()[0]).toEqual({ marker: true }); // draft only
    apply();
    expect(styles()[1]).toMatchObject({ float: "high" });
    expect(styles()[0]).toMatchObject({ float: "low", bars: true, marker: false });
    expect(useApp.getState().history).toHaveLength(1);
    useApp.getState().undo();
    expect(styles()[0]).toEqual({ marker: true });
    expect(styles()[1]).toEqual({ bars: true });
  });
});

describe("Plot details: the Marks tab", () => {
  it("edits size-by, drop lines, rug and connect", async () => {
    await openByDoubleClick(0);
    tab("Marks");
    fireEvent.click(screen.getByText("Size by"));
    select("Drop lines", "x");
    select("Rug marks", "y");
    select("Line connect", "spline");
    apply();
    expect(styles()[0]).toMatchObject({ sizeBy: 1, dropLines: "x", rug: "y", connect: "spline" });
  });

  it("the stack total shows on a stacked series and reaches the export request", async () => {
    useApp.setState({ seriesStyles: { 1: { stack: true } } });
    await openByDoubleClick(1);
    tab("Marks");
    fireEvent.click(screen.getByRole("checkbox", { name: /Stack total/ }));
    apply();
    expect(styles()[1]).toMatchObject({ stack: true, stackTotal: true });
    expect(buildExportStyles([0, 1], styles())[1]).toMatchObject({ stack: true, stack_total: true });
  });
});

describe("Plot details: keyboard", () => {
  it("focus starts in the first field and the tabs are a tablist moved by the arrow keys", async () => {
    await openByDoubleClick(0);
    expect(document.activeElement).not.toBeNull();
    expect(within(screen.getByRole("tabpanel")).getAllByRole("radio")[0]).toBe(document.activeElement);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Line", "Symbol", "Error bars", "Fill and bars", "Marks"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    tabs[0].focus();
    act(() => { fireEvent.keyDown(tabs[0], { key: "ArrowRight" }); });
    expect(screen.getByRole("tab", { name: "Symbol" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Symbol" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Line" })).toHaveAttribute("tabindex", "-1");
  });
});
