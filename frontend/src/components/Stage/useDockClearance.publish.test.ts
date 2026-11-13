// Figures audit #15: in a small plot window the dock (group captions on, or
// wrapped) ended below the plot host's fixed 60 px inset and covered the top
// tick label ("10⁵"). The dock now publishes its real bottom edge on the
// stage, and the host's top is max(inset, that edge).

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DOCK_CLEAR_VAR, DOCK_GAP, usePublishDockClearance } from "./useDockClearance";

const viewportSrc = Object.values(
  import.meta.glob("./PlotViewport.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

function dockIn(stage: HTMLElement, top: number, height: number): HTMLElement {
  const dock = document.createElement("div");
  Object.defineProperty(dock, "offsetTop", { value: top });
  Object.defineProperty(dock, "offsetHeight", { value: height });
  stage.appendChild(dock);
  return dock;
}

describe("usePublishDockClearance", () => {
  it("publishes the dock's bottom edge plus the gap on its stage, and withdraws it on unmount", () => {
    const stage = document.createElement("div");
    const dock = dockIn(stage, 12, 63);
    const { unmount } = renderHook(() => usePublishDockClearance({ current: dock }));
    expect(stage.style.getPropertyValue(DOCK_CLEAR_VAR)).toBe(`${12 + 63 + DOCK_GAP}px`);
    unmount();
    expect(stage.style.getPropertyValue(DOCK_CLEAR_VAR)).toBe("");
  });

  it("the XY plot host starts below whichever is lower: its inset or the published dock edge", () => {
    expect(viewportSrc).toContain("max(${insetTop}px, var(--qz-dock-clear, 0px))");
  });
});
