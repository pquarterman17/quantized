// Statistical-tests workshop — survival (Kaplan-Meier / log-rank / Cox): request
// building (lib/statsTests.ts), the readings (statsTestsResultsSurvival.ts) and
// the grouped clients (api/statsTestsSurvival.ts). Numbers in the readings are
// the Freireich 6-MP leukaemia example (Kleinbaum & Klein, Survival Analysis,
// ch. 1-3; Collett): 6-MP median 23, log-rank chi-square 16.79, Cox HR 4.82.
import { afterEach, describe, expect, it, vi } from "vitest";

import { statsKaplanMeier, statsLogrank } from "./api/statsTestsSurvival";
import { DEFAULT_PARAMS, DEFAULT_SELECTION, buildTestRequest, testColumns, testUsesAlpha, type TestParams, type TestSelection } from "./statsTests";
import { describeResult } from "./statsTestsResults";
import type { DataStruct } from "./types";

const post = vi.hoisted(() => vi.fn());
vi.mock("./api/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api/http")>()), postJSON: post }));
afterEach(() => post.mockReset());

// 0 time, 1 event (NaN at row 6), 2 group code (L1/L2), 3 predictor, 4 negative time,
// 5 non-binary event.
const data: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7],
  values: [
    [5, 1, 0, 1.5, -1, 2],
    [6, 0, 0, 2.5, 3, 1],
    [7, 1, 0, 2.0, 4, 0],
    [8, 1, 1, 4.5, 5, 1],
    [9, 0, 1, 3.0, 6, 1],
    [10, 1, 1, 6.5, 7, 0],
    [11, NaN, 1, 1.0, 8, 1],
    [12, 1, 1, 2.2, 9, 1],
  ],
  labels: ["time", "event", "arm", "dose", "badtime", "badevent"],
  units: ["", "", "", "", "", ""],
  metadata: {},
  cat_levels: { 2: ["placebo", "drug"] },
};
const sel = (over: Partial<TestSelection>): TestSelection => ({ ...DEFAULT_SELECTION, ...over });
const grouped: TestParams = { ...DEFAULT_PARAMS, survivalGroups: true };

describe("Kaplan-Meier request", () => {
  it("sends one group of complete rows by default", () => {
    expect(buildTestRequest("kaplan-meier", data, sel({ x: 0, y: 1 }), DEFAULT_PARAMS)).toEqual({
      ok: true,
      request: { id: "kaplan-meier", body: { groups: [{ label: "", time: [5, 6, 7, 8, 9, 10, 12], event: [1, 0, 1, 1, 0, 1, 1] }] } },
      labels: ["time", "event"],
    });
  });

  it("splits into one curve per group level (named by the category labels) when asked", () => {
    const out = buildTestRequest("kaplan-meier", data, sel({ x: 0, y: 1, byCol: 2 }), grouped);
    expect(out).toMatchObject({
      ok: true,
      request: { id: "kaplan-meier", body: { groups: [
        { label: "placebo", time: [5, 6, 7], event: [1, 0, 1] },
        { label: "drug", time: [8, 9, 10, 12], event: [1, 0, 1, 1] },
      ] } },
    });
    expect(testColumns("kaplan-meier", sel({ x: 0, y: 1, byCol: 2 }), grouped)).toEqual([0, 1, 2]);
    expect(testColumns("kaplan-meier", sel({ x: 0, y: 1, byCol: 2 }))).toEqual([0, 1]);
  });

  it("refuses negative times, non-0/1 events, all-censored data and the same column twice", () => {
    expect(buildTestRequest("kaplan-meier", data, sel({ x: 4, y: 1 }), DEFAULT_PARAMS)).toEqual({
      ok: false, error: "badtime has negative times; follow-up time must be 0 or more.",
    });
    expect(buildTestRequest("kaplan-meier", data, sel({ x: 0, y: 5 }), DEFAULT_PARAMS)).toEqual({
      ok: false, error: "badevent must be coded 0/1 (0 = censored, 1 = event); it has other values.",
    });
    const censored: DataStruct = { ...data, values: data.values.map((r) => [r[0], 0, ...r.slice(2)]) };
    expect(buildTestRequest("kaplan-meier", censored, sel({ x: 0, y: 1 }), DEFAULT_PARAMS)).toMatchObject({
      ok: false, error: expect.stringContaining("no events"),
    });
    expect(buildTestRequest("kaplan-meier", data, sel({ x: 0, y: 0 }), DEFAULT_PARAMS)).toMatchObject({ ok: false });
    expect(buildTestRequest("kaplan-meier", data, sel({ x: 0, y: 1, byCol: 1 }), grouped)).toMatchObject({ ok: false });
  });

  it("refuses a group that is all censored instead of dropping it", () => {
    const d: DataStruct = { ...data, values: data.values.map((r, i) => [r[0], i < 3 ? 0 : r[1], ...r.slice(2)]) };
    expect(buildTestRequest("kaplan-meier", d, sel({ x: 0, y: 1, byCol: 2 }), grouped)).toMatchObject({
      ok: false, error: expect.stringContaining('Group "placebo" has no events'),
    });
  });
});

describe("log-rank request", () => {
  it("always groups, and needs 2+ groups with 2+ rows each", () => {
    expect(buildTestRequest("logrank", data, sel({ x: 0, y: 1, byCol: 2 }), DEFAULT_PARAMS)).toMatchObject({
      ok: true, request: { id: "logrank", body: { groups: [{ label: "placebo" }, { label: "drug" }] } }, labels: ["time", "event", "arm"],
    });
    const one: DataStruct = { ...data, values: data.values.map((r) => [r[0], r[1], 0, ...r.slice(3)]) };
    expect(buildTestRequest("logrank", one, sel({ x: 0, y: 1, byCol: 2 }), DEFAULT_PARAMS)).toMatchObject({
      ok: false, error: expect.stringContaining("at least 2 groups"),
    });
    const thin: DataStruct = { ...data, values: data.values.map((r, i) => [r[0], r[1], i === 0 ? 0 : 1, ...r.slice(3)]) };
    expect(buildTestRequest("logrank", thin, sel({ x: 0, y: 1, byCol: 2 }), DEFAULT_PARAMS)).toMatchObject({
      ok: false, error: expect.stringContaining("only 1 usable row"),
    });
  });

  it("refuses a group column with too many distinct values", () => {
    const wide: DataStruct = {
      ...data,
      time: Array.from({ length: 13 }, (_, i) => i),
      values: Array.from({ length: 13 }, (_, i) => [i + 1, 1, 0, i, 0, 0]),
    };
    expect(buildTestRequest("logrank", wide, sel({ x: 0, y: 1, byCol: 3 }), DEFAULT_PARAMS)).toMatchObject({
      ok: false, error: expect.stringContaining("at most 12"),
    });
  });

  it("clients: one KM call per group; log-rank sends parallel lists and keeps group names", async () => {
    post.mockResolvedValue({ times: [0], survival: [1], ciLow: [1], ciHigh: [1], atRisk: [3], events: [0], medianSurvival: null, medianCiLow: null, medianCiHigh: null, N: 3 });
    const km = await statsKaplanMeier({ groups: [{ label: "a", time: [1, 2, 3], event: [1, 0, 1] }, { label: "b", time: [4, 5], event: [1, 1] }] });
    expect(post.mock.calls.map((c) => c[0])).toEqual(["/api/stats/kaplan-meier", "/api/stats/kaplan-meier"]);
    expect(post.mock.calls[1][1]).toEqual({ time: [4, 5], event: [1, 1] });
    expect(km.groups.map((g) => g.label)).toEqual(["a", "b"]);
    post.mockReset().mockResolvedValue({ statistic: 16.79, pValue: 4e-5, dof: 1, observed: [9, 21], N: [21, 21] });
    const lr = await statsLogrank({ groups: [{ label: "6-MP", time: [1, 2], event: [1, 0] }, { label: "placebo", time: [3, 4], event: [1, 1] }] });
    expect(post.mock.calls[0].slice(0, 2)).toEqual(["/api/stats/logrank-groups", { times: [[1, 2], [3, 4]], events: [[1, 0], [1, 1]] }]);
    expect(lr.labels).toEqual(["6-MP", "placebo"]);
  });
});

describe("Cox request", () => {
  it("sends time, event and predictor columns over complete rows", () => {
    expect(buildTestRequest("cox-ph", data, sel({ x: 0, y: 1, cols: [3, 0, 1] }), DEFAULT_PARAMS)).toEqual({
      ok: true,
      request: { id: "cox-ph", body: { time: [5, 6, 7, 8, 9, 10, 12], event: [1, 0, 1, 1, 0, 1, 1], predictors: [[1.5, 2.5, 2, 4.5, 3, 6.5, 2.2]] } },
      labels: ["time", "event", "dose"],
    });
    expect(testColumns("cox-ph", sel({ x: 0, y: 1, cols: [3, 0, 1] }))).toEqual([0, 1, 3]);
  });

  it("refuses when no predictor is left and when events are not 0/1", () => {
    expect(buildTestRequest("cox-ph", data, sel({ x: 0, y: 1, cols: [0, 1] }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("predictor") });
    expect(buildTestRequest("cox-ph", data, sel({ x: 0, y: 5, cols: [3] }), DEFAULT_PARAMS)).toMatchObject({ ok: false, error: expect.stringContaining("0/1") });
  });
});

describe("survival readings", () => {
  it("reads alpha-free (fixed 95% intervals)", () => {
    for (const id of ["kaplan-meier", "logrank", "cox-ph"] as const) expect(testUsesAlpha(id)).toBe(false);
  });

  const curve = (over: object) => ({
    times: [0, 6, 7], survival: [1, 0.857, 0.807], ciLow: [1, 0.62, 0.56], ciHigh: [1, 0.95, 0.92], atRisk: [21, 21, 17], events: [0, 3, 1],
    medianSurvival: 23, medianCiLow: 13, medianCiHigh: null, N: 21, ...over,
  });

  it("Kaplan-Meier: median with CI, at-risk table, and 'not reached'", () => {
    const out = describeResult({ id: "kaplan-meier", data: { groups: [{ label: "", curve: curve({}) }] } }, ["time", "event"], 0.05);
    expect(out.sentence).toBe("Kaplan-Meier: median survival in time units is 23 (95% CI 13 to not reached), from 21 rows with 4 events.");
    expect(out.tables[0].rows).toEqual([["all rows", 21, 4, 23, 13, "not reached"]]);
    expect(out.tables[1].columns).toEqual(["time", "at risk", "events", "S(t)", "95% CI low", "95% CI high"]);
    expect(out.tables[1].rows[1]).toEqual([6, 21, 3, 0.857, 0.62, 0.95]);
    const none = describeResult({ id: "kaplan-meier", data: { groups: [{ label: "A", curve: curve({ medianSurvival: null, medianCiLow: null }) }, { label: "B", curve: curve({}) }] } }, ["time", "event", "arm"], 0.05);
    expect(none.sentence).toContain("A not reached (survival stays above 50%");
    expect(none.tables).toHaveLength(3);
  });

  it("log-rank: significant and not", () => {
    const data = { statistic: 16.79, pValue: 4.2e-5, dof: 1, observed: [9, 21], N: [21, 21], labels: ["6-MP", "placebo"] };
    expect(describeResult({ id: "logrank", data }, [], 0.05).sentence).toBe(
      "Log-rank test across 2 groups, χ²(1) = 16.8, p < 0.0001: survival differs between 6-MP and placebo at the 5% level.",
    );
    expect(describeResult({ id: "logrank", data: { ...data, pValue: 0.4 } }, [], 0.05).sentence).toContain("no evidence survival differs");
  });

  it("Cox: hazard ratios are exp(coefficient), including the CI", () => {
    const data = { coeffs: [1.572], se: [0.412], zStats: [3.81], pValues: [0.00014], ciLow: [0.764], ciHigh: [2.38], concordanceIndex: 0.69, logLikelihood: -85, AIC: 172, N: 42 };
    const out = describeResult({ id: "cox-ph", data }, ["time", "event", "placebo"], 0.05);
    expect(out.sentence).toContain("placebo (HR 4.82, p = 0.00014)");
    const hr = out.tables[1].rows[0] as number[];
    expect(hr[1]).toBeCloseTo(4.816, 2);
    expect(hr[2]).toBeCloseTo(Math.exp(0.764), 6);
  });
});
