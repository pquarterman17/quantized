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
  // Region rows only, and only the species' finite samples (as calc.sims_region does).
  const keep = body.dataset.time.map((t, i) => t >= body.lo && t <= body.hi && Number.isFinite(body.dataset.values[i][c]));
  const x = body.dataset.time.filter((_, i) => keep[i]);
  const y = body.dataset.values.filter((_, i) => keep[i]).map((r) => r[c]);
  if (!x.length) return Promise.reject(new Error("no rows lie in the region"));
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
    ["a blank between measured reference values", () => computeSimsAlign(params(), inputs(["a", A], ["b", { ...B, values: B.values.map((r, i) => (i === 2 ? [NaN, r[1]] : r)) }])), "blank or non-finite"],
    ["a reference species with no values", () => computeSimsAlign(params(), inputs(["a", A], ["b", { ...B, values: B.values.map((r) => [NaN, r[1]]) }])), "no finite values"],
  ])("refuses %s", async (_n, run, text) => {
    await expect(run()).rejects.toThrow(text);
    expect(compareSims).not.toHaveBeenCalled();
  });

  it("accepts blanks at the ends of the reference's range (a union-grid end), as the region measures do", async () => {
    const ends = { ...B, values: B.values.map((r, i) => (i === 0 || i === 5 ? [NaN, r[1]] : r)) };
    const r = await computeSimsAlign(params(), inputs(["a", A], ["b", ends]));
    expect(r.shifts[1].shift).toBe(2);
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

describe("alignment lands the reference feature at the primary's depth", () => {
  /** The reference species' peak and junction depth of what was SENT to the comparison, per profile. */
  const landed = async (): Promise<{ peak: number; junction: number | null }[]> => {
    const sent = vi.mocked(compareSims).mock.calls[0][0].profiles;
    const out = [];
    for (const pr of sent) {
      const col = pr.dataset.labels.indexOf("B");
      const m = (await fakeRegion({ dataset: pr.dataset, columns: [col], lo: -1e9, hi: 1e9, threshold_mode: "fraction", threshold: 0.5 } as SimsRegionRequest)).species[0];
      out.push({ peak: m.peak_depth as number, junction: m.junction_depth as number | null });
    }
    return out;
  };
  /** Different length, different grid, a different column order, a peak elsewhere. */
  const other = (): DataStruct => {
    const time = [10, 12, 14, 16, 18, 20, 22, 24];
    return {
      time, values: time.map((d) => [100, Math.max(0, 10 - 2 * Math.abs(d - 18))]),
      labels: ["Si", "B"], units: ["c/s", "c/s"], metadata: { x_column_unit: "nm" },
    };
  };

  it.each(["peak", "junction"] as const)("%s: every profile's feature sits at the first profile's depth", async (by) => {
    await computeSimsAlign(params({ by, with: [{ id: "b", name: "b.csv" }, { id: "o", name: "o.csv" }] }), inputs(["a", A], ["b", B], ["o", other()]));
    const l = await landed();
    const key = by === "peak" ? "peak" : "junction";
    expect(l).toHaveLength(3);
    const first = l[0][key] as number;
    expect(first).not.toBeNull();
    for (const x of l) expect(x[key]).toBeCloseTo(first, 9);
    // The primary is the fixed point and the others really moved.
    expect(l[0][key]).toBeCloseTo(by === "peak" ? 1 : 2.25, 9);
  });

  it("a region covering only part of a profile aligns on the feature inside it, not the global one", async () => {
    const time = [3, 5, 7, 9, 11, 13, 15, 17];
    const partial: DataStruct = {
      time, values: [1, 2, 10, 2, 1, 3, 20, 3].map((v) => [v, 100]),
      labels: ["B", "Si"], units: ["c/s", "c/s"], metadata: { x_column_unit: "nm" },
    };
    const r = await computeSimsAlign(params({ region: { lo: 0, hi: 10 }, with: [{ id: "o", name: "o.csv" }] }), inputs(["a", A], ["o", partial]));
    expect(r.shifts.map((s) => s.referenceDepth)).toEqual([1, 7]);
    expect(r.shifts[1].shift).toBe(6);
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

  it("a repeat is deduped: nothing new is created, recorded or put on the undo stack", async () => {
    await commitTransformOutput(useApp.getState, params(), "a");
    const again = await commitTransformOutput(useApp.getState, params(), "a");
    expect(again?.existing).toBe(true);
    expect(useApp.getState().datasets).toHaveLength(4);
    expect(useApp.getState().macroSteps.filter((s) => s.kind === "transform")).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(1);
  });

  it("replaying on the same inputs reproduces the identical output", async () => {
    await commitTransformOutput(useApp.getState, params(), "a");
    const first = useApp.getState().datasets[3];
    const replay = await runTransform(useApp.getState, params(), "a");
    const second = useApp.getState().datasets.find((d) => d.id === replay?.outputs[0].id);
    expect(second?.data).toEqual(first.data);
    expect(second?.name).toBe(first.name);
  });

  it("changing either input marks the output out of date", async () => {
    for (const touched of ["a", "b"]) {
      useApp.setState({ analysisResults: [], staleDatasets: [], datasets: useApp.getState().datasets.slice(0, 3) });
      await commitTransformOutput(useApp.getState, params(), "a");
      const out = useApp.getState().datasets[3].id;
      expect(useApp.getState().analysisResults[0]!.sources.map((x) => x.datasetId)).toEqual(["a", "b"]);
      useApp.getState().touchDataset(touched);
      expect(useApp.getState().staleDatasets).toEqual([out]);
    }
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
