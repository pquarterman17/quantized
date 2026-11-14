// Gap audit 2 #8: a double-click on a curve opens its Plot Details; one on
// empty plot area re-fits the view (what uPlot's double-click did before), and
// the click never reaches uPlot's own re-fit first.

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { useFigureDialog } from "../../store/figureDialogs";
import { plotDoubleClick } from "./curveDoubleClick";
import { usePlotStageActions } from "./usePlotStageActions";

// Plot rect [100,100]→[500,400]; posToVal / valToPos are identity, so a
// click at client (300, 250) probes row 2 (x = 200) at local y = 150.
function fakePlot(over: HTMLElement | null = null): uPlot {
  return {
    over: over ?? { getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 400 }) },
    data: [[0, 100, 200, 300], [10, 20, 150, 40], [10, 20, 300, 40]],
    series: [{}, { scale: "y" }, { scale: "y" }],
    posToVal: (px: number) => px,
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

beforeEach(() => useFigureDialog.setState({ open: null }));

describe("plotDoubleClick", () => {
  it("on a curve opens Plot Details for that curve's channel", () => {
    const reset = vi.fn();
    plotDoubleClick(fakePlot(), 300, 250, [4, 7], reset);
    expect(useFigureDialog.getState().open).toEqual({ kind: "plotDetails", channel: 4 });
    expect(reset).not.toHaveBeenCalled();
  });

  it("on empty plot area re-fits the view", () => {
    const reset = vi.fn();
    plotDoubleClick(fakePlot(), 300, 330, [4, 7], reset); // local y 230: 80 px from either curve
    expect(useFigureDialog.getState().open).toBeNull();
    expect(reset).toHaveBeenCalledOnce();
  });

  it("ignores a hidden curve", () => {
    const u = fakePlot();
    (u.series[1] as { show?: boolean }).show = false;
    const reset = vi.fn();
    plotDoubleClick(u, 300, 250, [4, 7], reset);
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe("the Stage's double-click", () => {
  let over: HTMLDivElement;
  beforeEach(() => {
    over = document.createElement("div");
    over.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400 }) as DOMRect;
    document.body.appendChild(over);
  });
  afterEach(() => over.remove());

  it("is held back from uPlot's own re-fit and opens Plot Details on a curve", async () => {
    const uplotRefit = vi.fn(); // uPlot binds its dblclick re-fit on `u.over`
    over.addEventListener("dblclick", uplotRefit);
    const plotRef = { current: fakePlot(over) };
    renderHook(() => usePlotStageActions(plotRef, null, null, undefined, [4, 7]));
    over.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 300, clientY: 250 }));
    expect(uplotRefit).not.toHaveBeenCalled();
    await waitFor(() => expect(useFigureDialog.getState().open).toEqual({ kind: "plotDetails", channel: 4 }));
  });

  it("leaves a double-click outside the plot area (an axis) alone", () => {
    const outside = vi.fn();
    const axis = document.createElement("div");
    axis.addEventListener("dblclick", outside);
    document.body.appendChild(axis);
    renderHook(() => usePlotStageActions({ current: fakePlot(over) }, null, null, undefined, [4]));
    axis.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(outside).toHaveBeenCalledOnce();
    axis.remove();
  });
});
