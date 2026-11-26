// Item 38: the curve menu shows the right entries for a curve and none for
// what is not one.

import { beforeEach, describe, expect, it } from "vitest";

import type { ContextMenuItem } from "../overlays/contextMenuTypes";
import { useApp } from "../../store/useApp";
import { curveRebindItems } from "./curveRebindMenu";
import { buildPlotMenu, type PlotMenuContext } from "../../lib/plotMenu";
import type { Dataset } from "../../lib/types";

const sheet = (id: string, labels: string[]): Dataset => ({
  id,
  name: `S${id}`,
  data: { time: [0, 1], values: [labels.map(() => 1), labels.map(() => 2)], labels, units: labels.map(() => ""), metadata: {} },
});
const labelOf = (i: ContextMenuItem) => ("label" in i ? i.label : "");
const names = (items: ContextMenuItem[]) => items.map(labelOf);

beforeEach(() => {
  useApp.setState({
    datasets: [sheet("a", ["T", "R", "M"]), sheet("b", ["T", "R", "M"])],
    activeId: "a",
    xKey: 0,
    yKeys: [1, 2],
    seriesOrder: [],
    hiddenChannels: [],
    seriesLabels: {},
    workbooks: [],
  });
});

describe("curveRebindItems", () => {
  it("offers Change Y / X / Worksheet and Hide others for a curve", () => {
    const items = curveRebindItems(useApp.getState(), 1, [1, 2]);
    expect(names(items)).toEqual(["Change Y", "Change X", "Change Worksheet", "Hide others"]);
    const y = items[0] as { submenu: ContextMenuItem[] };
    expect(names(y.submenu)).toEqual(["T", "R", "M"]);
    expect(y.submenu.map((i) => "checked" in i && i.checked)).toEqual([false, true, false]);
    const sheets = items[2] as { submenu: ContextMenuItem[] };
    expect(names(sheets.submenu)).toEqual(["Sb"]);
  });

  it("offers Show all once a curve is hidden, and disables Hide others with no other visible curve", () => {
    useApp.setState({ hiddenChannels: [2] });
    const items = curveRebindItems(useApp.getState(), 1, [1, 2]);
    expect(names(items)).toContain("Show all");
    expect(items.find((i) => labelOf(i) === "Hide others")).toMatchObject({ disabled: true });
  });

  it("offers nothing for a channel that is not a curve", () => {
    expect(curveRebindItems(useApp.getState(), 9, [])).toEqual([]);
    useApp.setState({ activeId: null });
    expect(curveRebindItems(useApp.getState(), 1, [])).toEqual([]);
  });

  it("disables the rebind entries with the reason when a hidden curve would be dropped", () => {
    useApp.setState({ hiddenChannels: [2] });
    const y = curveRebindItems(useApp.getState(), 1, [1, 2])[0];
    expect(y).toMatchObject({ label: "Change Y", disabled: true });
    expect((y as { title?: string }).title).toMatch(/Show all curves first/);
  });

  it("disables Change Worksheet when no other sheet has the columns", () => {
    useApp.setState({ datasets: [sheet("a", ["T", "R", "M"]), sheet("c", ["Q"])] });
    const ws = curveRebindItems(useApp.getState(), 1, [1, 2]).find((i) => labelOf(i) === "Change Worksheet");
    expect(ws).toMatchObject({ disabled: true });
  });
});

describe("plot menu splice", () => {
  const ctx = (series: PlotMenuContext["series"], curveExtras?: ContextMenuItem[]) =>
    ({ series, zone: "plot", curveExtras, canMoveSeries: () => true, xScale: "linear", yScale: "linear", y2Scale: "linear", legendPos: "auto" }) as unknown as PlotMenuContext;
  const series = { channel: 1, label: "R", style: {}, hidden: false, onY2: false };

  it("puts the entries in a curve's menu and none in the empty-plot menu", () => {
    const extras = curveRebindItems(useApp.getState(), 1, [1, 2]);
    expect(names(buildPlotMenu(ctx(series, extras)))).toContain("Change Y");
    expect(names(buildPlotMenu(ctx(null)))).not.toContain("Change Y");
  });
});

describe("Change Worksheet by short name", () => {
  it("lists a sheet matched only on short names, flagged as such", () => {
    const withShort = (ds: Dataset, shorts: string[]): Dataset => ({ ...ds, data: { ...ds.data, metadata: { origin_column_names: shorts } } });
    useApp.setState({ datasets: [withShort(sheet("a", ["T", "R", "M"]), ["A", "B", "C"]), withShort(sheet("b", ["Temp", "Res", "Mom"]), ["A", "B", "C"])] });
    const sheets = curveRebindItems(useApp.getState(), 1, [1, 2]).find((i) => labelOf(i) === "Change Worksheet") as { submenu: ContextMenuItem[] };
    expect(names(sheets.submenu)).toEqual(["Sb (by short name)"]);
  });
});
