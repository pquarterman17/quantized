// P2.5 box 4 — what a saved transformation recipe expects of its input.

import { describe, expect, it } from "vitest";

import { makeStep, type PipelineStep } from "./pipeline";
import {
  deriveExpectations,
  expectationsText,
  inputColumnRefs,
  letterIndex,
  recordingInputId,
  sanitizeExpectations,
} from "./recipeExpect";
import type { Dataset } from "./types";

const EXAMPLE: Dataset = {
  id: "ex",
  name: "ex.dat",
  data: {
    time: [0, 1],
    values: [[1, 2, 3, 4], [5, 6, 7, 8]],
    labels: ["T", "M", "R", "V"],
    units: ["K", "emu", "ohm", "V"],
    metadata: { instrument: { sample: "S1" } },
  },
};

const transform = (params: Record<string, unknown>, enabled = true): PipelineStep => ({
  ...makeStep("transform", `t ${String(params.op)}`, "", params),
  enabled,
});
const expr = (name: string, e: string) => makeStep("expression", `Add column ${name}`, "", { name, expr: e });

describe("letterIndex", () => {
  it("inverts channelLetter and rejects anything else", () => {
    expect([letterIndex("A"), letterIndex("Z"), letterIndex("AA"), letterIndex("AB")]).toEqual([0, 25, 26, 27]);
    expect(letterIndex("x")).toBeNull();
    expect(letterIndex("A1")).toBeNull();
  });
});

describe("inputColumnRefs — only the steps that read the INPUT", () => {
  it("collects stack channels, expression letters and fit keys up to the first deriving step", () => {
    const steps = [
      expr("d", "B * 2"),
      makeStep("fit", "Fit", "", { model: "Linear", yKey: 2, xKey: null }),
      transform({ op: "stack", channels: [0, 3] }),
      // After the stack: reads the STACK's output, not the input.
      transform({ op: "unstack", key: 0, category: 1, value: 2, aggregate: "mean" }),
    ];
    const r = inputColumnRefs(steps);
    expect(r.all).toBe(false);
    expect([...r.cols].sort()).toEqual([0, 1, 2, 3]);
  });

  it("a weighted fit's σ column is an input too", () => {
    const fit = makeStep("fit", "Fit", "", { model: "Linear", yKey: 1, xKey: 0, weight: { mode: "yerr", errKey: 3 } });
    expect([...inputColumnRefs([fit]).cols].sort()).toEqual([0, 1, 3]);
  });

  it("a whole-table op requires every column; append BY NAME and resample need none", () => {
    expect(inputColumnRefs([transform({ op: "transpose" })]).all).toBe(true);
    expect(inputColumnRefs([transform({ op: "merge", with: [{ id: "o", name: "o" }] })]).all).toBe(true);
    expect(inputColumnRefs([transform({ op: "merge", with: [{ id: "o", name: "o" }], match: "name" })]).all).toBe(false);
    expect(inputColumnRefs([transform({ op: "resample", mode: "n_points", nPoints: 5 })]).cols.size).toBe(0);
  });

  it("skips disabled steps and a step that reads a recorded dataset, not the target", () => {
    expect(inputColumnRefs([transform({ op: "split", col: 2, tolerance: null }, false)]).cols.size).toBe(0);
    expect(inputColumnRefs([transform({ op: "stack", channels: [1], inputIsTarget: false })]).cols.size).toBe(0);
  });

  it("an expression that does not compile requires everything (cannot tell)", () => {
    expect(inputColumnRefs([expr("d", "A +")]).all).toBe(true);
  });

  it("a sims step resolves its BY-NAME reference/RSF/keep columns against the given labels (finding 6)", () => {
    const sims = transform({
      op: "sims",
      background: { lo: 0, hi: 1, keep: ["T"] },
      normalization: { reference: "R", rsf: { M: 1 } },
    });
    // Without labels there is nothing to resolve names against.
    expect(inputColumnRefs([sims]).cols.size).toBe(0);
    expect([...inputColumnRefs([sims], ["T", "M", "R"]).cols].sort()).toEqual([0, 1, 2]);
    // A name absent from the given labels resolves to nothing (not -1).
    expect([...inputColumnRefs([sims], ["T"]).cols]).toEqual([0]);
  });
});

describe("deriveExpectations", () => {
  it("lays out the example's columns up to the last one a step reads, with units", () => {
    const e = deriveExpectations([transform({ op: "stack", channels: [1] })], EXAMPLE);
    expect(e.columns).toEqual([
      { name: "T", unit: "K", required: false },
      { name: "M", unit: "emu", required: true },
    ]);
    expect(e.example).toBe("ex.dat");
    expect(expectationsText(e)).toBe("columns M (emu)");
  });

  it("leaves out the example's trailing columns the recipe itself added", () => {
    // Recorded on EXAMPLE: step 1 added `d` (now column 4), step 2 stacks A and d.
    const withOwn: Dataset = {
      ...EXAMPLE,
      data: { ...EXAMPLE.data, labels: [...EXAMPLE.data.labels, "d"], units: [...EXAMPLE.data.units, ""], values: [[1, 2, 3, 4, 2], [5, 6, 7, 8, 12]] },
      formulas: [{ name: "d", expr: "B * 2" }],
    };
    const e = deriveExpectations([expr("d", "B * 2"), transform({ op: "stack", channels: [0, 4] })], withOwn);
    expect(e.columns.map((c) => [c.name, c.required])).toEqual([["T", true], ["M", true]]);
  });

  it("declares a sims step's named reference column as required, and flags a missing time-unit x (finding 6)", () => {
    const simsStep = transform({ op: "sims", calibration: { method: "rate" }, normalization: { reference: "R" } });
    const e = deriveExpectations([simsStep], EXAMPLE);
    expect(e.columns).toEqual([
      { name: "T", unit: "K", required: false },
      { name: "M", unit: "emu", required: false },
      { name: "R", unit: "ohm", required: true },
    ]);
    // calibration has no STATED time-unit override -> the target's own x
    // must already be a time unit, or the run fails mid-replay.
    expect(e.needsTimeUnitX).toBe(true);
  });

  it("a stated calibration time-unit override needs no time-unit x", () => {
    const simsStep = transform({ op: "sims", calibration: { method: "rate", timeUnit: "s" }, normalization: { reference: "R" } });
    expect(deriveExpectations([simsStep], EXAMPLE).needsTimeUnitX).toBeUndefined();
  });

  it("a direct SIMS scale records its exact x unit instead of demanding a time unit", () => {
    const steps = [transform({ op: "sims", calibration: { method: "scale", scaleFactor: 0.001, offset: 0, inputUnit: "encoder counts" } })];
    const example = { ...EXAMPLE, data: { ...EXAMPLE.data, metadata: { x_column_unit: "encoder counts" } } };
    const e = deriveExpectations(steps, example);
    expect(e.needsTimeUnitX).toBeUndefined();
    expect(e.scaleInputUnit).toBe("encoder counts");
    expect(expectationsText(e)).toContain("x unit encoder counts");
    expect(sanitizeExpectations(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });

  it("a whole-table op lists every column as required; a promote step lists its metadata path", () => {
    const e = deriveExpectations(
      [transform({ op: "promote", path: ["instrument", "sample"], as: "categorical", name: "sample" }), transform({ op: "transpose" })],
      EXAMPLE,
    );
    expect(e.columns.every((c) => c.required)).toBe(true);
    expect(e.columns).toHaveLength(4);
    expect(e.metadata).toEqual([["instrument", "sample"]]);
    expect(expectationsText(e)).toContain("metadata instrument › sample");
  });
});

describe("sanitizeExpectations", () => {
  it("round-trips a valid block and rejects a malformed one", () => {
    const e = deriveExpectations([transform({ op: "stack", channels: [1] })], EXAMPLE);
    expect(sanitizeExpectations(JSON.parse(JSON.stringify(e)))).toEqual(e);
    expect(sanitizeExpectations({ columns: [{ name: "M" }], metadata: [] })).toBeUndefined();
    expect(sanitizeExpectations({ columns: [], metadata: [[]] })).toBeUndefined();
    expect(sanitizeExpectations("x")).toBeUndefined();
  });
});

describe("recordingInputId", () => {
  it("is the first deriving step's recorded input when loaded, else the fallback", () => {
    const steps = [transform({ op: "stack", channels: [1], input: { id: "ex", name: "ex.dat" }, inputIsTarget: true })];
    expect(recordingInputId(steps, new Set(["ex", "b"]), "b")).toBe("ex");
    expect(recordingInputId(steps, new Set(["b"]), "b")).toBe("b");
    expect(recordingInputId([expr("d", "A")], new Set(["ex"]), null)).toBeNull();
  });
});
