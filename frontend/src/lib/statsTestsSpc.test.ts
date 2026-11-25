// Statistical-tests workshop — GAP_AUDIT_9 J14: SPC request building (row order,
// subgroup rules, no default spec limits), the readings, the saved-recipe round
// trip and the dispatcher routes.
import { afterEach, describe, expect, it, vi } from "vitest";

import { runStatsTest } from "./api/statsTests";
import { statisticalTestAnalysisResult, statisticalTestRecipe } from "./statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION, buildTestRequest, testColumns, testUsesAlpha, type TestParams, type TestSelection } from "./statsTests";
import { describeResult } from "./statsTestsResults";
import { DEFAULT_SPC, restoreSpc, spcSettings, type SpcParams } from "./statsTestsSpc";
import { describeSpc } from "./statsTestsResultsSpc";
import type { DataStruct } from "./types";

const post = vi.hoisted(() => vi.fn());
vi.mock("./api/http", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api/http")>()), postJSON: post }));
afterEach(() => post.mockReset());

// m = measurement (row 3 has a gap), s = subgroup id, n = sample sizes
const data: DataStruct = {
  time: [1, 2, 3, 4, 5, 6, 7, 8],
  values: [[5, 1, 100], [6, 1, 100], [7, 2, 100], [NaN, 2, 100], [8, 2, 100], [9, 3, 100], [4, 3, 100], [3, 3, 100]],
  labels: ["m", "s", "n"], units: ["", "", ""], metadata: {},
};
const sel = (over: Partial<TestSelection>): TestSelection => ({ ...DEFAULT_SELECTION, ...over });
const params = (spc: Partial<SpcParams>, over: Partial<TestParams> = {}): TestParams => ({ ...DEFAULT_PARAMS, ...over, spc: { ...DEFAULT_SPC, ...spc } });

describe("control chart request", () => {
  it("I-MR keeps worksheet order and drops non-finite rows", () => {
    expect(buildTestRequest("control-chart", data, sel({ x: 0 }), params({ chart: "imr", rules: { ...DEFAULT_SPC.rules, we1: true, we4: true } }))).toEqual({
      ok: true, labels: ["m"],
      request: { id: "control-chart", body: { chart: "imr", rules: ["we1", "we4"], run_length: 8, values: [5, 6, 7, 8, 9, 4, 3] } },
    });
  });

  it("subgroups by column keep first-appearance order; by size refuse an uneven split", () => {
    const byCol = buildTestRequest("control-chart", data, sel({ x: 0, byCol: 1 }), params({ chart: "xbar-r", subgroupMode: "column" }));
    expect(byCol.ok && (byCol.request.body as { subgroups: number[][] }).subgroups).toEqual([[5, 6], [7, 8], [9, 4, 3]]);
    const bySize = buildTestRequest("control-chart", data, sel({ x: 0 }), params({ chart: "xbar-s", subgroupMode: "size", subgroupSize: 3 }));
    expect(bySize).toEqual({ ok: false, error: expect.stringMatching(/7 usable rows do not divide into subgroups of 3/) });
    const ok = buildTestRequest("control-chart", data, sel({ x: 0 }), params({ chart: "xbar-r", subgroupSize: 7 }));
    expect(ok.ok && (ok.request.body as { subgroups: number[][] }).subgroups).toEqual([[5, 6, 7, 8, 9, 4, 3]]);
  });

  it("attribute charts take sizes from a column or one constant; same column twice is refused", () => {
    const col = buildTestRequest("control-chart", data, sel({ x: 0, y: 2 }), params({ chart: "p", sizeMode: "column" }));
    expect(col.ok && col.request.body).toMatchObject({ chart: "p", counts: [5, 6, 7, 8, 9, 4, 3], sizes: [100, 100, 100, 100, 100, 100, 100] });
    const k = buildTestRequest("control-chart", data, sel({ x: 0 }), params({ chart: "u", sizeMode: "constant", sampleSize: 2 }));
    expect(k.ok && (k.request.body as { sizes: number[] }).sizes).toEqual(Array(7).fill(2));
    const c = buildTestRequest("control-chart", data, sel({ x: 0 }), params({ chart: "c" }));
    expect(c.ok && c.request.body).toMatchObject({ chart: "c", counts: [5, 6, 7, 8, 9, 4, 3] });
    expect(buildTestRequest("control-chart", data, sel({ x: 0, y: 0 }), params({ chart: "p", sizeMode: "column" })).ok).toBe(false);
  });

  it("reads exactly the picked columns and reports the chart settings", () => {
    expect(testColumns("control-chart", sel({ x: 0, byCol: 1 }), params({ chart: "xbar-r", subgroupMode: "column" }))).toEqual([0, 1]);
    expect(testColumns("control-chart", sel({ x: 0 }), params({ chart: "imr" }))).toEqual([0]);
    expect(testUsesAlpha("control-chart")).toBe(false);
    expect(testUsesAlpha("capability")).toBe(true);
    expect(spcSettings("control-chart", params({ chart: "imr" }))).toEqual([["Chart", expect.stringContaining("I-MR")], ["Run rules", "none"]]);
  });
});

describe("capability request", () => {
  it("has NO default specification limit: refuses until one is entered", () => {
    const none = buildTestRequest("capability", data, sel({ x: 0 }), params({}));
    expect(none).toEqual({ ok: false, error: expect.stringMatching(/no default/) });
    const one = buildTestRequest("capability", data, sel({ x: 0 }), params({ usl: 12 }));
    expect(one.ok && one.request).toEqual({
      id: "capability",
      body: { values: [5, 6, 7, 8, 9, 4, 3], lsl: null, usl: 12, target: null, alpha: 0.05, sigma_method: "range" },
    });
  });

  it("sends subgroups when asked", () => {
    const r = buildTestRequest("capability", data, sel({ x: 0, byCol: 1 }), params({ lsl: 0, usl: 12, useSubgroups: true, subgroupMode: "column", sigmaMethod: "sd" }));
    expect(r.ok && r.request.body).toMatchObject({ sigma_method: "sd", subgroups: [[5, 6], [7, 8], [9, 4, 3]] });
  });
});

describe("readings, saved recipe and dispatcher", () => {
  const panel = (name: string, flagged: number[]) => ({
    name, values: [1, 2, 9], center: 3, ucl: [8, 8, 8], lcl: [0, 0, 0], beyond_limits: flagged, flagged,
    violations: flagged.length ? [{ rule: "we1", label: "1 point beyond 3 sigma", indices: flagged }] : [],
  });
  const chart = (flagged: number[]) => ({
    id: "control-chart" as const,
    data: { chart: "imr" as const, n_subgroups: 3, subgroup_size: 1, panels: [panel("Individuals", flagged), panel("Moving range", [])],
      sigma_within: 1, grand_mean: 3, dispersion_mean: 1, constants: { n: 2, d2: 1.128 }, out_of_control: flagged.length },
  });

  it("states stability or the signalling points, and attaches the picture data", () => {
    expect(describeResult(chart([]), ["m"], 0.05).sentence).toMatch(/no points beyond/);
    const out = describeResult(chart([2]), ["m"], 0.05);
    expect(out.sentence).toMatch(/Individuals chart point 3/);
    expect(out.spc?.kind).toBe("chart");
    expect(out.tables.map((t) => t.title)).toEqual(["Chart summary", "Individuals chart points", "Moving range chart points"]);
    expect(out.tables[1].rows[2]).toEqual([3, 9, 3, 0, 8, "yes", "we1"]);
  });

  it("capability reading lists indices with intervals and omits one-sided Cp", () => {
    const idx = { sigma: 2, cpk: 0.667, cpu: 0.667, cpl: 1.333, ci: { cp: null, cpk: [0.5, 0.8] as [number, number] } };
    const out = describeResult({
      id: "capability",
      data: {
        n: 50, mean: 16, lsl: 8, usl: 20, target: null, alpha: 0.05, within: idx, overall: { ...idx, ppk: 0.667, ppu: 0.667, ppl: 1.333 },
        cpm: null, within_method: "MR-bar / d2", ppm_within: { below: 0, above: 2000, total: 2000 }, ppm_overall: { below: 0, above: 2000, total: 2000 },
        histogram: { edges: [0, 1], counts: [3] }, normality_p: 0.4, ci_note: "approx",
      },
    }, [], 0.05);
    expect(out.sentence).toMatch(/Cpk = 0.667 \(within\), Ppk = 0.667/);
    const rows = out.tables[0].rows;
    expect(rows.map((r) => r[0])).toEqual(["Cpk (within)", "CPU (within)", "CPL (within)", "Ppk (overall)", "PPU (overall)", "PPL (overall)"]);
    expect(rows[0]).toEqual(["Cpk (within)", 0.667, 0.5, 0.8]);
    expect(out.tables[0].columns[2]).toBe("95% CI low");
  });

  it("round-trips the saved recipe; a pre-J14 result reopens with defaults; garbage is refused", () => {
    const p = params({ chart: "xbar-r", lsl: 1, usl: 9 });
    const result = statisticalTestAnalysisResult("r1", null, "control-chart", sel({ x: 0 }), p, ["m"], describeResult(chart([]), ["m"], 0.05));
    expect(statisticalTestRecipe(result)?.params.spc).toEqual(p.spc);
    const { spc: _spc, ...oldParams } = (result.parameters as { params: Record<string, unknown> }).params;
    void _spc;
    const legacy = { ...result, parameters: { ...result.parameters, params: oldParams } } as unknown as typeof result;
    expect(statisticalTestRecipe(legacy)?.params.spc).toEqual(DEFAULT_SPC);
    expect(restoreSpc({ ...DEFAULT_SPC, chart: "nope" })).toBeNull();
    expect(restoreSpc({ ...DEFAULT_SPC, lsl: "1" })).toBeNull();
    expect(restoreSpc(undefined)).toEqual(DEFAULT_SPC);
  });

  it("dispatches to the SPC routes", async () => {
    post.mockResolvedValue({ ok: 1 });
    await runStatsTest({ id: "control-chart", body: { chart: "imr", values: [1, 2, 3] } });
    await runStatsTest({ id: "capability", body: { values: [1, 2, 3], lsl: 0, usl: 5 } });
    expect(post.mock.calls.map((c) => c[0])).toEqual(["/api/stats/control-chart", "/api/stats/capability"]);
  });
});

describe("EWMA / CUSUM tables (UX audit P2-8)", () => {
  const panel = { name: "EWMA", values: [1, 2], center: 1, lcl: [0, 0], ucl: [2, 2], beyond_limits: [], flagged: [], violations: [] };
  const result = (chart: string, params: Record<string, number | string>) => ({
    id: "control-chart",
    data: { chart, n_subgroups: 2, subgroup_size: 1, grand_mean: 1, dispersion_mean: null, sigma_within: 1, constants: null, panels: [panel], params },
  }) as unknown as Parameters<typeof describeSpc>[0];

  it("labels parameters in words and drops the always-empty rules column", () => {
    const out = describeSpc(result("ewma", { lambda: 0.2, L: 3, target_source: "mean", sigma_source: "sd" }), 0.05);
    const keys = out.tables[0].rows.map((r) => r[0]);
    expect(keys).toEqual(expect.arrayContaining(["smoothing weight (λ)", "limit width L (σ)", "target source", "sigma source"]));
    expect(keys).not.toContain("lambda");
    expect(out.tables[1].columns).not.toContain("rules");
    expect(out.tables[1].rows[0]).toHaveLength(out.tables[1].columns.length);
  });

  it("keeps the rules column for run-rule charts", () => {
    const out = describeSpc(result("imr", {}), 0.05);
    expect(out.tables[1].columns).toContain("rules");
  });
});
