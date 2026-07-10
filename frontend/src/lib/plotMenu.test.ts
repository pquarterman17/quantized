import { describe, expect, it, vi } from "vitest";

import type { ContextMenuItem } from "../components/overlays/ContextMenu";
import { buildPlotMenu, type MenuSeries, type PlotMenuContext } from "./plotMenu";

/** A plain action/submenu label, or a symbolic marker for structural entries. */
function label(it: ContextMenuItem): string {
  if ("separator" in it) return "—";
  if ("header" in it) return `#${it.header}`;
  if ("swatches" in it) return "@swatches";
  return it.label;
}
const labels = (items: ContextMenuItem[]) => items.map(label);
function find(items: ContextMenuItem[], name: string) {
  return items.find((it) => label(it) === name);
}
function submenuOf(items: ContextMenuItem[], name: string): ContextMenuItem[] {
  const it = find(items, name);
  if (!it || !("submenu" in it)) throw new Error(`no submenu ${name}`);
  return it.submenu;
}
function swatchesOf(items: ContextMenuItem[]) {
  const it = items.find((i) => "swatches" in i);
  if (!it || !("swatches" in it)) throw new Error("no swatches");
  return it.swatches;
}

function makeCtx(over: Partial<PlotMenuContext> = {}): PlotMenuContext {
  return {
    series: null,
    zone: "plot",
    hasY2: false,
    canHide: true,
    xLog: false,
    yLog: false,
    y2Log: false,
    showGrid: true,
    showLegend: true,
    legendPos: "ne",
    setColor: vi.fn(),
    setLine: vi.fn(),
    setWidth: vi.fn(),
    setMarker: vi.fn(),
    resetStyle: vi.fn(),
    toggleHidden: vi.fn(),
    rename: vi.fn(),
    toggleY2: vi.fn(),
    setXLog: vi.fn(),
    setYLog: vi.fn(),
    setY2Log: vi.fn(),
    autoscaleX: vi.fn(),
    autoscaleY: vi.fn(),
    autoscaleY2: vi.fn(),
    limitsX: vi.fn(),
    limitsY: vi.fn(),
    limitsY2: vi.fn(),
    setShowGrid: vi.fn(),
    setShowLegend: vi.fn(),
    setLegendPos: vi.fn(),
    resetView: vi.fn(),
    copyImage: vi.fn(),
    savePng: vi.fn(),
    copyData: vi.fn(),
    setTool: vi.fn(),
    ...over,
  };
}

const series = (over: Partial<MenuSeries> = {}): MenuSeries => ({
  channel: 2,
  label: "Moment (emu)",
  style: {},
  hidden: false,
  onY2: false,
  ...over,
});

describe("buildPlotMenu — sections by cursor context", () => {
  it("no series + plot zone: axis submenus + plot section, no series header", () => {
    const items = buildPlotMenu(makeCtx());
    expect(labels(items)).not.toContain("@swatches");
    expect(find(items, "X axis")).toBeTruthy();
    expect(find(items, "Y axis")).toBeTruthy();
    expect(find(items, "Y2 axis")).toBeUndefined(); // no y2
    expect(find(items, "Legend")).toBeTruthy();
    expect(find(items, "Reset view (autoscale)")).toBeTruthy();
  });

  it("series present: header with the series label + editing entries", () => {
    const items = buildPlotMenu(makeCtx({ series: series() }));
    expect(labels(items)).toContain("#Moment (emu)");
    expect(find(items, "Line style")).toBeTruthy();
    expect(find(items, "Width")).toBeTruthy();
    expect(find(items, "Marker")).toBeTruthy();
    expect(find(items, "Hide series")).toBeTruthy();
    expect(find(items, "Rename…")).toBeTruthy();
    expect(find(items, "Move to right Y axis")).toBeTruthy();
  });

  it("gutter zones show only that axis (X below, Y2 right)", () => {
    const x = buildPlotMenu(makeCtx({ zone: "x" }));
    expect(labels(x)).toContain("#X axis");
    expect(find(x, "Y axis")).toBeUndefined();
    expect(find(x, "Log X scale")).toBeTruthy();

    const y2 = buildPlotMenu(makeCtx({ zone: "y2", hasY2: true }));
    expect(labels(y2)).toContain("#Y2 axis");
    expect(find(y2, "Autoscale Y2")).toBeTruthy();
  });

  it("plot zone with y2 offers the Y2 axis submenu", () => {
    const items = buildPlotMenu(makeCtx({ hasY2: true }));
    expect(find(items, "Y2 axis")).toBeTruthy();
  });
});

describe("buildPlotMenu — entries dispatch the ctx actions", () => {
  it("a colour swatch sets that series' colour", () => {
    const ctx = makeCtx({ series: series({ channel: 3 }) });
    const sw = swatchesOf(buildPlotMenu(ctx));
    sw[0].run(); // --series-1
    expect(ctx.setColor).toHaveBeenCalledWith(3, "--series-1");
    // black / white / grey follow the 8 palette tokens
    const black = sw.find((s) => s.title === "Black")!;
    black.run();
    expect(ctx.setColor).toHaveBeenCalledWith(3, "#000000");
  });

  it("width + line + marker submenu leaves call the right setter", () => {
    const ctx = makeCtx({ series: series({ channel: 1 }) });
    const items = buildPlotMenu(ctx);
    const w = submenuOf(items, "Width").find((i) => "label" in i && i.label === "2 px")!;
    if ("run" in w) w.run();
    expect(ctx.setWidth).toHaveBeenCalledWith(1, 2);

    const dashed = submenuOf(items, "Line style").find((i) => "label" in i && i.label.startsWith("Dashed"))!;
    if ("run" in dashed) dashed.run();
    expect(ctx.setLine).toHaveBeenCalledWith(1, "dashed");

    const none = submenuOf(items, "Marker").find((i) => "label" in i && i.label === "None")!;
    if ("run" in none) none.run();
    expect(ctx.setMarker).toHaveBeenCalledWith(1, false);
  });

  it("grid + legend + autoscale + tools dispatch", () => {
    const ctx = makeCtx();
    const items = buildPlotMenu(ctx);
    const grid = find(items, "Hide grid")!; // showGrid=true → "Hide grid"
    if ("run" in grid) grid.run();
    expect(ctx.setShowGrid).toHaveBeenCalledWith(false);

    const autoX = submenuOf(items, "X axis").find((i) => "label" in i && i.label === "Autoscale X")!;
    if ("run" in autoX) autoX.run();
    expect(ctx.autoscaleX).toHaveBeenCalled();

    const integ = submenuOf(items, "Tools").find((i) => "label" in i && i.label.startsWith("Integrate"))!;
    if ("run" in integ) integ.run();
    expect(ctx.setTool).toHaveBeenCalledWith("integ");
  });
});

describe("buildPlotMenu — checkmarks + disabled state", () => {
  it("checks the current line style, width, and 'None' marker", () => {
    const items = buildPlotMenu(makeCtx({ series: series({ style: { line: "dotted", width: 3 } }) }));
    const dotted = submenuOf(items, "Line style").find((i) => "label" in i && i.label.startsWith("Dotted"));
    expect(dotted && "checked" in dotted && dotted.checked).toBe(true);
    const w3 = submenuOf(items, "Width").find((i) => "label" in i && i.label === "3 px");
    expect(w3 && "checked" in w3 && w3.checked).toBe(true);
    const none = submenuOf(items, "Marker").find((i) => "label" in i && i.label === "None");
    expect(none && "checked" in none && none.checked).toBe(true); // no marker set
  });

  it("marks the active swatch and offers Reset when overridden", () => {
    const items = buildPlotMenu(makeCtx({ series: series({ style: { color: "--series-4" } }) }));
    const sw = swatchesOf(items);
    expect(sw.find((s) => s.title === "Series 4")!.active).toBe(true);
    expect(find(items, "Reset series style")).toBeTruthy();
  });

  it("disables Hide series when it is the last visible curve", () => {
    const items = buildPlotMenu(makeCtx({ series: series({ hidden: false }), canHide: false }));
    const hide = find(items, "Hide series")!;
    expect("disabled" in hide && hide.disabled).toBe(true);
  });

  it("log labels carry the current-scale check", () => {
    const items = buildPlotMenu(makeCtx({ zone: "x", xLog: true }));
    const logX = find(items, "Log X scale")!;
    expect("checked" in logX && logX.checked).toBe(true);
  });
});
