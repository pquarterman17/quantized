// A reversed x axis (IR/FTIR wavenumber convention: high cm⁻¹ on the left).
// `PlotView.xReversed` is a per-view flag: the parser hints it
// (`metadata.x_reversed`, io/technique.py) and the rebind defaults take it;
// the canvas draws it as uPlot's `dir: -1` x scale, drag-pan follows the
// pointer, the export inverts matplotlib's x axis, and a .dwk keeps it.
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

import { datasetViewDefaults } from "../store/windowDefaults";
import { viewOverrides } from "./figureViewOverrides";
import type { PlotPayload } from "./plotdata";
import { defaultPlotView, sanitizePlotView } from "./plotview";
import type { Dataset } from "./types";
import { buildOpts } from "./uplotOpts";

const live: uPlot[] = [];
afterEach(() => live.splice(0).forEach((u) => u.destroy()));

function spectrum(n: number): PlotPayload {
  const xs = Array.from({ length: n }, (_, i) => 400 + (i * 3600) / (n - 1)); // ascending cm⁻¹
  return {
    data: [xs, xs.map((x) => Math.sin(x / 50))] as PlotPayload["data"],
    series: [{ label: "T", unit: "" }],
    xLabel: "Wavenumber",
    xUnit: "cm^-1",
  };
}

async function mount(p: PlotPayload, xReversed: boolean, tool: "zoom" | "pan" = "zoom"): Promise<uPlot> {
  const opts = buildOpts(p, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool, onReadout: vi.fn(),
    linearPaths: uPlot.paths.linear!(), xReversed,
  });
  const u = new uPlot(opts, p.data, document.body.appendChild(document.createElement("div")));
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits on a microtask
  return u;
}

describe("the canvas", () => {
  it("draws high wavenumber on the left and maps pixels back the same way", async () => {
    const u = await mount(spectrum(50), true);
    expect(u.valToPos(4000, "x")).toBeLessThan(u.valToPos(400, "x"));
    expect(u.posToVal(0, "x")).toBeGreaterThan(u.posToVal(500, "x"));
    const plain = await mount(spectrum(50), false);
    expect(plain.valToPos(4000, "x")).toBeGreaterThan(plain.valToPos(400, "x"));
  });

  it("keeps a dense trace's shape when reversed (min/max decimation)", async () => {
    const u = await mount(spectrum(8000), true);
    const out = u.series[1].paths!(u, 1, 0, 7999) as unknown as { stroke: { xs: number[] } };
    const xs = out.stroke.xs;
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(400);
    expect(new Set(xs.map(Math.round)).size).toBeGreaterThan(300);
  });

  it("drag-pans with the pointer: dragging right reveals HIGHER wavenumbers", async () => {
    const u = await mount(spectrum(50), true, "pan"); // the pan tool mounts panPlugin
    Object.defineProperty(u.over, "clientWidth", { value: 500 });
    const [min0, max0] = [u.scales.x.min!, u.scales.x.max!];
    u.over.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 100, clientY: 100 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 200, clientY: 100 }));
    document.dispatchEvent(new MouseEvent("mouseup", {}));
    await new Promise((r) => setTimeout(r, 0)); // setScale commits on a microtask too
    expect(u.scales.x.min!).toBeGreaterThan(min0);
    expect(u.scales.x.max!).toBeGreaterThan(max0);
  });
});

describe("defaults, export and persistence", () => {
  const ds = (metadata: Record<string, unknown>): Dataset => ({
    id: "d", name: "d", data: { time: [1, 2], values: [[1], [2]], labels: ["A"], units: [""], metadata },
  });

  it("takes the parser's hint on every rebind, and is off otherwise", () => {
    expect(datasetViewDefaults(ds({ technique: "spectroscopy", x_reversed: true })).xReversed).toBe(true);
    expect(datasetViewDefaults(ds({ technique: "spectroscopy" })).xReversed).toBe(false);
    expect(datasetViewDefaults(undefined).xReversed).toBe(false);
    expect(defaultPlotView().xReversed).toBe(false);
  });

  it("rides the export as x_reversed only when set", () => {
    const v = defaultPlotView();
    expect(viewOverrides({ ...v, xReversed: true })?.x_reversed).toBe(true);
    expect(viewOverrides(v)?.x_reversed).toBeUndefined();
  });

  it("survives a .dwk round trip; an older file reads as not reversed", () => {
    const saved = JSON.parse(JSON.stringify({ ...defaultPlotView(), xReversed: true }));
    expect(sanitizePlotView(saved).xReversed).toBe(true);
    const { xReversed: _gone, ...older } = saved;
    expect(sanitizePlotView(older).xReversed).toBe(false);
  });
});
