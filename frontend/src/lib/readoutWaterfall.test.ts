// The data cursor on a waterfall view reports each series' TRUE value (plot
// audit round 3). Measured: six curves with a 0.5 waterfall, cursor at x = 50,
// read s1 = 151.11 where the file holds 98.613 — the display stagger, not data.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  class NoopPath {
    moveTo() {}
    lineTo() {}
    addPath() {}
    rect() {}
    arc() {}
    closePath() {}
    bezierCurveTo() {}
  }
  (globalThis as { Path2D?: unknown }).Path2D = NoopPath;
  const mq = { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  window.matchMedia ??= (() => mq) as unknown as typeof window.matchMedia;
});

import uPlot from "uplot";

import { applyWaterfall, type PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";
import type { Readout } from "./uplotTools";

const live: uPlot[] = [];
afterEach(() => live.splice(0).forEach((u) => u.destroy()));

describe("cursor readout on a waterfall", () => {
  it("reports the data values, not the staggered ones", async () => {
    const xs = [0, 1, 2, 3, 4];
    const base: PlotPayload = {
      data: [xs, [1, 2, 3, 4, 5], [10, 20, 30, 40, 50], [7, 7, 7, 7, 7]] as PlotPayload["data"],
      series: [{ label: "a", unit: "" }, { label: "b", unit: "" }, { label: "c", unit: "" }],
      xLabel: "x",
      xUnit: "",
    };
    const shown = applyWaterfall(base, 0.5);
    expect(shown.data[2][2]).not.toBe(30); // the stagger is really drawn
    let seen: Readout | null = null;
    const opts = buildOpts(shown, {
      width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "cursor",
      onReadout: (r) => (seen = r), linearPaths: uPlot.paths.linear!(),
    });
    const u = new uPlot(opts, shown.data, document.body.appendChild(document.createElement("div")));
    live.push(u);
    await new Promise((r) => setTimeout(r, 0));
    u.setCursor({ left: u.valToPos(2, "x"), top: 10 });
    expect(seen).toEqual({ x: 2, rows: [{ label: "a", y: 3 }, { label: "b", y: 30 }, { label: "c", y: 7 }] });
  });
});
