// Design of experiments' preset adapter: the shared contract plus what is
// specific to it (every option the form offers is accepted, the factor table,
// the k and factor-count rules, the hidden-field rule, nothing that names data).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { genericBackend } from "../../../lib/presets";
import { ALPHA_OPTIONS, BLOCK_OPTIONS, METHOD_OPTIONS, MODEL_OPTIONS, PB_RUN_COUNTS } from "./doeOptions";
import { createDoeAdapter, type DoePanelHandle } from "./presetAdapter";
import { DESIGN_OPTIONS, INITIAL_SETUP, factorRows, kRange, type DoeSetup } from "./useDoe";

const handle: DoePanelHandle = {
  setup: { ...INITIAL_SETUP, factors: factorRows(3, []) },
  update(patch) {
    const next = { ...handle.setup, ...patch };
    if (patch.design) {
      const [lo, hi] = kRange(patch.design);
      next.k = Math.min(hi, Math.max(lo, next.k));
    }
    next.factors = factorRows(next.k, next.factors);
    handle.setup = next;
  },
};
const adapter = createDoeAdapter(handle);

const sample: DoeSetup = {
  design: "d_optimal", k: 3, factors: [
    { name: "Temp", low: "100", high: "200", unit: "C", levels: "" },
    { name: "Gas", low: "-1", high: "1", unit: "", levels: "air, N2, Ar" },
    { name: "Time", low: "5", high: "30", unit: "min", levels: "" },
  ],
  responseName: "Yield", p: 2, runs: 20, replicates: "3", center: "4", alpha: "custom", alphaCustom: "1.7", ccdFractional: true, inscribed: true,
  randomize: false, seed: "42", blocks: "4", blockGens: "ABC, BCD", optModel: "quadratic", nRuns: "14", method: "fedorov", gridLevels: "3", optSeed: "7",
};

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "factors", value: "none" },
  outOfRange: { field: "optModel", value: "cubic" },
});

const parse = (patch: Record<string, unknown>) => adapter.parse({ ...sample, ...patch });
const factors = (n: number) => factorRows(n, []);

describe("DOE adapter specifics", () => {
  it("every option list the form offers is accepted, on the design that shows it", () => {
    for (const o of DESIGN_OPTIONS) {
      const [lo] = kRange(o.value);
      expect(parse({ design: o.value, k: lo, factors: factors(lo) }), o.value).not.toHaveProperty("error");
    }
    for (const o of ALPHA_OPTIONS) expect(parse({ design: "ccd", k: 3, factors: factors(3), alpha: o.value }), o.value).not.toHaveProperty("error");
    for (const o of BLOCK_OPTIONS) expect(parse({ design: "full_factorial", k: 3, factors: factors(3), blocks: o.value }), o.value).not.toHaveProperty("error");
    for (const o of MODEL_OPTIONS) expect(parse({ optModel: o.value }), o.value).not.toHaveProperty("error");
    for (const o of METHOD_OPTIONS) expect(parse({ method: o.value }), o.value).not.toHaveProperty("error");
    for (const n of PB_RUN_COUNTS) expect(parse({ design: "plackett_burman", k: 3, factors: factors(3), runs: n }), String(n)).not.toHaveProperty("error");
  });

  it("rejects each bad value with its field named, where the design shows it", () => {
    expect(parse({ design: "taguchi" })).toMatchObject({ error: expect.stringContaining("'design'") });
    expect(parse({ design: "plackett_burman", runs: 16 })).toMatchObject({ error: expect.stringContaining("'runs'") });
    expect(parse({ nRuns: "0" })).toMatchObject({ error: expect.stringContaining("'nRuns'") });
    expect(parse({ gridLevels: "12" })).toMatchObject({ error: expect.stringContaining("'gridLevels'") });
    expect(parse({ optSeed: "-1" })).toMatchObject({ error: expect.stringContaining("'optSeed'") });
    expect(parse({ design: "ccd", alpha: "custom", alphaCustom: "-2" })).toMatchObject({ error: expect.stringContaining("'alphaCustom'") });
    expect(parse({ design: "full_factorial", replicates: "0" })).toMatchObject({ error: expect.stringContaining("'replicates'") });
    expect(parse({ design: "full_factorial", blocks: "3" })).toMatchObject({ error: expect.stringContaining("'blocks'") });
    expect(parse({ design: "full_factorial", responseName: "x".repeat(61) })).toMatchObject({ error: expect.stringContaining("'responseName'") });
    expect(parse({ design: "fractional_factorial", p: 99 })).toMatchObject({ error: expect.stringContaining("'p'") });
  });

  it("the factor table: its fields, its count against k, and k against the design", () => {
    expect(parse({ factors: [...sample.factors.slice(0, 2)] })).toMatchObject({ error: expect.stringContaining("exactly 3") });
    expect(parse({ k: 4 })).toMatchObject({ error: expect.stringContaining("exactly 4") });
    expect(parse({ design: "box_behnken", k: 2, factors: factors(2) })).toMatchObject({ error: expect.stringContaining("'k'") });
    expect(parse({ factors: [{ ...sample.factors[0], low: "abc" }, sample.factors[1], sample.factors[2]] })).toMatchObject({ error: expect.stringContaining("'low'") });
    expect(parse({ factors: [{ ...sample.factors[0], extra: 1 }, sample.factors[1], sample.factors[2]] })).toMatchObject({ error: expect.stringContaining("'extra'") });
    expect(parse({ factors: [{ name: "A" }, sample.factors[1], sample.factors[2]] })).toMatchObject({ error: expect.stringContaining("'low'") });
    expect(adapter.parse({ ...sample, factors: undefined })).toMatchObject({ error: expect.stringContaining("'factors'") });
    const { factors: _f, ...noFactors } = sample;
    void _f;
    expect(adapter.parse(noFactors)).toMatchObject({ error: "setting 'factors' is missing" });
  });

  it("hidden knobs are neither refused nor stored: a refused value there never blocks Save", () => {
    // another design's options
    expect(parse({ design: "full_factorial", runs: 16, p: 99, alpha: "zzz", optModel: "zzz", nRuns: "0", gridLevels: "99", optSeed: "-9", method: "zzz" })).not.toHaveProperty("error");
    // inside one design: the custom alpha only under "custom", block generators only with blocks, the seed only when randomising
    expect(parse({ design: "ccd", alpha: "rotatable", alphaCustom: "-2" })).not.toHaveProperty("error");
    expect(parse({ design: "full_factorial", blocks: "1", blockGens: "x".repeat(81) })).not.toHaveProperty("error");
    expect(parse({ design: "full_factorial", blocks: "2", blockGens: "x".repeat(81) })).toMatchObject({ error: expect.stringContaining("'blockGens'") });
    expect(parse({ design: "full_factorial", randomize: false, seed: "-3" })).not.toHaveProperty("error");
    expect(parse({ design: "full_factorial", randomize: true, seed: "-3" })).toMatchObject({ error: expect.stringContaining("'seed'") });
    expect(parse({ design: "d_optimal", center: "abc" })).not.toHaveProperty("error");
    // a categorical D-optimal factor hides its low / high
    expect(parse({ factors: [sample.factors[0], { ...sample.factors[1], low: "air", high: "" }, sample.factors[2]] })).not.toHaveProperty("error");
    expect(parse({ design: "full_factorial", factors: [sample.factors[0], { ...sample.factors[1], low: "air" }, sample.factors[2]] })).toMatchObject({ error: expect.stringContaining("'low'") });
    // a wrong KIND of value is still refused where hidden
    expect(parse({ design: "full_factorial", nRuns: 5 })).toMatchObject({ error: expect.stringContaining("'nRuns'") });

    handle.setup = {
      ...INITIAL_SETUP, design: "full_factorial", factors: factorRows(3, []), runs: 16, nRuns: "0", alpha: "rotatable", alphaCustom: "-2", p: 99,
      randomize: false, seed: "-3", optSeed: "x",
    };
    const captured = adapter.capture();
    expect(captured).toMatchObject({ design: "full_factorial", runs: INITIAL_SETUP.runs, nRuns: INITIAL_SETUP.nRuns, alphaCustom: INITIAL_SETUP.alphaCustom, p: INITIAL_SETUP.p, seed: INITIAL_SETUP.seed });
    expect(adapter.parse(captured)).not.toHaveProperty("error");
    localStorage.clear();
    expect(genericBackend(adapter).save("hidden", captured)).toMatchObject({ ok: true });
    localStorage.clear();
    // a categorical factor's refused low / high are stored as -1 and 1
    handle.setup = { ...INITIAL_SETUP, design: "d_optimal", k: 2, factors: [{ name: "Gas", low: "air", high: "zzz", unit: "", levels: "air, N2" }, { name: "B", low: "-1", high: "1", unit: "", levels: "" }] };
    expect(adapter.capture().factors[0]).toMatchObject({ low: "-1", high: "1", levels: "air, N2" });
  });

  it("an Apply keeps what the form holds in place of a refused hidden value", () => {
    handle.setup = { ...INITIAL_SETUP, factors: factorRows(3, []), nRuns: "9" };
    adapter.apply({ ...sample, design: "full_factorial", nRuns: "0", factors: factors(3) });
    expect(handle.setup).toMatchObject({ design: "full_factorial", nRuns: "9" });
  });

  it("stores nothing that names data", () => {
    expect(Object.keys(adapter.capture()).sort()).toEqual(Object.keys(sample).sort());
    expect(adapter.parse({ ...sample, datasetId: "d1" })).toMatchObject({ error: expect.stringContaining("'datasetId'") });
  });
});
