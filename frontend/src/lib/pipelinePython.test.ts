// lib/pipeline's pipelineToPython — the recorded pipeline as a runnable Python script (G4).
//
// The committed fixture `__fixtures__/pipelineScript.py` is this generator's
// output for STEPS below, and tests/test_pipeline_script.py EXECUTES that file
// end to end with the real `quantized.api` against fixture data. So a change
// here that breaks the script fails CI twice: the byte check below, then the
// Python run once the fixture is rewritten. Rewrite it after a deliberate
// change with `QZ_WRITE_FIXTURES=1 npx vitest run src/lib/pipelinePython.test.ts`.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { pipelineToPython, pipelineToScript, py } from "./pipeline";
import { makeStep, type PipelineStep } from "./pipelineStep";

const FIXTURE = join(__dirname, "__fixtures__", "pipelineScript.py");

/** import -> corrections -> a display step -> a fit -> an unmappable formula
 *  column -> a later correction that must NOT run on the wrong data. */
const STEPS: PipelineStep[] = [
  makeStep("import", "Import peak.csv", 'qz.import("peak.csv")', { name: "peak.csv" }),
  makeStep("correction", "Corrections → peak", "", { params: { yOff: -2, yScale: 0.5 }, bg: null }),
  makeStep("ui", "Y axis log", "qz.setYLog(true)"),
  makeStep("fit", "Fit Gaussian", 'qz.fit("Gaussian")', { model: "Gaussian", yKey: 0, xKey: null, range: [2, 8], nPoints: 61, statsVersion: 2 }),
  { ...makeStep("ui", "Grid", "qz.setShowGrid(true)"), enabled: false },
  makeStep("expression", "Add column twice", 'qz.addColumn("twice", "A * 2")', { name: "twice", expr: "A * 2" }),
  makeStep("correction", "Corrections → peak", "", { params: { xOff: 1 }, bg: null }),
];

describe("pipelineToPython", () => {
  it("matches the committed fixture that tests/test_pipeline_script.py runs", () => {
    const script = pipelineToPython(STEPS);
    if (process.env.QZ_WRITE_FIXTURES === "1") writeFileSync(FIXTURE, script);
    expect(script).toBe(readFileSync(FIXTURE, "utf8"));
  });

  it("is what the Pipeline panel and Macro card export", () => {
    expect(pipelineToScript(STEPS)).toBe(pipelineToPython(STEPS));
  });

  it("maps import, corrections and fit to quantized.api calls", () => {
    const s = pipelineToPython(STEPS);
    expect(s).toContain("import quantized.api as qz");
    expect(s).toContain('RECORDED_INPUTS = ["peak.csv"]');
    expect(s).toContain("data = qz.load(args.inputs[0])");
    expect(s).toContain('data = qz.apply_corrections(raw, {"yOff": -2, "yScale": 0.5})');
    expect(s).toContain('fit = qz.fit_model("Gaussian", x[keep], y[keep])');
    expect(s).toContain("keep &= (x >= 2) & (x <= 8)");
    expect(s).toContain("qz.save_table(data, args.out)");
  });

  it("never fakes an unmappable step, and stops replaying data steps after one", () => {
    const s = pipelineToPython(STEPS);
    expect(s).toContain("# NOT REPRODUCED: formula columns are evaluated only in the app");
    expect(s).toContain("# not run: it follows step 6, which this script cannot reproduce");
    expect(s).not.toContain('{"xOff": 1}'); // the correction after it is a comment only
    expect(s).toContain("steps from 6 on were NOT reproduced");
    expect(s).toContain("# (turned off in the pipeline; not run)");
    expect(s).not.toMatch(/^\s*qz\.set/m); // no pseudo-code lines survive
  });

  it("reads an Origin project with read_origin_books and says which book it uses", () => {
    const s = pipelineToPython([makeStep("import", "Import run.opju", "", { name: "run.opju" })]);
    expect(s).toContain("books = qz.read_origin_books(args.inputs[0])");
    expect(s).toContain("continues on the first");
  });

  it("asks for the input file when the pipeline started on an open dataset", () => {
    const s = pipelineToPython([makeStep("reset", "Reset corrections", "")]);
    expect(s).toContain("RECORDED_INPUTS = [None]");
    expect(s).toContain("load its file");
  });

  it("comments out what it cannot reproduce: paste, background, row selection", () => {
    const paste = pipelineToPython([makeStep("import", "Paste pasted data 1", 'qz.pasteData("pasted data 1")', { name: "pasted data 1" })]);
    expect(paste).toContain("NOT REPRODUCED: pasted data has no file to load");
    const bg = pipelineToPython([
      makeStep("import", "Import a.csv", "", { name: "a.csv" }),
      makeStep("correction", "Corrections", "", { params: {}, bg: { datasetId: "ds-2", interp: "linear" } }),
    ]);
    expect(bg).toContain("NOT REPRODUCED: it subtracts a background dataset");
    const rows = pipelineToPython([
      makeStep("import", "Import a.csv", "", { name: "a.csv" }),
      makeStep("fit", "Fit Linear", "", { model: "Linear", yKey: 0, rowIds: [1, 2, 3] }),
    ]);
    expect(rows).toContain("NOT REPRODUCED: it fitted an explicit row selection");
    expect(rows).not.toContain("fit_model");
  });
});

describe("py (Python literals)", () => {
  it("writes JSON values as Python", () => {
    expect(py({ a: true, b: null, c: [1, -0, 2.5], d: "x\"y" })).toBe('{"a": True, "b": None, "c": [1, -0.0, 2.5], "d": "x\\"y"}');
    expect(py(Number.NaN)).toBe('float("nan")');
    expect(py(-Infinity)).toBe('float("-inf")');
  });
});
