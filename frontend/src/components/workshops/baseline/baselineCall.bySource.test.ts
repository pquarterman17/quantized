// Baseline inputs by dataset handle and the lean response for every method
// (plans/LARGE_PAYLOAD_PLAN.md; backend routes/baseline.py): when the server
// holds the worksheet a request names it (handle + channels + the whole
// column as one run) instead of posting x/y; y-only routes send no X channel;
// a miss resends once and then posts the arrays.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../../lib/api/baseline";
import { rememberHandle } from "../../../lib/api/datasetCache";
import type { DataStruct } from "../../../lib/types";
import { baselineBy, callBaseline, callBaselinePreview } from "./baselineCall";
import type { BaselineMethod, BaselineParams } from "./useBaseline";

vi.mock("../../../lib/api/baseline", () => {
  const f = (): unknown => vi.fn();
  return {
    baselineALS: f(), baselineAnchor: f(), baselineEstimate: f(), baselineEstimateLean: f(),
    baselineLean: f(), baselineModPoly: f(), baselineModPolyLean: f(), baselineRegion: f(),
    baselineRollingBall: f(), baselineShirley: f(), baselineXrdLowAngle: f(),
  };
});

const P = {
  lam: 1e5, p: 0.01, radius: 40, order: 3, maxIter: 20, anchorMethod: "pchip",
  regionXMin: Number.NaN, regionXMax: Number.NaN, regionYMin: Number.NaN, regionYMax: Number.NaN,
} as unknown as BaselineParams;
const ANCHORS: [number, number][] = [[0, 1], [4, 2]];

const make = (n: number): DataStruct => ({
  time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [i * 2, i * 3]),
  labels: ["a", "b"], units: ["", ""], metadata: {},
});

let fetchMock: ReturnType<typeof vi.fn>;
const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const lastBody = (): Record<string, unknown> => JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => reply({ baseline: [1, 2, 3, 4, 5], background: [1, 2, 3, 4, 5] }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const METHODS: [BaselineMethod, string, boolean][] = [
  ["als", "/api/baseline/als", true],
  ["rollingball", "/api/baseline/rollingball", true],
  ["modpoly", "/api/baseline/modpoly", true],
  ["snip", "/api/baseline/estimate", false],
  ["anchor", "/api/baseline/anchor", false],
  ["shirley", "/api/baseline/shirley", false],
  ["xrdla", "/api/baseline/xrdlowangle", false],
  ["region", "/api/baseline/region", false],
  ["poly", "/api/baseline/region", false],
];

describe("callBaseline by dataset handle", () => {
  it.each(METHODS)("%s names the dataset instead of posting arrays", async (method, path, yOnly) => {
    const data = make(5);
    rememberHandle(data, "h-base");
    const by = baselineBy(data, 0, 1);
    const out = await callBaseline(method, data.values.map((r) => r[0]), data.values.map((r) => r[1]), P, ANCHORS, by);
    expect(out.baseline).toEqual([1, 2, 3, 4, 5]);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(path);
    const body = lastBody();
    expect(body).toMatchObject({ dataset_handle: "h-base", y_channel: 1, rows: [[0, 5]] });
    expect(body).not.toHaveProperty("x");
    expect(body).not.toHaveProperty("y");
    expect(body).not.toHaveProperty("dataset");
    expect(body.x_channel).toBe(yOnly ? undefined : 0);
  });

  it("posts the arrays when no handle is known", async () => {
    vi.mocked(api.baselineALS).mockResolvedValue({ baseline: [9] });
    const data = make(5);
    const out = await callBaseline("als", [0], [1, 2], P, [], baselineBy(data, null, 0));
    expect(out.baseline).toEqual([9]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(api.baselineALS).toHaveBeenCalledWith({ y: [1, 2], lam: P.lam, p: P.p });
  });

  it("uses time as the X channel when xKey is null", async () => {
    const data = make(5);
    rememberHandle(data, "h-time");
    await callBaseline("snip", [0, 1], [0, 1], P, [], baselineBy(data, null, 0));
    expect(lastBody()).toMatchObject({ x_channel: -1, y_channel: 0 });
  });

  it("falls back to the arrays after a refused resend", async () => {
    vi.mocked(api.baselineShirley).mockResolvedValue({ baseline: [7], info: {} });
    const data = make(5);
    rememberHandle(data, "h-gone");
    fetchMock.mockResolvedValue(reply({ detail: "unknown_dataset_handle" }, 409));
    const out = await callBaseline("shirley", [0, 1], [1, 2], P, [], baselineBy(data, 0, 1));
    expect(out.baseline).toEqual([7]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // the handle, then the dataset once
    expect(api.baselineShirley).toHaveBeenCalledWith({ x: [0, 1], y: [1, 2], max_iter: 20 });
  });
});

describe("callBaselinePreview lean for every method", () => {
  const N = 30_000;
  const big = make(N);
  const xs = big.values.map((r) => r[0]);
  const ys = big.values.map((r) => r[1]);
  const display = { rows: [0, 5, N - 1], y: [0, 2.5, null] };

  it.each(METHODS.filter(([m]) => m !== "snip" && m !== "modpoly"))(
    "%s asks for the lean response, by handle, and fetches the rest by id",
    async (method, path) => {
      rememberHandle(big, "h-big");
      fetchMock.mockResolvedValueOnce(reply({ resultId: "rid", baselineDisplay: display }));
      fetchMock.mockResolvedValueOnce(reply({ values: ys }));
      const r = await callBaselinePreview(method, xs, ys, P, ANCHORS, baselineBy(big, 0, 1));
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      expect(fetchMock.mock.calls[0]![0]).toBe(path);
      expect(body).toMatchObject({ return_baseline: false, display_points: 4096, dataset_handle: "h-big" });
      expect(body).not.toHaveProperty("y");
      expect(r.baseline).toHaveLength(N);
      expect(r.baseline[5]).toBe(2.5);
      expect(r.baseline[6]).toBeUndefined();
      expect(await r.full!()).toEqual(ys);
      expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/results/array");
    },
  );

  it("posts the lean arrays through baselineLean when the server does not hold the data", async () => {
    vi.mocked(api.baselineLean).mockResolvedValue({ resultId: "r", baselineDisplay: display });
    const r = await callBaselinePreview("als", xs, ys, P, [], baselineBy(make(N), 0, 1)); // no handle remembered
    expect(fetchMock).not.toHaveBeenCalled();
    expect(api.baselineLean).toHaveBeenCalledWith(
      "/api/baseline/als", expect.objectContaining({ y: ys, return_baseline: false, display_points: 4096 }));
    expect(r.baseline[5]).toBe(2.5);
  });
});
