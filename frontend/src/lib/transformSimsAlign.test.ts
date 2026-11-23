// The recordable `simsalign` transform: validation of a recorded step, the
// shift arithmetic (reference depths come from the backend's region measures),
// the commit through commitTransformOutput (one undo entry, one replayable
// step, xKey null), replay, abort, and every fail-closed refusal.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SimsCompareRequest, SimsCompareResult, SimsRegionRequest, SimsRegionResult } from "./api/sims";
import { inputColumnRefs } from "./recipeExpect";
import { makeStep } from "./pipeline";
import { runTransform, transformParamsOf, transformStepText } from "./transformRun";
import { computeSimsAlign, simsAlignParamsOf, type SimsAlignParams } from "./transformSimsAlign";
import type { DataStruct } from "./types";
import { INPUTS_PARAM } from "./resultInputsRecord";
import { commitTransformOutput } from "../store/commitTransformOutput";
import { useApp } from "../store/useApp";

vi.mock("./api/sims", () => ({ compareSims: vi.fn(), processSims: vi.fn(), measureSimsRegion: vi.fn() }));
const { compareSims, measureSimsRegion } = await import("./api/sims");

/** Stand-in for calc.sims_region: peak depth, and the first falling crossing at/after it. */
function fakeRegion(body: SimsRegionRequest): Promise<SimsRegionResult> {
  const c = body.columns?.[0] ?? 0;
  const x = body.dataset.time;
  const y = body.dataset.values.map((r) => r[c]);
  const k = y.indexOf(Math.max(...y));
  const level = body.threshold_mode === "fraction" ? (body.threshold ?? 0.5) * y[k] : (body.threshold ?? 0);
  let junction: number | null = null;
  for (let i = k; i < y.length - 1 && junction === null; i++) {
    if (y[i] > level && y[i + 1] <= level) junction = x[i] + ((level - y[i]) * (x[i + 1] - x[i])) / (y[i + 1] - y[i]);
  }
  const species = { name: body.dataset.labels[c], unit: "c/s", points: y.length, blank: 0, peak: y[k], peak_depth: x[k], junction_depth: junction, crossings: [] };
  return Promise.resolve({ x_unit: "nm", species: [species], warnings: [] } as unknown as SimsRegionResult);
}

function fakeCompare(body: SimsCompareRequest): Promise<SimsCompareResult> {
  const time = body.profiles.flatMap((p) => p.dataset.time);
  return Promise.resolve({
    dataset: { time, values: time.map(() => [1]), labels: ["t"], units: ["c/s"], metadata: { technique: "sims" } },
    warnings: [],
    traces: [],
  });
}

const prof = (peakAt: number, extra: Partial<DataStruct["metadata"]> = {}, labels = ["B", "Si"]): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5],
  values: [0, 1, 2, 3, 4, 5].map((d) => [Math.max(0, 10 - 4 * Math.abs(d - peakAt)), 100]).map((r) => (labels.length === 2 ? r : r.slice(0, 1))),
  labels, units: labels.map(() => "c/s"), metadata: { x_column_unit: "nm", ...extra },
});
const A = prof(1);
const B = prof(3);
const params = (over: Partial<SimsAlignParams> = {}): SimsAlignParams => ({
  op: "simsalign", reference: "B", by: "peak", species: ["B"], with: [{ id: "b", name: "b.csv" }], ...over,
});
const inputs = (...d: [string, DataStruct][]) => d.map(([id, data]) => ({ id, name: `${id}.csv`, data }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(measureSimsRegion).mockImplementation(fakeRegion);
  vi.mocked(compareSims).mockImplementation(fakeCompare);
  useApp.setState({
    datasets: [{ id: "a", name: "a.csv", data: A }, { id: "b", name: "b.csv", data: B }, { id: "c", name: "c.csv", data: prof(2) }],
    folders: [], activeId: "a", selectedIds: ["a"], macroRecording: true, macroSteps: [], history: [], future: [], analysisResults: [], staleDatasets: [],
  });
});

describe("simsAlignParamsOf", () => {
  it("round-trips and refuses malformed steps", () => {
    const full = params({ by: "junction", threshold: { mode: "fraction", value: 0.4 }, region: { lo: 0, hi: 5 } });
    expect(simsAlignParamsOf(JSON.parse(JSON.stringify(full)))).toEqual(full);
    expect(() => simsAlignParamsOf({ ...params(), reference: "" })).toThrow("reference");
    expect(() => simsAlignParamsOf({ ...params(), by: "edge" })).toThrow("peak");
    expect(() => simsAlignParamsOf({ ...params(), species: ["Si"] })).toThrow("include the reference");
    expect(() => simsAlignParamsOf({ ...params(), with: [] })).toThrow("at least 2 profiles");
    expect(() => simsAlignParamsOf({ ...params(), threshold: { mode: "fraction", value: 0.5 } })).toThrow("junction");
    expect(() => simsAlignParamsOf({ ...params({ by: "junction" }), threshold: { mode: "fraction", value: 1.5 } })).toThrow("between 0 and 1");
    expect(() => simsAlignParamsOf({ ...params(), region: { lo: "x", hi: 1 } })).toThrow("region");
  });

  it("is a known op with a label, and declares its reference as an input column", () => {
    expect(transformParamsOf(JSON.parse(JSON.stringify(params())))).toEqual(params());
    expect(transformStepText(params(), "a.csv").label).toContain("align");
    const step = makeStep("transform", "x", "y", { ...params(), inputIsTarget: true });
    expect([...inputColumnRefs([step], ["Si", "B"]).cols]).toEqual([1]);
  });
});

describe("computeSimsAlign", () => {
  it("shifts the later profile's depth so the peak coincides (primary untouched)", async () => {
    const r = await computeSimsAlign(params(), inputs(["a", A], ["b", B]));
    expect(r.shifts.map((s) => [s.referenceDepth, s.shift])).toEqual([[1, 0], [3, 2]]);
    const sent = vi.mocked(compareSims).mock.calls[0][0].profiles;
    expect(sent[0].dataset.time).toEqual(A.time);
    expect(sent[1].dataset.time).toEqual([-2, -1, 0, 1, 2, 3]);
    expect((r.data.metadata.sims_align as { reference: string }).reference).toBe("B");
  });

  it("aligns on the junction depth, with the recorded threshold", async () => {
    const r = await computeSimsAlign(params({ by: "junction", threshold: { mode: "fraction", value: 0.5 } }), inputs(["a", A], ["b", B]));
    expect(r.shifts[1].shift).toBeCloseTo(2);
    expect(vi.mocked(measureSimsRegion).mock.calls[0][0]).toMatchObject({ threshold_mode: "fraction", threshold: 0.5, lo: 0, hi: 5 });
  });

  it.each([
    ["fewer than 2 profiles", () => computeSimsAlign(params(), inputs(["a", A])), "at least 2 profiles"],
    ["the same profile twice", () => computeSimsAlign(params(), inputs(["a", A], ["a", A])), "picked twice"],
    ["mixed depth units", () => computeSimsAlign(params(), inputs(["a", A], ["b", prof(3, { x_column_unit: "um" })])), "depth units differ"],
    ["a missing species", () => computeSimsAlign(params(), inputs(["a", A], ["b", prof(3, {}, ["Si"])])), 'has no species "B"'],
    ["a duplicated species", () => computeSimsAlign(params(), inputs(["a", A], ["b", prof(3, {}, ["B", "B"])])), "2 columns named"],
    ["a non-finite depth", () => computeSimsAlign(params(), inputs(["a", A], ["b", { ...B, time: [0, 1, NaN, 3, 4, 5] }])), "non-finite depth"],
    ["a blank reference value", () => computeSimsAlign(params(), inputs(["a", A], ["b", { ...B, values: B.values.map((r, i) => (i === 2 ? [NaN, r[1]] : r)) }])), "blank or non-finite"],
  ])("refuses %s", async (_n, run, text) => {
    await expect(run()).rejects.toThrow(text);
    expect(compareSims).not.toHaveBeenCalled();
  });

  it("refuses when no peak or no junction is found, naming the profile", async () => {
    vi.mocked(measureSimsRegion).mockImplementation(async (body) => {
      const r = await fakeRegion(body);
      return { ...r, species: r.species.map((s) => ({ ...s, peak_depth: null, junction_depth: null })) };
    });
    await expect(computeSimsAlign(params(), inputs(["a", A], ["b", B]))).rejects.toThrow("a.csv: no peak");
    await expect(computeSimsAlign(params({ by: "junction" }), inputs(["a", A], ["b", B]))).rejects.toThrow("a.csv: no junction");
    expect(compareSims).not.toHaveBeenCalled();
  });

  it("stops on an aborted signal", async () => {
    const c = new AbortController();
    c.abort();
    await expect(computeSimsAlign(params(), inputs(["a", A], ["b", B]), { signal: c.signal })).rejects.toThrow();
    expect(compareSims).not.toHaveBeenCalled();
  });
});

describe("committing and replaying", () => {
  it("commits one worksheet, one undo entry, one recorded step, with xKey null inputs", async () => {
    const out = await commitTransformOutput(useApp.getState, params(), "a");
    expect(out?.name).toBe("a + 1 (SIMS aligned)");
    expect(useApp.getState().datasets).toHaveLength(4);
    expect(useApp.getState().macroSteps.filter((s) => s.kind === "transform")).toHaveLength(1);
    // xKey null (depth is the time axis): each input records its depth range, not an X column.
    const items = (useApp.getState().analysisResults[0]!.parameters?.[INPUTS_PARAM] as { items: { xRange: unknown }[] }).items;
    expect(items.map((i) => i.xRange)).toEqual([[0, 5], [0, 5]]);
  });

  it("an abort before the commit leaves nothing", async () => {
    const c = new AbortController();
    c.abort();
    await expect(commitTransformOutput(useApp.getState, params(), "a", undefined, c.signal)).rejects.toThrow();
    expect(useApp.getState().datasets).toHaveLength(3);
    expect(useApp.getState().macroSteps).toHaveLength(0);
  });

  it("a declined review creates nothing", async () => {
    const out = await commitTransformOutput(useApp.getState, params(), "a", () => Promise.resolve(false));
    expect(out).toBeNull();
    expect(useApp.getState().datasets).toHaveLength(3);
  });

  it("replays through runTransform; a missing recorded profile is refused by name", async () => {
    const out = await runTransform(useApp.getState, params({ with: [{ id: "c", name: "c.csv" }] }), "a");
    expect(out?.outputs).toHaveLength(1);
    await expect(runTransform(useApp.getState, params({ with: [{ id: "gone", name: "gone.csv" }] }), "a")).rejects.toThrow("gone.csv");
  });
});
