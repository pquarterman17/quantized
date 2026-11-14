// Gap audit 2 #8 follow-up: the plot's double-click hook leaves the gesture to
// an annotation / shape / reference line under the pointer (the plugin shows a
// move / resize cursor on hover), even when that object sits on a curve; only
// a double-click with no object under it goes to the lazy curve decision.

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { usePlotStageActions } from "./usePlotStageActions";

const plotDoubleClick = vi.fn();
let decided: () => void = () => {};
vi.mock("./curveDoubleClick", () => ({ plotDoubleClick: (...a: unknown[]) => { plotDoubleClick(...a); decided(); } }));

afterEach(() => plotDoubleClick.mockClear());

function dbl(cursor: string): { stopped: boolean } {
  const over = document.createElement("div");
  over.style.cursor = cursor;
  document.body.appendChild(over);
  const u = { over } as unknown as uPlot;
  const { unmount } = renderHook(() => usePlotStageActions({ current: u }, null, null));
  const e = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
  let stopped = false;
  e.stopPropagation = () => { stopped = true; };
  over.dispatchEvent(e);
  unmount();
  over.remove();
  return { stopped };
}

describe("plot double-click vs on-plot objects", () => {
  it.each(["move", "nwse-resize", "ew-resize", "ns-resize"])("does not intercept over an object (%s cursor)", async (cursor) => {
    expect(dbl(cursor).stopped).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(plotDoubleClick).not.toHaveBeenCalled();
  });

  it("hands a double-click with no object under it to the curve decision", async () => {
    const arrived = new Promise<void>((resolve) => { decided = resolve; });
    expect(dbl("default").stopped).toBe(true);
    await arrived; // the lazy chunk ran
    expect(plotDoubleClick).toHaveBeenCalledTimes(1);
  });
});
