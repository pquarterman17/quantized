// Navigation gestures (drag-pan, wheel zoom, view history) across every y
// scale and every scale distribution (plot audit round 3, interaction cluster).
// Measured on real files: a 100 px pan down on a log-y XRR scan (7 .. 1e6 cps)
// moved the view to [1.7e5, 1.2e6] — every point off screen — because the pan
// shifted log bounds by a LINEAR delta; and a y2 series stayed put while pan
// and wheel moved the primary axis, then lost a box zoom on the next rebuild.
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

import { cancelActiveGesture } from "./gestureCancel";
import type { PlotPayload } from "./plotdata";
import { buildOpts, type BuildOptsArgs } from "./uplotOpts";

const live: uPlot[] = [];
afterEach(() => live.splice(0).forEach((u) => u.destroy()));

const tick = () => new Promise((r) => setTimeout(r, 0)); // uPlot commits on a microtask

function payload(withY2: boolean): PlotPayload {
  const xs = Array.from({ length: 50 }, (_, i) => 1 + i * 0.1);
  return {
    data: [xs, xs.map((x) => 10 ** (6 - x)), ...(withY2 ? [xs.map((x) => 300 - 20 * x)] : [])] as PlotPayload["data"],
    series: [{ label: "I", unit: "cps" }, ...(withY2 ? [{ label: "T", unit: "K", axis: 1 }] : [])],
    xLabel: "2θ",
    xUnit: "deg",
  };
}

async function mount(p: PlotPayload, extra: Partial<BuildOptsArgs>): Promise<uPlot> {
  const opts = buildOpts(p, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "pan", onReadout: vi.fn(),
    linearPaths: uPlot.paths.linear!(), ...extra,
  });
  const u = new uPlot(opts, p.data, document.body.appendChild(document.createElement("div")));
  live.push(u);
  await tick();
  // jsdom lays nothing out: report uPlot's own plotting-area size (pxRatio 1).
  Object.defineProperty(u.over, "clientWidth", { value: u.bbox.width });
  Object.defineProperty(u.over, "clientHeight", { value: u.bbox.height });
  return u;
}

function drag(u: uPlot, dx: number, dy: number): void {
  u.over.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 100, clientY: 100 }));
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 + dx, clientY: 100 + dy }));
  document.dispatchEvent(new MouseEvent("mouseup", {}));
}

const lim = (u: uPlot, k: string): [number, number] => [u.scales[k].min!, u.scales[k].max!];

describe("drag-pan", () => {
  it("moves a log axis by decades: same span, a third of it for a third of the height", async () => {
    const u = await mount(payload(false), { yScale: "log" });
    const [lo, hi] = lim(u, "y");
    drag(u, 0, u.bbox.height / 3); // a third of the plot height, downward
    await tick();
    const [lo2, hi2] = lim(u, "y");
    expect(lo2).toBeGreaterThan(0);
    expect(Math.log10(hi2) - Math.log10(lo2)).toBeCloseTo(Math.log10(hi) - Math.log10(lo), 9);
    expect(Math.log10(lo2) - Math.log10(lo)).toBeCloseTo((Math.log10(hi) - Math.log10(lo)) / 3, 9);
  });

  it("never drives a log axis to zero or below, however far it is dragged", async () => {
    const u = await mount(payload(false), { yScale: "log" });
    drag(u, 0, -3000);
    await tick();
    expect(u.scales.y.min!).toBeGreaterThan(0);
    expect(Number.isFinite(u.scales.y.max!)).toBe(true);
  });

  it("moves a reciprocal x axis by a constant step in 1/x", async () => {
    const u = await mount(payload(false), { xScale: "reciprocal" });
    const [lo, hi] = lim(u, "x");
    drag(u, u.bbox.width / 5, 0); // a fifth of the plot width
    await tick();
    const [lo2, hi2] = lim(u, "x");
    expect(1 / lo2 - 1 / hi2).toBeCloseTo(1 / lo - 1 / hi, 9);
    expect(Math.abs(1 / lo2 - 1 / lo)).toBeCloseTo((1 / lo - 1 / hi) / 5, 9);
  });

  it("stops a reciprocal x axis at its pole instead of handing uPlot a NaN bound", async () => {
    const u = await mount(payload(false), { xScale: "reciprocal" });
    drag(u, -50 * u.bbox.width, 0); // far past 1/x = 0
    await tick();
    expect(Number.isFinite(u.scales.x.min!) && Number.isFinite(u.scales.x.max!)).toBe(true);
    expect(u.scales.x.min!).toBeGreaterThan(0);
  });

  it("moves a secondary y axis with the primary one", async () => {
    const u = await mount(payload(true), {});
    const [lo, hi] = lim(u, "y2");
    drag(u, 0, u.bbox.height / 2);
    await tick();
    const [lo2, hi2] = lim(u, "y2");
    expect(lo2 - lo).toBeCloseTo((hi - lo) / 2, 9);
    expect(hi2 - hi).toBeCloseTo((hi - lo) / 2, 9);
  });
});

describe("drag-pan cancel", () => {
  it("puts every scale back and stops following the pointer", async () => {
    const u = await mount(payload(true), {});
    const before = ["x", "y", "y2"].map((k) => lim(u, k));
    u.over.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 160, clientY: 140 }));
    expect(cancelActiveGesture()).toBe(true);
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 260, clientY: 240 }));
    await tick();
    expect(["x", "y", "y2"].map((k) => lim(u, k))).toEqual(before);
  });
});

describe("wheel zoom", () => {
  it("zooms a secondary y axis with the primary one", async () => {
    const u = await mount(payload(true), { tool: "zoom", wheelZoom: true });
    const [lo, hi] = lim(u, "y2");
    // y only: x stays put, so y2 cannot simply re-autoscale to a narrower x window.
    u.over.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, shiftKey: true, cancelable: true }));
    await tick();
    const [lo2, hi2] = lim(u, "y2");
    expect(hi2 - lo2).toBeLessThan(hi - lo);
  });
});

describe("double-click reset", () => {
  // Measured live: after a box zoom, uPlot's double-click re-fit was committed
  // as FIXED limits ([0, 100] x [0, 1100]), so the view never autoscaled again
  // (hiding a series left y at 1100) and the export carried them too.
  it("commits the re-fit as auto limits, not as the fitted numbers", async () => {
    const seen: unknown[] = [];
    const u = await mount(payload(true), { tool: "zoom", onViewChange: (_b, a) => seen.push(a) });
    const at = (type: string, x: number, y: number) =>
      u.over.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x, clientY: y, movementX: 1, movementY: 1, bubbles: true }));
    at("mousedown", 40, 40);
    at("mousemove", 200, 150);
    at("mouseup", 200, 150);
    await tick();
    await tick();
    expect(seen).toHaveLength(1); // the box zoom
    for (const t of ["mousedown", "mouseup", "mousedown", "mouseup", "dblclick"]) at(t, 100, 100);
    await tick();
    await tick();
    expect(seen.at(-1)).toEqual({ xLim: null, yLim: null, y2Lim: null });
    expect(seen).toHaveLength(2);
  });
});

describe("view history", () => {
  it("reports the secondary y range of a committed gesture, and only when there is one", async () => {
    const seen: unknown[] = [];
    const u = await mount(payload(true), { onViewChange: (_b, a) => seen.push(a) });
    drag(u, 0, 150);
    await tick();
    await tick();
    expect(seen).toHaveLength(1);
    expect((seen[0] as { y2Lim?: [number, number] }).y2Lim).toEqual(lim(u, "y2"));
    const v = await mount(payload(false), { onViewChange: (_b, a) => seen.push(a) });
    drag(v, 0, 150);
    await tick();
    await tick();
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toHaveProperty("y2Lim");
  });
});
