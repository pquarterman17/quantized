import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import {
  FRAME_VARS,
  frameAnchorStyle,
  frameRect,
  frameVarsPlugin,
  publishFrameVars,
} from "./uplotFrameVars";

/** A minimal DOMRect (only the fields getBoundingClientRect consumers read). */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => "",
  } as DOMRect;
}

describe("frameRect (decode #52 — plot frame relative to the stage)", () => {
  it("subtracts the container origin and keeps the frame's own size", () => {
    const r = frameRect(rect(50, 60, 250, 150), rect(10, 20, 400, 300));
    expect(r).toEqual({ left: 40, top: 40, width: 250, height: 150 });
  });

  it("handles a frame flush against the container origin", () => {
    expect(frameRect(rect(0, 0, 100, 80), rect(0, 0, 100, 80))).toEqual({
      left: 0, top: 0, width: 100, height: 80,
    });
  });
});

describe("frameAnchorStyle (decode #52 — box top-left at a frame fraction)", () => {
  it("builds calc() over the published frame vars, no JS recompute needed", () => {
    const s = frameAnchorStyle([0.25, 0.8]);
    expect(s.left).toBe(`calc(var(${FRAME_VARS.left}, 0px) + var(${FRAME_VARS.width}, 100%) * 0.25)`);
    expect(s.top).toBe(`calc(var(${FRAME_VARS.top}, 0px) + var(${FRAME_VARS.height}, 100%) * 0.8)`);
    // Frees the corner anchoring so left/top drive placement.
    expect(s.right).toBe("auto");
    expect(s.bottom).toBe("auto");
  });
});

describe("publishFrameVars", () => {
  it("writes the four frame vars as px onto the element", () => {
    const el = document.createElement("div");
    publishFrameVars(el, { left: 40, top: 41, width: 250, height: 150 });
    expect(el.style.getPropertyValue(FRAME_VARS.left)).toBe("40px");
    expect(el.style.getPropertyValue(FRAME_VARS.top)).toBe("41px");
    expect(el.style.getPropertyValue(FRAME_VARS.width)).toBe("250px");
    expect(el.style.getPropertyValue(FRAME_VARS.height)).toBe("150px");
  });
});

describe("frameVarsPlugin", () => {
  /** Build a mock uPlot whose `.over` and enclosing `.qzk-stage` return fixed
   *  CSS-px rects. `bbox` is set to DIFFERENT (device-px) numbers to prove the
   *  plugin reads the CSS-px `getBoundingClientRect`, not `bbox` (DPR-safe). */
  function mockPlot(withStage: boolean): { u: uPlot; stage: HTMLElement | null } {
    const root = document.createElement("div");
    const over = document.createElement("div");
    vi.spyOn(over, "getBoundingClientRect").mockReturnValue(rect(50, 60, 250, 150));
    let stage: HTMLElement | null = null;
    if (withStage) {
      stage = document.createElement("div");
      stage.className = "qzk-stage";
      vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(rect(10, 20, 400, 300));
      stage.appendChild(root);
    }
    const u = {
      root,
      over,
      // Canvas (device) pixels — 2× a HiDPI display would report; the plugin
      // must IGNORE these in favour of the CSS-px rects above.
      bbox: { left: 100, top: 120, width: 500, height: 300 },
    } as unknown as uPlot;
    return { u, stage };
  }

  function runHook(plugin: uPlot.Plugin, name: "ready" | "setSize" | "draw", u: uPlot): void {
    (plugin.hooks[name] as (self: uPlot) => void)(u);
  }

  it("publishes the CSS-px frame rect onto the .qzk-stage ancestor (not bbox — DPR-safe)", () => {
    const { u, stage } = mockPlot(true);
    runHook(frameVarsPlugin(), "ready", u);
    // over(50,60) - stage(10,20) = (40,40); size is over's own 250×150 — NOT
    // bbox's 500×300 (which would betray a DPR/canvas-pixel mistake).
    expect(stage!.style.getPropertyValue(FRAME_VARS.left)).toBe("40px");
    expect(stage!.style.getPropertyValue(FRAME_VARS.top)).toBe("40px");
    expect(stage!.style.getPropertyValue(FRAME_VARS.width)).toBe("250px");
    expect(stage!.style.getPropertyValue(FRAME_VARS.height)).toBe("150px");
  });

  it("fires on setSize and draw too (resize + zoom gutter shifts)", () => {
    const { u, stage } = mockPlot(true);
    const plugin = frameVarsPlugin();
    runHook(plugin, "setSize", u);
    expect(stage!.style.getPropertyValue(FRAME_VARS.width)).toBe("250px");
    stage!.style.removeProperty(FRAME_VARS.width);
    runHook(plugin, "draw", u);
    expect(stage!.style.getPropertyValue(FRAME_VARS.width)).toBe("250px");
  });

  it("no-ops when there is no .qzk-stage ancestor (MultiPanel / inset hosts)", () => {
    const { u } = mockPlot(false);
    // Must not throw and must touch nothing.
    expect(() => runHook(frameVarsPlugin(), "ready", u)).not.toThrow();
  });
});
