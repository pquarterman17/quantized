// The curve-measurement ROI gadget kinds (intersect, interpolate, rise time),
// driven through the real store: the calc is the curve-measure route's (mocked
// at its wrapper, so what is pinned is the REQUEST the gadget sends and what it
// does with the answer), and the request must be exactly the "Curve
// measurements" panel's for the same rows, so the two read the same numbers.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { IntersectResult, StepTimeResult } from "../lib/api/curveMeasure";
import { DEFAULT_SETTINGS, runMeasure } from "../components/workshops/curvemeasure/curveMeasureRun";
import type { DataStruct } from "../lib/types";
import { useApp } from "./useApp";

const { inter, step } = vi.hoisted(() => ({ inter: vi.fn(), step: vi.fn() }));
vi.mock("../lib/api/curveMeasure", () => ({ measureIntersect: inter, measureLevelCrossings: vi.fn(), measureStepTime: step }));

const XS = [0, 1, 2, 3, 4, 5];
const data = (cols: number[][] = [XS, XS.map((v) => 5 - v)], time: number[] = XS): DataStruct => ({
  time,
  values: time.map((_, i) => cols.map((c) => c[i]!)),
  labels: cols.map((_, i) => ["A", "B", "C"][i]!),
  units: cols.map(() => ""),
  metadata: {},
});
const INTER: IntersectResult = {
  intersections: [{ x: 2.5, y: 2.5, kind: "cross", direction: "falling", x_end: 2.5 }],
  x_min: 0, x_max: 5, n_grid: 6, dropped_a: 0, dropped_b: 0, merged_a: 0, merged_b: 0,
};
const STEP: StepTimeResult = {
  edge: "rise", time: 2, x_low: 1, x_high: 3, low_fraction: 0.1, high_fraction: 0.9, low_plateau: 0, high_plateau: 10,
  low_level: 1, high_level: 9, plateaus_estimated: [true, true], plateau_method: "state", n_points: 6, dropped: 0, merged_duplicates: 0,
};

function load(d: DataStruct, over: Record<string, unknown> = {}) {
  useApp.setState({
    datasets: [{ id: "a", name: "a", data: d }], activeId: "a", yKeys: null, xKey: null, hiddenChannels: [], seriesOrder: null,
    qfitRoi: null, gadgetBusy: false, gadgetError: null, gadgetMeasure: null, gadgetCurveB: null, gadgetCursors: null,
    gadgetCursorResult: null, gadgetMode: "fit", ...over,
  });
}

beforeAll(async () => {
  await useApp.getState().runQuickFit(); // loads the lazy compute bodies once
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  inter.mockResolvedValue(INTER);
  step.mockResolvedValue(STEP);
});

describe("intersect gadget", () => {
  it("sends the ROI rows of both plotted curves, the panel's request for the same rows", async () => {
    load(data(), { gadgetMode: "intersect", qfitRoi: [0, 5] });
    await useApp.getState().runGadget();
    const sent = inter.mock.calls[0]![0];
    expect(sent).toEqual({ x1: XS, y1: XS, x2: XS, y2: XS.map((v) => 5 - v) });
    expect(useApp.getState().gadgetMeasure).toMatchObject({ mode: "intersect", r: INTER, bKey: 1 });
    // The panel, on the same arrays, makes the same request and reads the same answer.
    inter.mockClear();
    const panel = await runMeasure({ ...DEFAULT_SETTINGS, mode: "intersect" }, { x: XS, y: XS }, { x: XS, y: XS.map((v) => 5 - v) });
    expect(inter.mock.calls[0]![0]).toEqual(sent);
    expect(panel).toEqual({ mode: "intersect", r: INTER });
  });

  it("the ROI band is the window for BOTH curves", async () => {
    load(data(), { gadgetMode: "intersect", qfitRoi: [3.5, 1.5] }); // either order
    await useApp.getState().runGadget();
    expect(inter.mock.calls[0]![0]).toEqual({ x1: [2, 3], y1: [2, 3], x2: [2, 3], y2: [3, 2] });
  });

  it("the second-curve picker chooses another channel, and a change re-measures", async () => {
    vi.useFakeTimers();
    load(data([XS, XS.map((v) => 5 - v), XS.map((v) => 2 * v)]), { gadgetMode: "intersect", qfitRoi: [0, 5] });
    useApp.getState().setGadgetCurveB(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(inter.mock.calls[0]![0].y2).toEqual(XS.map((v) => 2 * v));
    expect(useApp.getState().gadgetMeasure).toMatchObject({ mode: "intersect", bKey: 2 });
  });

  it("names the missing second curve instead of measuring", async () => {
    load(data([XS]), { gadgetMode: "intersect", qfitRoi: [0, 5] });
    await useApp.getState().runGadget();
    expect(inter).not.toHaveBeenCalled();
    expect(useApp.getState().gadgetError).toMatch(/second curve/);
    expect(useApp.getState().gadgetBusy).toBe(false);
  });

  it("a backend refusal lands in the chip's error slot", async () => {
    inter.mockRejectedValue(new Error("the curves do not overlap in X"));
    load(data(), { gadgetMode: "intersect", qfitRoi: [0, 5] });
    await useApp.getState().runGadget();
    expect(useApp.getState().gadgetError).toBe("the curves do not overlap in X");
    expect(useApp.getState().gadgetMeasure).toBeNull();
  });

  it("moving the ROI drops the old measurement while the new one is pending", () => {
    load(data(), { gadgetMode: "intersect", qfitRoi: [0, 5], gadgetMeasure: { mode: "intersect", r: INTER, bKey: 1 } });
    useApp.getState().setQfitRoi([1, 2]);
    expect(useApp.getState().gadgetMeasure).toBeNull();
    expect(useApp.getState().gadgetBusy).toBe(true);
    useApp.getState().setQfitRoi(null);
  });
});

describe("rise time gadget", () => {
  const edge = [0, 0, 0, 5, 10, 10, 10];
  const T = [0, 1, 2, 3, 4, 5, 6];

  it("sends the panel's untouched-settings request over the ROI rows", async () => {
    load(data([edge], T), { gadgetMode: "risetime", qfitRoi: [0, 6] });
    await useApp.getState().runGadget();
    const sent = step.mock.calls[0]![0];
    expect(sent).toEqual({ x: T, y: edge, low_fraction: 0.1, high_fraction: 0.9, edge: "auto" });
    expect(useApp.getState().gadgetMeasure).toMatchObject({ mode: "risetime", r: STEP });
    step.mockClear();
    const panel = await runMeasure({ ...DEFAULT_SETTINGS, mode: "step" }, { x: T, y: edge }, null);
    const body = step.mock.calls[0]![0];
    expect(body.low_level).toBeUndefined(); // plateaus estimated, as in the gadget
    expect(body.high_level).toBeUndefined();
    expect({ x: body.x, y: body.y, low_fraction: body.low_fraction, high_fraction: body.high_fraction, edge: body.edge }).toEqual(sent);
    expect(panel).toEqual({ mode: "step", r: STEP });
  });

  it("the window picks the edge", async () => {
    load(data([edge], T), { gadgetMode: "risetime", qfitRoi: [2, 6] });
    await useApp.getState().runGadget();
    expect(step.mock.calls[0]![0].x).toEqual([2, 3, 4, 5, 6]);
  });

  it("asks for more of the edge when the window is too small", async () => {
    load(data([edge], T), { gadgetMode: "risetime", qfitRoi: [2, 4] });
    await useApp.getState().runGadget();
    expect(step).not.toHaveBeenCalled();
    expect(useApp.getState().gadgetError).toMatch(/at least 5 points/);
  });
});

describe("interpolate gadget", () => {
  const rows = () => (useApp.getState().gadgetMeasure as { rows: { yKey: number; y: (number | null)[] }[] }).rows;

  it("reads the interpolated Y of every plotted curve at each cursor", async () => {
    load(data(), { gadgetMode: "interpolate" });
    useApp.getState().setGadgetCursors([1.5, 4.25]);
    await vi.waitFor(() => expect(useApp.getState().gadgetMeasure).not.toBeNull());
    const r = rows();
    expect(r.map((x) => x.yKey)).toEqual([0, 1]);
    expect(r[0]!.y[0]).toBeCloseTo(1.5, 12);
    expect(r[0]!.y[1]).toBeCloseTo(4.25, 12);
    expect(r[1]!.y[0]).toBeCloseTo(3.5, 12);
    expect(r[1]!.y[1]).toBeCloseTo(0.75, 12);
  });

  it("agrees with the intersection the route reports at that X", async () => {
    load(data(), { gadgetMode: "interpolate" });
    const hit = INTER.intersections[0]!;
    useApp.getState().setGadgetCursors([hit.x, hit.x]);
    await vi.waitFor(() => expect(useApp.getState().gadgetMeasure).not.toBeNull());
    for (const row of rows()) expect(row.y[0]).toBeCloseTo(hit.y, 12);
  });

  it("is null outside a curve's X range, skips hidden curves, and reads a swept-back scan as drawn", async () => {
    // X goes up, then back: 0,2,4,3,1 with a repeated 2 (averaged) as the calc does.
    const t = [0, 2, 4, 3, 1, 2];
    const y = [0, 20, 40, 30, 10, 22];
    load(data([y, y.map((v) => -v)], t), { gadgetMode: "interpolate", hiddenChannels: [1] });
    useApp.getState().setGadgetCursors([1.5, 9]);
    await vi.waitFor(() => expect(useApp.getState().gadgetMeasure).not.toBeNull());
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.y[0]).toBeCloseTo(15.5, 12); // between (1,10) and (2, mean(20,22)=21)
    expect(rows()[0]!.y[1]).toBeNull();
  });

  it("cursors carry over between the two cursor modes, and clearing them clears the readout", async () => {
    load(data(), { gadgetMode: "cursors" });
    useApp.getState().setGadgetCursors([1, 3]);
    expect(useApp.getState().gadgetCursorResult).not.toBeNull();
    useApp.getState().setGadgetMode("interpolate");
    await vi.waitFor(() => expect(useApp.getState().gadgetMeasure).not.toBeNull());
    expect(useApp.getState().gadgetCursors).toEqual([1, 3]);
    useApp.getState().setGadgetMode("cursors");
    expect(useApp.getState().gadgetMeasure).toBeNull();
    expect(useApp.getState().gadgetCursorResult).not.toBeNull();
    useApp.getState().setGadgetMode("interpolate");
    useApp.getState().setGadgetCursors(null);
    expect(useApp.getState().gadgetMeasure).toBeNull();
  });

  it("leaving for a band mode clears the cursors; entering interpolate clears an armed band", () => {
    load(data(), { gadgetMode: "interpolate", gadgetCursors: [1, 3] });
    useApp.getState().setGadgetMode("intersect");
    expect(useApp.getState().gadgetCursors).toBeNull();
    useApp.setState({ qfitRoi: [1, 3] });
    useApp.getState().setGadgetMode("interpolate");
    expect(useApp.getState().qfitRoi).toBeNull();
  });
});
