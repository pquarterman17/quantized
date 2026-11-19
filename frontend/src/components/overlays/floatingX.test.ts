import { afterEach, describe, expect, it } from "vitest";

import { floatingX, placeFloatingX } from "./floatingX";

describe("placeFloatingX (pure)", () => {
  it("opens against the right edge, left of the side column", () => {
    expect(placeFloatingX(1440, 296, 360, 300)).toBe(1440 - 296 - 360 - 16);
  });

  it("never sits left of the plot body when it fits there", () => {
    // edge x would be 188 (over the Y-axis gutter that ends at 300).
    expect(placeFloatingX(1000, 296, 500, 300)).toBe(300);
  });

  it("keeps the right edge when there is no plot", () => {
    expect(placeFloatingX(1440, 296, 420, 0)).toBe(1440 - 296 - 420 - 16);
  });

  it("clamps to the viewport when the window cannot fit right of the gutter", () => {
    // bodyLeft 560 + 700 runs off a 1100 px viewport: right edge of the viewport.
    expect(placeFloatingX(1100, 296, 700, 560)).toBe(1100 - 700 - 16);
  });

  it("never goes below the gap", () => {
    expect(placeFloatingX(300, 296, 620, 0)).toBe(16);
  });
});

describe("floatingX (live DOM)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--rw");
  });

  it("reads the plot body's left edge from the stage's uPlot", () => {
    document.documentElement.style.setProperty("--rw", "296px");
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    const stage = document.createElement("div");
    stage.className = "qzk-stage";
    const over = document.createElement("div");
    over.className = "u-over";
    over.getBoundingClientRect = () => ({ left: 560, right: 700, top: 0, bottom: 0, width: 140, height: 0, x: 560, y: 0, toJSON: () => ({}) });
    stage.appendChild(over);
    document.body.appendChild(stage);
    // right-edge x = 1000-296-360-16 = 328 < 560, and 560+360+16 fits: 560.
    expect(floatingX(360)).toBe(560);
  });
});
