// Figures live check: the Stat Stage's floating tool bar wrapped to several
// rows in a small graph window and hid the whole chart (and at any width it
// covered the top of the tallest bar or whisker). The plot now sits below it.

import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StatStagePlot from "./StatStagePlot";
import { useToolsClearance } from "./useToolsClearance";

function bar(top: number, height: number): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetTop", { value: top });
  Object.defineProperty(el, "offsetHeight", { value: height });
  return el;
}

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}
beforeEach(() => vi.stubGlobal("ResizeObserver", MockResizeObserver));
afterEach(() => vi.unstubAllGlobals());

describe("Stat Stage tool-bar clearance", () => {
  it("measures the bar's bottom edge, however many rows it wraps to", () => {
    const { result } = renderHook(() => useToolsClearance());
    expect(result.current[1]).toBe(0);
    act(() => result.current[0](bar(12, 140))); // a five-row bar in a small window
    expect(result.current[1]).toBe(156);
  });

  it("the plot starts below the bar", () => {
    const { container } = render(
      <StatStagePlot draw={null} drawFacets={null} theme="dark" accent="violet" sel={null} right={0} top={156} />,
    );
    expect((container.firstElementChild as HTMLElement).style.top).toBe("156px");
  });
});
