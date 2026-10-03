// Plot audit leftovers: x-break panels drew no error bars, on screen or in the
// export, while the unbroken plot of the same view drew them. Each panel now
// draws its own rows' bars from the flat plot's bindings (role spans, incl. an
// X/dQ span, plus the legacy errKeys whiskers), and an auto shared y range
// covers them under the flat plot's log floor. Hidden series' bars are skipped.
// Real uPlot; jsdom lacks `matchMedia` and `Path2D`, stubbed before the import.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as { Path2D?: unknown };
  g.Path2D ??= class {
    moveTo() {}
    lineTo() {}
    rect() {}
    arc() {}
    closePath() {}
    addPath() {}
    bezierCurveTo() {}
  };
  const mq = { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  window.matchMedia ??= (() => mq) as unknown as typeof window.matchMedia;
});

const { calls } = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
vi.mock("../../lib/uplotOpts", async (orig) => {
  const m = await orig<typeof import("../../lib/uplotOpts")>();
  return {
    ...m,
    buildOpts: (payload: Parameters<typeof m.buildOpts>[0], args: Parameters<typeof m.buildOpts>[1]) => {
      calls.push(args as unknown as Record<string, unknown>);
      return m.buildOpts(payload, args);
    },
  };
});

import uPlot from "uplot";

import type { ErrorBinding } from "../../lib/errorRoles";
import { breakPayloads } from "../../lib/facet";
import type { DataStruct } from "../../lib/types";
import { renderBreakPanels } from "./breakPanelRender";

// x = time; channel 0 = R, 1 = dR, 2 = dQ, 3 = S (a second series), 4 = dS.
const data: DataStruct = {
  time: [1, 2, 3, 10, 11, 12],
  values: [
    [2, 0.5, 0.1, 1, 0.5],
    [4, 0.5, 0.1, 1, 0.5],
    [6, 1, 0.1, 1, 0.5],
    [8, 1, 0.2, 1, 0.999],
    [10, 5, 0.2, 1, 0.5],
    [9, 1, 0.2, 1, 0.5],
  ],
  labels: ["R", "dR", "dQ", "S", "dS"],
  units: ["", "", "", "", ""],
  metadata: {},
};
const roles: ErrorBinding[] = [
  { channel: 1, target: 0, axis: "y", side: "both" },
  { channel: 2, target: -1, axis: "x", side: "both" },
];

let plots: uPlot[] = [];
afterEach(() => {
  plots.forEach((u) => u.destroy());
  plots = [];
  calls.length = 0;
});


interface RenderOpts {
  yScale?: "linear" | "log";
  roles?: ErrorBinding[];
  errKeys?: Record<number, number>;
}

let n = 0;
function render(hidden: number[], opts: RenderOpts = {}) {
  const panels = breakPayloads(data, null, [0, 3], [[3, 10]]);
  const host = document.body.appendChild(document.createElement("div"));
  plots = renderBreakPanels(host, {
    panels,
    seriesLabels: {}, seriesStyles: {}, hiddenChannels: hidden, syncKey: `break-err-${(n += 1)}`,
    box: { w: 800, h: 300 },
    yAuto: true,
    errors: { roles: opts.roles ?? roles, errKeys: opts.errKeys ?? {} },
    cell: { xScale: "linear", yScale: opts.yScale ?? "linear", yLim: [1, 10], tool: "zoom", onReadout: vi.fn() },
  });
  return panels;
}

const settle = () => new Promise((r) => setTimeout(r, 0));
async function yRange() {
  await settle();
  return plots.map((u) => [u.scales.y.min, u.scales.y.max]);
}

describe("x-break panels draw error bars", () => {
  it("hands each panel its own rows' y and x (dQ) spans, keyed like the flat plot", () => {
    render([]);
    expect(calls).toHaveLength(2);
    const [left, right] = calls.map((a) => a.errorSpans as Map<number, { axis: string; plus: number[] }[]>);
    expect(left.get(1)?.map((s) => [s.axis, s.plus])).toEqual([["y", [0.5, 0.5, 1]], ["x", [0.1, 0.1, 0.1]]]);
    expect(right.get(1)?.map((s) => [s.axis, s.plus])).toEqual([["y", [1, 5, 1]], ["x", [0.2, 0.2, 0.2]]]);
    // dQ is the x's error, so it rides every plotted series.
    expect(right.get(2)?.map((s) => s.axis)).toEqual(["x"]);
  });

  it("hands the legacy errKeys whiskers per panel", () => {
    render([], { roles: [roles[0]], errKeys: { 3: 2 } });
    expect((calls[0].errorBars as Map<number, number[]>).get(2)).toEqual([0.1, 0.1, 0.1]);
    expect((calls[1].errorBars as Map<number, number[]>).get(2)).toEqual([0.2, 0.2, 0.2]);
  });

  it("widens the auto shared y range to the bars' ends", async () => {
    // R's 10 +/- 5 reaches 15; S (always 1) +/- dR reaches 1 - 5 = -4.
    render([], { roles: [roles[0]], errKeys: { 3: 1 } });
    const want = uPlot.rangeNum(-4, 15, 0.1, true);
    expect(await yRange()).toEqual([want, want]);
  });

  it("skips bar ends under the log floor, as the unbroken plot does", async () => {
    // S +/- dS: 1 - 0.999 = 0.001 is under the floor (lowest point 1, / 100) so runs to it; 0.5 counts.
    render([], { roles: [roles[0]], errKeys: { 3: 4 }, yScale: "log" });
    const want = uPlot.rangeLog(0.5, 15, 10, false);
    expect(await yRange()).toEqual([want, want]);
  });

  it("skips a hidden series' bars", async () => {
    render([3], { roles: [roles[0]], errKeys: { 3: 1 } });
    const want = uPlot.rangeNum(1, 15, 0.1, true);
    expect(await yRange()).toEqual([want, want]);
  });
});
