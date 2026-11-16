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

import { fitParamsForEdit, pipelineToPython, pipelineToScript, py } from "./pipeline";
import { makeStep, type PipelineStep } from "./pipelineStep";
import { resampleScriptParams, sigopScriptParams } from "./transformScriptParams";
import { resampleParamsOf } from "./transformResample";
import { sigopParamsOf } from "./transformSigop";

const FIXTURE = join(__dirname, "__fixtures__", "pipelineScript.py");

/** The name and the fit label carry quotes and a newline on purpose: the
 *  executed fixture pins that they cannot break out of their literals. */
const NAME = 'peak "run 1"\n.csv';

/** import -> corrections -> a display step -> a fit with user starts ->
 *  (off) -> a cell edit recorded as "ui" (it changes data, so it stops the
 *  replay) -> a later correction that must NOT run on the wrong data. */
const STEPS: PipelineStep[] = [
  makeStep("import", `Import ${NAME}`, `qz.import(${JSON.stringify(NAME)})`, { name: NAME }),
  makeStep("correction", "Corrections → peak", "", { params: { yOff: -2, yScale: 0.5 }, bg: null }),
  makeStep("ui", "Y axis log", 'qz.setYScale("log")'),
  makeStep("fit", 'Fit "Gaussian"\nwindow', 'qz.fit("Gaussian")', {
    model: "Gaussian", yKey: 0, xKey: null, range: [2, 8], nPoints: 61, statsVersion: 2,
    // σ is HELD at 1 (the free fit gives ~0.82): the executed fixture prints it.
    p0: [30, 5.2, 1], lower: [0, null, 0.01], upper: [null, null, null], fixed: [false, false, true],
  }),
  { ...makeStep("ui", "Grid", "qz.setShowGrid(true)"), enabled: false },
  makeStep("ui", "Delete 2 rows", 'qz.deleteRows("peak", [3, 4])'),
  makeStep("correction", "Corrections → peak", 'qz.applyCorrections("<active>", { xOff: 1 })', { params: { xOff: 1 }, bg: null }),
];

const imported = (): PipelineStep => makeStep("import", "Import a.csv", "", { name: "a.csv" });
const later = (): PipelineStep => makeStep("correction", "Corrections", "", { params: { xOff: 1 }, bg: null });

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
    expect(s).toContain(`RECORDED_INPUTS = [${JSON.stringify(NAME)}]`);
    expect(s).toContain("data = qz.load(args.inputs[0])");
    expect(s).toContain('data = qz.apply_corrections(raw, {"yOff": -2, "yScale": 0.5}, error_bindings=roles)');
    expect(s).toContain(
      'fit = qz.fit_model("Gaussian", x[keep], y[keep], p0=[30, 5.2, 1], lower=[0, None, 0.01], upper=[None, None, None], fixed=[False, False, True])',
    );
    expect(s).toContain("keep &= (x >= 2) & (x <= 8)");
    expect(s).toContain("qz.save_table(data, args.out, overwrite=True, protect=args.inputs)");
  });

  it("keeps quotes and newlines inside their literals and comments", () => {
    const s = pipelineToPython(STEPS);
    expect(s).toContain('fits.append(("4. Fit \\"Gaussian\\"\\nwindow", fit))');
    expect(s).toContain('    # 4. Fit "Gaussian" window\n'); // a comment never spans lines
    expect(s).toContain('    # 1. Import peak "run 1" .csv\n');
    expect(s.split("\n").every((line) => !line.startsWith(".csv") && !line.startsWith("window"))).toBe(true);
  });

  it("never fakes an unmappable step, and stops replaying data steps after one", () => {
    const s = pipelineToPython(STEPS);
    expect(s).toContain("# NOT REPRODUCED: this recorded action can change the data");
    expect(s).toContain("# not run: it follows step 6, which this script cannot reproduce");
    expect(s).not.toContain('{"xOff": 1}');
    expect(s).toContain("steps from 6 on were NOT reproduced");
    expect(s).toContain("# (turned off in the pipeline; not run)");
    expect(s).not.toMatch(/^\s*qz\.set/m); // no pseudo-code line is ever run
  });

  it("keeps each skipped step's recorded app line, values included (L4)", () => {
    const s = pipelineToPython(STEPS);
    expect(s).toContain('    # app: qz.deleteRows("peak", [3, 4])');
    expect(s).toContain('    # app: qz.applyCorrections("<active>", { xOff: 1 })');
    expect(s).toContain("    # app: qz.setShowGrid(true)");
    expect(s).toContain('    # app: qz.setYScale("log")');
  });

  // Every data-changing action the app records as kind "ui" (store/cellEdit,
  // worksheetColumns, sortRows, recode, reimport, useApp's channel role/type,
  // derived worksheets), and a step with no known kind: each stops the replay.
  it.each([
    'qz.setCell("d", 3, 2, 1.5)',
    'qz.setCells("d", [[0, 0, 1]])',
    'qz.setCategoricalCell("d", 0, 1, "a")',
    'qz.insertRows("d", 2, 1)',
    'qz.deleteRows("d", [3])',
    'qz.moveRows("d", [1], 3)',
    'qz.insertColumn("d", 1)',
    'qz.deleteColumns("d", [1])',
    'qz.moveColumn("d", 1, 0)',
    'qz.editColumn("d", 1, {})',
    'qz.sortRows("d", 0, "asc")',
    'qz.sortRowsBy("d", [0])',
    'qz.recode("d", 1, {})',
    'qz.reimportDataset("d")',
    'qz.freezeCopy("d")',
    'qz.setChannelRole(1, "yerr")',
    'qz.setChannelType(1, "categorical")',
    'qz.createDerivedWorksheet("d")',
    'qz.createSpectralWorksheet("d")',
    // These only touch the view in name, but each can build a dataset or make
    // another one active (re-review H1/L6), so the steps after it ran elsewhere.
    'qz.applyFigure("fig-ds-1-0")',
    'qz.openFigureDocInWindow("f")',
    'qz.plotInNewWindow("d")',
    'qz.facetByColumn("d", 2)',
    'qz.breakAtGaps("d")',
    'qz.setY2Keys([1])', // not (yet) audited as view-only
    "",
  ])("a ui step recorded as %j is NOT REPRODUCED and stops the replay", (code) => {
    const s = pipelineToPython([imported(), makeStep("ui", "edit", code), later()]);
    expect(s).toContain("# NOT REPRODUCED: this recorded action can change the data");
    expect(s).toContain("# not run: it follows step 2");
    expect(s).not.toContain("qz.apply_corrections");
  });

  it("a step of no known kind is NOT REPRODUCED and stops the replay", () => {
    const odd = { ...makeStep("ui", "?", "qz.setYScale(\"log\")"), kind: "mystery" as never };
    const s = pipelineToPython([imported(), odd, later()]);
    expect(s).toContain("# NOT REPRODUCED: this step kind has no quantized.api equivalent");
    expect(s).not.toContain("qz.apply_corrections");
  });

  it.each([
    'qz.setXScale("log")', 'qz.setYScale("linear")', 'qz.setPlotTitle("t")', "qz.setWaterfall(true)",
    "qz.setShowGrid(false)", "qz.setXKey(1)", "qz.setYKeys([0])", "qz.setGroupKey(null)",
  ])("a view-only ui step %j does not stop the replay", (code) => {
    const s = pipelineToPython([imported(), makeStep("ui", "view", code), later()]);
    expect(s).toContain("# display setting only");
    expect(s).toContain('data = qz.apply_corrections(raw, {"xOff": 1}, error_bindings=roles)');
  });

  it("loads an Origin project with qz.load: its primary book, as the app activates (M4)", () => {
    const s = pipelineToPython([makeStep("import", "Import run.opju", "", { name: "run.opju" })]);
    expect(s).toContain("data = qz.load(args.inputs[0])");
    expect(s).not.toContain("read_origin_books");
    // Choosing another book in the Library is not recorded: say so (L6).
    expect(s).toContain("dataset switches in the app are not recorded");
  });

  it("says dataset switches are not recorded once a pipeline imports twice, never for one file", () => {
    const two = pipelineToPython([imported(), makeStep("import", "Import b.csv", "", { name: "b.csv" })]);
    expect(two).toContain("NOTE: switching datasets in the app is not recorded");
    expect(pipelineToPython([imported(), later()])).not.toContain("switching datasets");
  });

  it("resets a fit step's starts, bounds and holds when its model is edited (M1)", () => {
    const step = makeStep("fit", "Fit Gaussian", "", {
      model: "Gaussian", yKey: 0, p0: [30, 5, 1], lower: [0, null, 0], upper: [null, null, null], fixed: [false, false, true],
    });
    expect(fitParamsForEdit(step, { ...step.params, model: "Linear" })).toEqual({ model: "Linear", yKey: 0, p0: null });
    expect(fitParamsForEdit(step, { ...step.params })).toEqual(step.params); // same model: kept
    const s = pipelineToPython([imported(), { ...step, params: fitParamsForEdit(step, { ...step.params, model: "Linear" }) }]);
    expect(s).toContain('fit = qz.fit_model("Linear", x[keep], y[keep])\n');
  });

  it("warns, at run time too, when a fit step predates recorded starts (M5)", () => {
    const old = makeStep("fit", "Fit Linear", "", { model: "Linear", yKey: 0 });
    const s = pipelineToPython([imported(), old]);
    expect(s).toContain("# WARNING: recorded before start values, bounds and held parameters were saved");
    expect(s).toMatch(/print\("warning: step 2 was recorded without its start values/);
    expect(s).toContain('fit = qz.fit_model("Linear", x[keep], y[keep])');
    const fresh = makeStep("fit", "Fit Linear", "", { model: "Linear", yKey: 0, p0: null });
    expect(pipelineToPython([imported(), fresh])).not.toContain("WARNING");
  });

  it("asks for the input file when the pipeline started on an open dataset", () => {
    const s = pipelineToPython([makeStep("reset", "Reset corrections", "")]);
    expect(s).toContain("RECORDED_INPUTS = [None]");
    expect(s).toContain("load its file");
  });

  it("comments out what it cannot reproduce: app-only formulas, derived columns, paste, row selection", () => {
    for (const expr of ["if(A > 0, A, 0)", "mean(A)", 'col("Moment")', "Moment * 2", "A[2]", "row()"]) {
      const s = pipelineToPython([imported(), makeStep("expression", "Add column t", "", { name: "t", expr }), later()]);
      expect(s, expr).toContain(`NOT REPRODUCED: formula ${JSON.stringify(expr)} is evaluated only in the app`);
      expect(s, expr).not.toContain("qz.apply_corrections");
    }
    const derived = pipelineToPython([imported(), makeStep("expression", "Add column t", "", { name: "t", expr: "A*2", derived: true })]);
    expect(derived).toContain("NOT REPRODUCED: derived columns (units and error propagation)");
    const frozen = pipelineToPython([imported(), makeStep("expression", "Freeze Copy of a", "", { id: "ds-9" })]);
    expect(frozen).toContain("NOT REPRODUCED: this worksheet operation has no quantized.api equivalent");
    const paste = pipelineToPython([makeStep("import", "Paste pasted data 1", 'qz.pasteData("pasted data 1")', { name: "pasted data 1" })]);
    expect(paste).toContain("NOT REPRODUCED: pasted data has no file to load");
    const rows = pipelineToPython([imported(), makeStep("fit", "Fit Linear", "", { model: "Linear", yKey: 0, rowIds: [1, 2, 3] })]);
    expect(rows).toContain("NOT REPRODUCED: it fitted an explicit row selection");
    expect(rows).not.toContain("fit_model");
    for (const op of ["join", "merge", "stack", "split", "algebra", "signal"]) {
      expect(pipelineToPython([imported(), makeStep("transform", op, "", { op })])).toContain(`NOT REPRODUCED: the ${op} transform has no quantized.api equivalent`);
    }
    const match = pipelineToPython([imported(), makeStep("transform", "Resample", "", { op: "resample", mode: "match", method: "linear" })]);
    expect(match).toContain("NOT REPRODUCED: a resample onto another dataset's x");
  });

  it("reproduces element-wise formula columns, recomputed after every later correction (gap audit 5 #6)", () => {
    const s = pipelineToPython([
      imported(),
      makeStep("expression", "Add column t", "", { name: "t", expr: "A*2 + x" }),
      makeStep("correction", "Corrections", "", { params: { yOff: 1 }, bg: null }),
      makeStep("expression", "Add column u", "", { name: "u", expr: "B*3" }),
      makeStep("reset", "Reset corrections", ""),
    ]);
    expect(s).not.toContain("NOT REPRODUCED");
    expect(s).toContain("    formulas = []  # the formula columns");
    expect(s).toContain('    base = data  # the worksheet before its formula columns\n    formulas.append(("t", "A*2 + x"))\n    data = qz.add_formula_columns(base, formulas)');
    expect(s).toContain('    base = qz.apply_corrections(raw, {"yOff": 1}, error_bindings=roles)\n    data = qz.add_formula_columns(base, formulas)');
    expect(s).toContain('    formulas.append(("u", "B*3"))\n    data = qz.add_formula_columns(base, formulas)');
    expect(s).toContain("    base = raw\n    data = qz.add_formula_columns(base, formulas)");
  });

  it("refuses an edited formula column: its record holds only the new name (a rename loses the old)", () => {
    const s = pipelineToPython([
      imported(),
      makeStep("expression", "Add column r", "", { name: "r", expr: "A/B" }),
      makeStep("expression", "Edit column ratio", 'qz.editColumn("ratio", "A/B*2")', { name: "ratio", expr: "A/B*2" }),
      later(),
    ]);
    expect(s).toContain("NOT REPRODUCED: an edited formula column cannot be replayed exactly");
    expect(s).not.toContain("qz.apply_corrections");
  });

  it("corrects with the error-column roles the app seeds on import; a transform output has none", () => {
    const s = pipelineToPython([
      imported(),
      later(),
      makeStep("transform", "Median", "", { op: "sigop", method: "median", channels: [0], args: { window: 3 } }),
      later(),
    ]);
    expect(s).toContain("    roles = qz.seed_error_roles(data)  # the error-column roles the app gives the file on import");
    expect(s).toContain("    roles = None  # with no error-column roles, as in the app");
    expect(s.indexOf("roles = None")).toBeLessThan(s.lastIndexOf("error_bindings=roles"));
  });

  it("the script's sigop validation is the app's sigopParamsOf, case by case", () => {
    const cases: Record<string, unknown>[] = [
      { method: "median", channels: [0, 1], args: { window: 5 } },
      { method: "warp", channels: [0] },
      { method: "median", channels: [0.5] },
      { method: "median", channels: "0" },
      { method: "despike", channels: [0], args: { window: { n: 3 } } },
      { method: "ifft", channels: [], args: { magnitudeChannel: 1, phaseChannel: 1 } },
      { method: "ifft", channels: [], args: { magnitudeChannel: 0, phaseChannel: 1 } },
      { method: "reduce-nth", args: { n: 2 } },
    ];
    for (const raw of cases) {
      const run = (f: () => unknown) => { try { return f(); } catch (e) { return (e as Error).message; } };
      const app = run(() => { const { op: _op, ...rest } = sigopParamsOf({ op: "sigop", ...raw }); return rest; });
      expect(run(() => sigopScriptParams(raw)), JSON.stringify(raw)).toEqual(app);
    }
  });

  it("the script's resample validation is the app's resampleParamsOf, case by case", () => {
    const cases: Record<string, unknown>[] = [
      { mode: "n_points", nPoints: 50, method: "pchip", outOfRange: "clip", sortUnsorted: true },
      { mode: "n_points", nPoints: 1.5 },
      { mode: "step", step: 0.5, nPoints: 99 },
      { mode: "step" },
      { mode: "range", start: 0, stop: 10, step: 1, acceptedXUnits: ["K", "Oe"] },
      { mode: "range", start: 0, stop: Infinity, step: 1 },
      { mode: "step", step: 1, method: "cubic" },
      { mode: "step", step: 1, outOfRange: "drop" },
      { mode: "step", step: 1, acceptedXUnits: ["K"] },
      { mode: "warp" },
    ];
    for (const raw of cases) {
      const run = (f: () => unknown) => { try { return f(); } catch (e) { return (e as Error).message; } };
      const app = run(() => { const { op: _op, acceptedXUnits: _a, ...rest } = resampleParamsOf({ op: "resample", ...raw }); return rest; });
      expect(run(() => resampleScriptParams(raw)), JSON.stringify(raw)).toEqual(app);
    }
  });

  it("validates a transform's recorded settings as the app's replay does", () => {
    for (const params of [
      { op: "resample", mode: "n_points", nPoints: 1, method: "linear" },
      { op: "resample", mode: "step", method: "cubic", step: 1 },
      { op: "sigop", method: "warp", channels: [0] },
      { op: "sigop", method: "ifft", channels: [], args: { magnitudeChannel: 1, phaseChannel: 1 } },
    ]) {
      const s = pipelineToPython([imported(), makeStep("transform", "T", "", params)]);
      expect(s, JSON.stringify(params)).toContain("NOT REPRODUCED: its recorded settings are invalid");
    }
    const step = pipelineToPython([imported(), makeStep("transform", "R", "", { op: "resample", mode: "step", step: 0.5, nPoints: 99, method: "linear" })]);
    expect(step).toContain('qz.resample(data, mode="step", step=0.5, method="linear"'); // only the mode's own keys
  });

  it("a turned-off transform stops the replay: later steps were recorded on its output", () => {
    const off = { ...makeStep("transform", "Resample", "", { op: "resample", mode: "n_points", nPoints: 50, method: "linear" }), enabled: false };
    const s = pipelineToPython([imported(), off, makeStep("fit", "Fit Linear", "", { model: "Linear", yKey: 0, p0: null })]);
    expect(s).toContain("# not run: it follows step 2");
    expect(s).not.toContain("fit_model");
  });

  it("applies only a finite, ordered fit window, as the app decodes it", () => {
    for (const range of [[5, 1], [0, null], [Number.NaN, 2]]) {
      const s = pipelineToPython([imported(), makeStep("fit", "Fit", "", { model: "Linear", yKey: 0, p0: null, range })]);
      expect(s, JSON.stringify(range)).not.toContain("the recorded fit window");
    }
  });

  it("reproduces a background subtraction from a file the script asks for", () => {
    const s = pipelineToPython([
      imported(),
      makeStep("correction", "Corrections", "", { params: {}, bg: { datasetId: "ds-2", interp: "pchip" } }),
    ]);
    expect(s).not.toContain("NOT REPRODUCED");
    expect(s).toContain('parser.add_argument("--background", action="append"');
    expect(s).toContain("if len(args.background) != 1:");
    expect(s).toContain("    background = qz.load(args.background[0])");
    expect(s).toContain('data = qz.apply_corrections(raw, {}, bg_dataset=background, bg_interp="pchip", error_bindings=roles)');
    expect(s).toContain("protect=args.inputs + args.background");
  });

  it("reproduces resample and signal / Reduce XY transforms on the current data", () => {
    const s = pipelineToPython([
      imported(),
      makeStep("expression", "Add column t", "", { name: "t", expr: "A*2" }),
      makeStep("transform", "Median", "", { op: "sigop", method: "median", channels: [0, 1], args: { window: 5 } }),
      makeStep("transform", "Resample", "", { op: "resample", mode: "n_points", nPoints: 50, method: "pchip", outOfRange: "nan", sortUnsorted: false }),
      later(),
    ]);
    expect(s).not.toContain("NOT REPRODUCED");
    expect(s).toContain('    data = qz.run_signal_op(data, "median", [0, 1], {"window": 5}).data\n    raw = data  # a new dataset: its own base\n    roles = None  # with no error-column roles, as in the app\n    formulas = []');
    expect(s).toContain('    data = qz.resample(data, mode="n_points", n_points=50, method="pchip", out_of_range="nan", unsorted="refuse").data');
    expect(s).toContain('    data = qz.apply_corrections(raw, {"xOff": 1}, error_bindings=roles)'); // no formulas left to recompute
  });
});

describe("py (Python literals)", () => {
  it("writes JSON values as Python", () => {
    expect(py({ a: true, b: null, c: [1, -0, 2.5], d: "x\"y" })).toBe('{"a": True, "b": None, "c": [1, -0.0, 2.5], "d": "x\\"y"}');
    expect(py(Number.NaN)).toBe('float("nan")');
    expect(py(-Infinity)).toBe('float("-inf")');
  });
});
