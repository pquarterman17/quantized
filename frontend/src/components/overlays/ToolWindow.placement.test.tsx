// u11: a new floating tool (no saved rect, no x of its own) opens beside the focused plot, or under its
// toolbar, and keeps that spot while the plot moves; a saved rect and explicit x/y still win.
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useApp } from "../../store/useApp";
import ToolWindow from "./ToolWindow";

const rect = (left: number, top: number, right: number, bottom: number) =>
  () => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

let host: HTMLElement;
function plotOnScreen(plot: [number, number, number, number], toolbar: [number, number, number, number]): void {
  host = document.createElement("div");
  host.className = "qzk-wl-middle";
  const uplot = document.createElement("div");
  uplot.className = "uplot";
  uplot.getBoundingClientRect = rect(...plot);
  const bar = document.createElement("div");
  bar.className = "qzk-float-tools";
  bar.getBoundingClientRect = rect(...toolbar);
  host.append(uplot, bar);
  host.getBoundingClientRect = rect(...plot);
  document.body.append(host);
}
const winOf = (c: HTMLElement) => c.querySelector(".qzk-win") as HTMLElement;

beforeEach(() => {
  useApp.setState({ toolWindowLayout: {}, layoutMode: "classic" });
  Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
});
afterEach(() => host?.remove());

describe("a new floating tool window", () => {
  it("opens to the right of the focused plot when there is room", () => {
    plotOnScreen([239, 102, 1000, 876], [254, 143, 990, 196]);
    const { container } = render(<ToolWindow id="power" title="Power" width={340}>body</ToolWindow>);
    expect(winOf(container).style.left).toBe("1008px");
    expect(winOf(container).style.top).toBe("102px");
  });

  it("with no room beside it opens under the plot toolbar, never over it (Ternary, 560 wide)", () => {
    plotOnScreen([239, 102, 1100, 876], [254, 143, 1090, 196]);
    const { container } = render(<ToolWindow id="ternary" title="Ternary" width={560}>body</ToolWindow>);
    const top = parseFloat(winOf(container).style.top);
    expect(top).toBeGreaterThanOrEqual(196 + 8);
  });

  it("keeps its spot when the plot moves afterwards, and a saved rect or explicit x/y still win", () => {
    plotOnScreen([239, 102, 1000, 876], [254, 143, 990, 196]);
    const { container, rerender } = render(<ToolWindow id="resample" title="Resample" width={340}>body</ToolWindow>);
    const left = winOf(container).style.left;
    host.querySelector<HTMLElement>(".uplot")!.getBoundingClientRect = rect(239, 102, 700, 876);
    rerender(<ToolWindow id="resample" title="Resample" width={340}>body</ToolWindow>);
    expect(winOf(container).style.left).toBe(left);
    useApp.setState({ toolWindowLayout: { saved: { x: 50, y: 300, width: 340, height: null, collapsed: false } } });
    expect(winOf(render(<ToolWindow id="saved" title="S" width={340}>b</ToolWindow>).container).style.top).toBe("300px");
    expect(winOf(render(<ToolWindow id="explicit" title="E" x={130} y={70}>b</ToolWindow>).container).style.top).toBe("70px");
  });
});
