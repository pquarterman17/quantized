// A non-monotonic-x line before and after the region-decor startup chunk
// (lib/uplotLoopLine.ts rides it). This FORCES the race (docs/testing.md):
// the chunk import is held behind a gate the test opens, so "drawn before the
// chunk" is certain, not a timing accident. Before it lands the line is the
// one it always was: every run through uPlot's builder, no x clip. When it
// lands, a viewport showing such a line rebuilds (PlotViewport's `l` key into
// `startupOverlayCount`), and only that one; afterwards the stroke is built
// from the rows with the builder asked once.

import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import { regionDecor, regionDecorReady } from "../../lib/regionDecorLoader";
import { richLabelsSettled } from "../../lib/richLabelsLoader";
import { buildOpts } from "../../lib/uplotOpts";
import PlotViewport, { type PlotViewportProps } from "./PlotViewport";

const gate = vi.hoisted(() => {
  let open = () => {};
  const held = new Promise<void>((r) => (open = r));
  return { held, open: () => open() };
});
vi.mock("../../lib/uplotRegionShades", async (importOriginal) => {
  await gate.held;
  return importOriginal();
});

const { created, MockUPlot } = vi.hoisted(() => {
  const created: { data: unknown }[] = [];
  class MockUPlot {
    scales = { x: { min: 0, max: 1 }, y: { min: 0, max: 1 } };
    series: unknown[];
    constructor(opts: { series: unknown[] }, data: unknown) {
      created.push({ data });
      this.series = opts.series;
    }
    destroy(): void {}
    setSize(): void {}
    setScale(): void {}
    redraw(): void {}
    batch(fn: (u: unknown) => void): void { fn(this); }
  }
  return { created, MockUPlot };
});
vi.mock("uplot", () => ({ default: MockUPlot }));

const n = 5000;
const loopXs = Array.from({ length: n }, (_, i) => Math.sin((i / n) * 4 * Math.PI));
const LOOP: PlotPayload = {
  data: [loopXs, loopXs.map((x) => Math.tanh(3 * x))],
  series: [{ label: "M", unit: "" }],
  xLabel: "H",
  xUnit: "",
};
const RAMP: PlotPayload = { ...LOOP, data: [loopXs.map((_, i) => i), loopXs] };

/** A uPlot stand-in with what the loop path reads, 100 device px wide. */
function fakeU(p: PlotPayload) {
  return {
    data: p.data,
    bbox: { left: 0, top: 0, width: 100, height: 100 },
    series: [{ scale: "x" }, { scale: "y", width: 1.5 }],
    scales: { x: { ori: 0, dir: 1 }, y: { ori: 1, dir: 1, distr: 1 } },
    valToPos: (v: number) => v,
  } as unknown as uPlot;
}

function linePaths(b: uPlot.Series.PathBuilder): uPlot.Series.PathBuilder {
  const opts = buildOpts(LOOP, { width: 100, height: 100, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(), linearPaths: b });
  return (opts.series?.[1] as { paths: uPlot.Series.PathBuilder }).paths;
}

function props(p: PlotPayload): PlotViewportProps {
  return {
    displayPayload: p, plotRef: createRef<uPlot | null>(), theme: "light", accent: "blue",
    peakWizardEdit: null, anchorEdit: null, width: 600, height: 400, yScale: "linear", xScale: "linear",
    tool: "zoom", onReadout: vi.fn(),
  } as unknown as PlotViewportProps;
}

describe("a loop line and the startup chunk (forces the race)", () => {
  it("draws as before until the chunk lands, then rebuilds only the loop's viewport and builds its own stroke", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    await richLabelsSettled; // labels' own startup chunk: settled first, so it asks for no rebuild here
    expect(regionDecorReady()).toBe(false);

    // Before: every run goes through the builder (whole rows, < 4 per pixel), no x clip.
    const runs: [number, number][] = [];
    const before = vi.fn((_u: uPlot, _s: number, i0: number, i1: number) => {
      runs.push([i0, i1]);
      return { stroke: new Path2D(), fill: null, clip: new Path2D() };
    });
    const out = linePaths(before)(fakeU(LOOP), 1, 0, 0)!;
    expect(out.clip).toBeNull();
    expect(runs.length).toBeGreaterThan(1);
    expect(runs[0]![0]).toBe(0);
    expect(runs.at(-1)![1]).toBe(n - 1);
    runs.forEach(([i0, i1]) => expect(i1 - i0).toBeLessThan(400));

    // Two viewports drawn before the chunk: a loop and an ascending ramp.
    render(<PlotViewport {...props(LOOP)} />);
    render(<PlotViewport {...props(RAMP)} />);
    const builds = (p: PlotPayload) => created.filter((c) => c.data === p.data).length;
    expect([builds(LOOP), builds(RAMP)]).toEqual([1, 1]);

    await act(async () => {
      gate.open();
      await Promise.resolve();
    });
    await waitFor(() => expect(regionDecor()).not.toBeNull());
    await waitFor(() => expect(builds(LOOP)).toBe(2));
    expect(builds(RAMP)).toBe(1);

    // After: the builder gives the first run only; the stroke is built here.
    const after = vi.fn(() => ({ stroke: new Path2D(), fill: null, clip: null }));
    linePaths(after as never)(fakeU(LOOP), 1, 0, 0);
    expect(after).toHaveBeenCalledTimes(1);
  });
});
