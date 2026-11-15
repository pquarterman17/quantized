// Gap audit 2 #7 (exclude / include brushed points from the plot) and #8 (a
// curve's Color item and Plot Details entry) in the plot right-click menu.

import { describe, expect, it, vi } from "vitest";

import type { ContextMenuItem } from "../components/overlays/ContextMenu";
import { buildPlotMenu, type MenuSeries, type PlotMenuContext } from "./plotMenu";

const name = (it: ContextMenuItem) =>
  "separator" in it ? "—" : "header" in it ? `#${it.header}` : "swatches" in it ? "@swatches" : it.label;
const find = (items: ContextMenuItem[], label: string) => items.find((i) => name(i) === label) as
  | (ContextMenuItem & { run?: () => void; disabled?: boolean; submenu?: ContextMenuItem[]; checked?: boolean })
  | undefined;

function ctx(over: Partial<PlotMenuContext> = {}): PlotMenuContext {
  const fn = () => vi.fn();
  return {
    series: null, zone: "plot", hasY2: false, canHide: true,
    xScale: "linear", yScale: "linear", y2Scale: "linear",
    showGrid: true, showLegend: true, legendPos: "ne", legendStatic: false,
    setColor: fn(), setLine: fn(), setWidth: fn(), setMarker: fn(), resetStyle: fn(), toggleHidden: fn(),
    rename: fn(), toggleY2: fn(), moveSeries: fn(), canMoveSeries: vi.fn(() => true),
    setXScale: fn(), setYScale: fn(), setY2Scale: fn(), autoscaleX: fn(), autoscaleY: fn(), autoscaleY2: fn(),
    limitsX: fn(), limitsY: fn(), limitsY2: fn(), setShowGrid: fn(), setShowLegend: fn(), setLegendPos: fn(),
    setLegendStatic: fn(), resetView: fn(), copyFigure: fn(), copyImage: fn(), savePng: fn(), copyData: fn(),
    setTool: fn(), peakRange: null, fitPeakRange: fn(), addTextHere: fn(),
    ...over,
  };
}

const SERIES: MenuSeries = { channel: 2, label: "M", style: { color: "--series-3" }, hidden: false, onY2: false };

describe("plot menu: exclude / include brushed points (#7)", () => {
  it("offers Exclude for a brushed selection and runs the worksheet's exclusion", () => {
    const exclude = vi.fn();
    const items = buildPlotMenu(ctx({
      pointMask: { selected: 3, excludedSelected: 0, excluded: 0, exclude, include: vi.fn(), includeAll: vi.fn() },
    }));
    const ex = find(items, "Exclude selected points (3)");
    expect(ex?.disabled).toBeFalsy();
    ex!.run!();
    expect(exclude).toHaveBeenCalledOnce();
    expect(find(items, "Include selected points")?.disabled).toBe(true); // none of them excluded yet
    expect(find(items, "Include all points")).toBeUndefined(); // nothing excluded
  });

  it("offers Include when the selection or the dataset holds excluded points", () => {
    const include = vi.fn();
    const includeAll = vi.fn();
    const items = buildPlotMenu(ctx({
      pointMask: { selected: 2, excludedSelected: 2, excluded: 5, exclude: vi.fn(), include, includeAll },
    }));
    expect(find(items, "Exclude selected points (2)")?.disabled).toBe(true); // all already excluded
    find(items, "Include selected points")!.run!();
    find(items, "Include all points (5)")!.run!();
    expect(include).toHaveBeenCalledOnce();
    expect(includeAll).toHaveBeenCalledOnce();
  });

  it("shows nothing about points with no selection and no exclusions", () => {
    const items = buildPlotMenu(ctx({
      pointMask: { selected: 0, excludedSelected: 0, excluded: 0, exclude: vi.fn(), include: vi.fn(), includeAll: vi.fn() },
    }));
    expect(items.map(name).some((l) => /points/.test(l))).toBe(false);
  });
});

describe("plot menu: a curve's Color item and Plot Details (#8)", () => {
  it("has a named Color submenu (checked on the current colour) with a Custom… entry", () => {
    const setColor = vi.fn();
    const openDetails = vi.fn();
    const items = buildPlotMenu(ctx({ series: SERIES, setColor, openDetails }));
    const color = find(items, "Color");
    expect(color?.submenu).toBeDefined();
    const sub = color!.submenu!;
    expect(find(sub, "Series 3")?.checked).toBe(true);
    find(sub, "Black")!.run!();
    expect(setColor).toHaveBeenCalledWith(2, "#000000");
    find(sub, "Custom…")!.run!();
    expect(openDetails).toHaveBeenCalledWith(2);
  });

  it("offers Plot Details… for the curve", () => {
    const openDetails = vi.fn();
    const items = buildPlotMenu(ctx({ series: SERIES, openDetails }));
    find(items, "Plot Details…")!.run!();
    expect(openDetails).toHaveBeenCalledWith(2);
  });
});
