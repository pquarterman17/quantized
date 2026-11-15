// Worksheet user parameters: set / remove, the legend template, curve order,
// and that they survive a column insert and a .dwk save/load round trip.

import { beforeEach, describe, expect, it } from "vitest";

import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { userParamRows, userParamValue } from "../lib/userParams";
import type { Dataset } from "../lib/types";
import { applyParamLegendTemplate, orderCurvesByParam, removeUserParam, setUserParam } from "./userParamActions";
import { useApp } from "./useApp";
import { plotWindowView } from "./windowDocuments";
import { insertColumn } from "./worksheetColumns";

const sheet = (): Dataset => ({
  id: "s",
  name: "Book1",
  data: {
    time: [1, 2],
    values: [[1, 2, 3], [4, 5, 6]],
    labels: ["A", "B", "C"],
    units: ["", "", ""],
    metadata: {},
  },
});
const st = () => useApp.getState();
const ds = () => st().datasets[0];
const value = (name: string, col: number) => userParamValue(userParamRows(ds().data), name, col);

const initialWindows = useApp.getState().plotWindows;
const initialFocus = useApp.getState().focusedWindowId;

/** A plot window bound to dataset "s", focused (its view is the live store). */
function plotOfSheet(): string {
  const id = useApp.getState().createWindow("s");
  useApp.setState({ focusedWindowId: id, activeId: "s" });
  return id;
}

beforeEach(() => {
  useApp.setState({
    plotWindows: initialWindows, focusedWindowId: initialFocus,
    datasets: [sheet()], activeId: "s", history: [], future: [], status: "", seriesLabels: {}, seriesOrder: null,
    xKey: null, yKeys: null, macroRecording: false, macroSteps: [],
  });
});

describe("setUserParam / removeUserParam", () => {
  it("sets a value per column, one undo step each, and clears with a blank", () => {
    setUserParam("s", "Temperature", 0, "300 K");
    setUserParam("s", "Temperature", 2, "10 K");
    expect(value("Temperature", 0)).toBe("300 K");
    expect(value("Temperature", 1)).toBe("");
    expect(value("Temperature", 2)).toBe("10 K");
    expect(st().history).toHaveLength(2);
    setUserParam("s", "Temperature", 0, "");
    expect(value("Temperature", 0)).toBe("");
  });

  it("an unchanged value records no undo entry; X (col -1) and out-of-range columns are refused", () => {
    setUserParam("s", "T", 0, "5");
    const n = st().history.length;
    setUserParam("s", "T", 0, "5");
    setUserParam("s", "T", -1, "9");
    setUserParam("s", "T", 9, "9");
    expect(st().history).toHaveLength(n);
  });

  it("removes the parameter from every column", () => {
    setUserParam("s", "T", 0, "5");
    setUserParam("s", "T", 1, "6");
    removeUserParam("s", "T");
    expect(userParamRows(ds().data)).toEqual([]);
  });

  it("persists through a .dwk save/load and follows its column when one is inserted before it", () => {
    setUserParam("s", "Temperature", 1, "77 K");
    const loaded = parseWorkspace(serializeWorkspace({ datasets: [ds()] }));
    expect(userParamValue(userParamRows(loaded.datasets[0].data), "Temperature", 1)).toBe("77 K");

    insertColumn("s", 0); // B moves from channel 1 to 2
    expect(ds().data.labels[2]).toBe("B");
    expect(value("Temperature", 2)).toBe("77 K");
    expect(value("Temperature", 1)).toBe("");
  });
});

describe("applyParamLegendTemplate", () => {
  it("writes ordinary legend labels (undoable) and keeps a column without a value unchanged", () => {
    plotOfSheet();
    setUserParam("s", "Temperature", 0, "300");
    setUserParam("s", "Temperature", 1, "10");
    expect(applyParamLegendTemplate("s", [0, 1, 2], "{Temperature} K")).toBe(2);
    expect(st().seriesLabels).toEqual({ 0: "300 K", 1: "10 K" });
    expect(st().status).toMatch(/kept 1 unchanged/);
    st().undo();
    expect(st().seriesLabels).toEqual({});
  });

  it("writes nothing for an unknown parameter", () => {
    plotOfSheet();
    expect(applyParamLegendTemplate("s", [0], "{Nope}")).toBe(0);
    expect(st().seriesLabels).toEqual({});
    expect(st().status).toMatch(/unknown parameter/);
  });

  it("fails closed when the sheet has no plot, and never writes into another dataset's plot", () => {
    setUserParam("s", "T", 0, "5");
    // the focused/active plot shows ANOTHER dataset
    const other: Dataset = { ...sheet(), id: "o", name: "Other" };
    useApp.setState({ datasets: [ds(), other] });
    const w = useApp.getState().createWindow("o");
    useApp.setState({ focusedWindowId: w, activeId: "o" });
    expect(applyParamLegendTemplate("s", [0], "{T}")).toBe(0);
    expect(st().seriesLabels).toEqual({});
    expect(st().status).toMatch(/no plot of this sheet/);
    expect(orderCurvesByParam("s", "T", 1)).toBe(false);
    expect(st().seriesOrder).toBeNull();
  });

  it("writes a background plot window bound to the sheet, leaving the focused plot alone", () => {
    setUserParam("s", "T", 0, "5");
    const bg = st().createWindow("s");
    const other: Dataset = { ...sheet(), id: "o", name: "Other" };
    useApp.setState({ datasets: [ds(), other] });
    const fg = st().createWindow("o");
    useApp.setState({ focusedWindowId: fg, activeId: "o" });
    expect(applyParamLegendTemplate("s", [0], "T={T}")).toBe(1);
    expect(st().seriesLabels).toEqual({}); // the focused plot (dataset o) is untouched
    const win = st().plotWindows.find((w) => w.id === bg)!;
    expect(plotWindowView(win).seriesLabels).toEqual({ 0: "T=5" });
  });
});

describe("orderCurvesByParam", () => {
  it("orders the plotted curves numerically by the parameter (descending too)", () => {
    plotOfSheet();
    setUserParam("s", "T", 0, "100");
    setUserParam("s", "T", 1, "9");
    setUserParam("s", "T", 2, "50");
    expect(orderCurvesByParam("s", "T", 1)).toBe(true);
    expect(st().seriesOrder).toEqual([1, 2, 0]);
    expect(orderCurvesByParam("s", "T", -1)).toBe(true);
    expect(st().seriesOrder).toEqual([0, 2, 1]);
  });

  it("reads numbers the way the gradient's legend order does (300K, with no space)", () => {
    plotOfSheet();
    setUserParam("s", "T", 0, "300K");
    setUserParam("s", "T", 1, "10K");
    setUserParam("s", "T", 2, "50K");
    expect(orderCurvesByParam("s", "T", 1)).toBe(true);
    expect(st().seriesOrder).toEqual([1, 2, 0]);
  });

  it("ordering a subset keeps the other curves in their positions", () => {
    plotOfSheet();
    setUserParam("s", "T", 0, "1");
    setUserParam("s", "T", 1, "2");
    setUserParam("s", "T", 2, "30");
    setUserParam("s", "T", 3, "20");
    st().setYKeys([0, 1, 2, 3]);
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, data: { ...d.data, labels: [...d.data.labels, "D"], units: [...d.data.units, ""], values: d.data.values.map((r) => [...r, 7]) } })) }));
    setUserParam("s", "T", 3, "20");
    expect(orderCurvesByParam("s", "T", 1, [2, 3])).toBe(true);
    expect(st().seriesOrder).toEqual([0, 1, 3, 2]); // 0 and 1 did not move
  });

  it("refuses when no plotted column has a numeric value (order untouched)", () => {
    plotOfSheet();
    setUserParam("s", "Sample", 0, "alpha");
    expect(orderCurvesByParam("s", "Sample", 1)).toBe(false);
    expect(st().seriesOrder).toBeNull();
  });
});
