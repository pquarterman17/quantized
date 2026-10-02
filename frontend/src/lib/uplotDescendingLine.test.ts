// A dense DESCENDING-x line against a real uPlot linear path builder. uPlot
// min/max-decimates a run of >= 4 points per pixel assuming ascending x; on a
// descending FTIR spectrum (4000 -> 400 cm^-1, thousands of points) every
// point then collapsed into the first pixel column and the trace drew as one
// vertical line. A recording Path2D stands in for jsdom's missing one.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  class RecordingPath {
    xs: number[] = [];
    moveTo(x: number) { this.xs.push(x); }
    lineTo(x: number) { this.xs.push(x); }
    addPath(p: RecordingPath) { this.xs.push(...p.xs); }
    rect() {}
    arc() {}
    closePath() {}
    bezierCurveTo() {}
  }
  (globalThis as { Path2D?: unknown }).Path2D = RecordingPath;
  const mq = { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  window.matchMedia ??= (() => mq) as unknown as typeof window.matchMedia;
});

import uPlot from "uplot";

import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";

const live: uPlot[] = [];
afterEach(() => live.splice(0).forEach((u) => u.destroy()));

function payload(xs: number[]): PlotPayload {
  return {
    data: [xs, xs.map((x) => Math.sin(x / 50))] as PlotPayload["data"],
    series: [{ label: "T", unit: "" }],
    xLabel: "Wavenumber",
    xUnit: "cm^-1",
  };
}

async function strokeXs(p: PlotPayload): Promise<number[]> {
  const opts = buildOpts(p, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
    linearPaths: uPlot.paths.linear!(),
  });
  const u = new uPlot(opts, p.data, document.body.appendChild(document.createElement("div")));
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits on a microtask
  const builder = u.series[1].paths!;
  const out = builder(u, 1, 0, p.data[0].length - 1) as unknown as { stroke: { xs: number[] } };
  return out.stroke.xs;
}

describe("a dense descending-x line keeps its shape", () => {
  it("spreads across the plot width instead of collapsing into one column", async () => {
    const n = 8000; // far past 4 points per pixel at this width
    const xs = Array.from({ length: n }, (_, i) => 4000 - (i * 3600) / (n - 1));
    const drawn = await strokeXs(payload(xs));
    const span = Math.max(...drawn) - Math.min(...drawn);
    expect(span).toBeGreaterThan(400); // nearly the full plot width, not ~0
    expect(new Set(drawn.map(Math.round)).size).toBeGreaterThan(300);
  });
});
