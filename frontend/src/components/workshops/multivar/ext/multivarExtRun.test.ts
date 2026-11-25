import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../../lib/types";
import { DEFAULT_EXT_OPTIONS, parseNumberList, prepareExt, runExt, type ExtOptions } from "./multivarExtRun";

const api = vi.hoisted(() => ({ statsPls: vi.fn(), statsLda: vi.fn(), statsPcaSpectra: vi.fn() }));
vi.mock("../../../../lib/api/multivarExt", () => api);

beforeEach(() => vi.clearAllMocks());

// 8 rows; columns: 0 = a, 1 = b, 2 = y, 3 = class. Row 5 has a blank in b.
const rows = [[1, 2, 5, 0], [2, 1, 4, 0], [3, 5, 9, 0], [4, 3, 8, 1], [5, 7, 14, 1], [6, Number.NaN, 7, 1], [7, 4, 12, 1], [8, 9, 20, 1]];
const data: DataStruct = { time: rows.map((_, i) => 100 + i), values: rows, labels: ["a", "b", "y", "k"], units: ["", "", "", ""], metadata: {} };
const label = (c: number) => ["a", "b", "y", "k"][c] ?? "x";
const o = (patch: Partial<ExtOptions>): ExtOptions => ({ ...DEFAULT_EXT_OPTIONS, ...patch });
const pls = (patch: Partial<ExtOptions["pls"]>) => o({ pls: { ...DEFAULT_EXT_OPTIONS.pls, ...patch } });

describe("prepareExt PLS (columns are variables)", () => {
  it("asks for a response and for predictors", () => {
    expect(prepareExt("pls", data, [0, 1], null, label, pls({}))).toMatchObject({ problem: expect.stringMatching(/response/) });
    expect(prepareExt("pls", data, [2], null, label, pls({ y: [2] }))).toMatchObject({ problem: expect.stringMatching(/predictor/) });
  });
  it("builds the request from listwise-complete rows, dropping the response from the predictors", () => {
    const p = prepareExt("pls", data, [0, 1, 2], [0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * 10), label, pls({ y: [2], folds: 3, seed: 4 }));
    if (p.problem !== null) throw new Error(p.problem);
    expect(p.request.tool).toBe("pls");
    const body = p.request.body as { x: number[][]; y: number[][]; folds: number; seed: number; n_components?: number };
    expect(body.x).toHaveLength(7);
    expect(body.x[0]).toEqual([1, 2]);
    expect(body.y[0]).toEqual([5]);
    expect(body).toMatchObject({ folds: 3, seed: 4, preprocess: "center" });
    expect(body.n_components).toBeUndefined();
    expect(p.meta.dropped).toBe(1);
    expect(p.meta.sourceRows).toEqual([1, 11, 21, 31, 41, 61, 71]);
    expect(p.meta.yLabels).toEqual(["y"]);
  });
  it("sends a fixed component count only when asked, and validates the options", () => {
    const p = prepareExt("pls", data, [0, 1, 2], null, label, pls({ y: [2], fixed: 2 }));
    expect(p.problem === null && (p.request.body as { n_components?: number }).n_components).toBe(2);
    expect(prepareExt("pls", data, [0, 1, 2], null, label, pls({ y: [2], folds: 1 }))).toMatchObject({ problem: expect.stringMatching(/Folds/) });
    expect(prepareExt("pls", data, [0, 1, 2], null, label, pls({ y: [2], folds: 50 }))).toMatchObject({ problem: expect.stringMatching(/exceed/) });
    expect(prepareExt("pls", data, [0, 1, 2], null, label, pls({ y: [2], maxComp: 0 }))).toMatchObject({ problem: expect.stringMatching(/Maximum components/) });
  });
});

describe("prepareExt PLS (columns are spectra)", () => {
  const sp = (yText: string) => pls({ orientation: "spectra", yText, folds: 2 });
  it("needs one finite response per spectrum", () => {
    expect(prepareExt("pls", data, [0, 1, 2, 3], null, label, sp("1,2,3"))).toMatchObject({ problem: expect.stringMatching(/Enter 4 finite/) });
    expect(prepareExt("pls", data, [0, 1, 2, 3], null, label, sp("1 2 x 4"))).toMatchObject({ problem: expect.stringMatching(/Enter 4 finite/) });
    expect(prepareExt("pls", data, [0, 1, 2], null, label, sp("1,2,3"))).toMatchObject({ problem: expect.stringMatching(/at least 4 spectra/) });
  });
  it("transposes so each spectrum is a row, with the worksheet X as the variable axis", () => {
    const p = prepareExt("pls", data, [0, 2, 3, 0], null, label, sp("0.1; 0.2, 0.3 0.4"));
    if (p.problem !== null) throw new Error(p.problem);
    const body = p.request.body as { x: number[][]; y: number[][] };
    expect(body.x).toHaveLength(4);
    expect(body.x[0]).toHaveLength(8);
    expect(body.x[1].slice(0, 3)).toEqual([5, 4, 9]);
    expect(body.y).toEqual([[0.1], [0.2], [0.3], [0.4]]);
    expect(p.meta.varX).toEqual(data.time);
    expect(p.meta.obsLabels).toEqual(["a", "y", "k", "a"]);
  });
});

describe("prepareExt LDA and spectra PCA", () => {
  it("requires a class column with 2 to 20 classes and builds labels from it", () => {
    expect(prepareExt("lda", data, [0, 1], null, label, o({}))).toMatchObject({ problem: expect.stringMatching(/class column/) });
    expect(prepareExt("lda", data, [3], null, label, o({ lda: { ...DEFAULT_EXT_OPTIONS.lda, classCol: 3 } }))).toMatchObject({ problem: expect.stringMatching(/variable/) });
    expect(prepareExt("lda", data, [0, 1], null, label, o({ lda: { ...DEFAULT_EXT_OPTIONS.lda, classCol: 2 } }))).toMatchObject({ problem: expect.stringMatching(/distinct values/) });
    const p = prepareExt("lda", data, [0, 1, 3], null, label, o({ lda: { ...DEFAULT_EXT_OPTIONS.lda, classCol: 3 } }));
    if (p.problem !== null) throw new Error(p.problem);
    expect((p.request.body as { labels: number[] }).labels).toEqual([0, 0, 0, 1, 1, 1, 1]);
    expect((p.request.body as { x: number[][] }).x[0]).toEqual([1, 2]);
  });
  it("spectra PCA sends every selected column on the one worksheet grid", () => {
    expect(prepareExt("spectra", data, [0], null, label, o({}))).toMatchObject({ problem: expect.stringMatching(/at least 2/) });
    const p = prepareExt("spectra", data, [0, 2], null, label, o({}));
    if (p.problem !== null) throw new Error(p.problem);
    const body = p.request.body as { spectra_x: number[][]; spectra_y: number[][]; resample?: boolean };
    expect(body.spectra_x).toHaveLength(2);
    expect(body.spectra_x[0]).toEqual(body.spectra_x[1]);
    expect(body.spectra_y[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(body.resample).toBeUndefined();
  });
});

describe("helpers", () => {
  it("parses a list separated by commas, semicolons or spaces", () => {
    expect(parseNumberList(" 1, 2;3  4 ")).toEqual([1, 2, 3, 4]);
    expect(parseNumberList("")).toEqual([]);
  });
  it("dispatches each tool to its route", async () => {
    api.statsPls.mockResolvedValue({ n: 1 });
    api.statsLda.mockResolvedValue({ n: 2 });
    api.statsPcaSpectra.mockResolvedValue({ n_spectra: 3 });
    expect(await runExt({ tool: "pls", body: { x: [], y: [] } })).toEqual({ tool: "pls", data: { n: 1 } });
    expect(await runExt({ tool: "lda", body: { x: [], labels: [] } })).toEqual({ tool: "lda", data: { n: 2 } });
    expect(await runExt({ tool: "spectra", body: { spectra_x: [], spectra_y: [] } })).toEqual({ tool: "spectra", data: { n_spectra: 3 } });
  });
});
