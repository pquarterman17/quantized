// P2.5 derived expressions in the store: commit (one undo entry, the σ error
// binding, the recorded step), recompute (cell edit, removal, edit), fitted
// values following the fit, .dwk round-trip, and recipe replay.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBookData } from "../lib/api";
import { resetBookTransportForTests } from "../lib/bookData";
import { makeStep } from "../lib/pipeline";
import type { Dataset, FitSpec } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { executeSteps } from "../components/workshops/pipeline/executeSteps";
import { addDerivedColumn } from "./derivedColumnRun";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchBookData: vi.fn(),
}));

// A (V) ± B, C (A) ± D, E: no unit, no error.
function ds(id = "d", over: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name: id,
    data: {
      time: [0, 1, 2],
      values: [
        [2, 0.1, 3, 0.2, 7],
        [4, 0.1, 5, 0.2, 8],
        [6, 0.3, 7, 0.1, 9],
      ],
      labels: ["U", "dU", "I", "dI", "n"],
      units: ["V", "V", "A", "A", ""],
      metadata: {},
    },
    errorRoles: [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 3, target: 2, axis: "y", side: "both" },
    ],
    ...over,
  };
}
const col = (d: Dataset, c: number) => d.data.values.map((r) => r[c]);
const state = () => useApp.getState().datasets[0];

beforeEach(() => {
  resetBookTransportForTests();
  vi.mocked(fetchBookData).mockReset().mockReturnValue(new Promise(() => {}));
  useApp.setState({ datasets: [ds()], activeId: "d", status: "", macroRecording: true, macroSteps: [], plotWindows: [] });
});

describe("commit", () => {
  it("adds value + σ as ONE undo step, binds σ as the value's error, records one derived step", async () => {
    const r = await addDerivedColumn("d", { name: "P", expr: "A * C", propagate: true });
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/added column "P" \[V·A\] with "σ\(P\)" bound as its error/) });
    const d = state();
    expect(d.data.labels).toEqual(["U", "dU", "I", "dI", "n", "P", "σ(P)"]);
    expect(col(d, 5)).toEqual([6, 20, 42]);
    col(d, 6).forEach((s, i) => {
      const [a, sa, c, sc] = d.data.values[i];
      expect(s).toBeCloseTo(Math.hypot(c * sa, a * sc), 14);
    });
    expect(d.errorRoles).toContainEqual({ channel: 6, target: 5, axis: "y", side: "both" });
    expect(d.errorRoles).toHaveLength(3);
    expect(useApp.getState().macroSteps.at(-1)).toMatchObject({
      kind: "expression",
      code: 'qz.addColumn("P", "A * C", { errors: true })',
      params: { name: "P", expr: "A * C", derived: true, propagate: true, sigmaName: "σ(P)" },
    });
    useApp.getState().undo();
    expect(state().formulas).toBeUndefined();
    expect(state().errorRoles).toHaveLength(2);
  });
  it("makes label-guessed error roles explicit before adding the σ binding (none lost)", async () => {
    useApp.setState({ datasets: [ds("d", { errorRoles: undefined })] });
    await addDerivedColumn("d", { name: "P", expr: "A * 2", propagate: true });
    expect(state().errorRoles).toEqual([
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 3, target: 2, axis: "y", side: "both" },
      { channel: 6, target: 5, axis: "y", side: "both" },
    ]);
  });
  it("a refusal changes nothing and records nothing", async () => {
    const r = await addDerivedColumn("d", { name: "bad", expr: "A + C", propagate: false });
    expect(r).toMatchObject({ ok: false, error: /units differ/ });
    expect(state().formulas).toBeUndefined();
    expect(useApp.getState().macroSteps).toEqual([]);
  });
});

describe("recompute", () => {
  it("a cell edit recomputes value and σ (the incremental path)", async () => {
    await addDerivedColumn("d", { name: "P", expr: "A * C", propagate: true });
    useApp.getState().setCellValue("d", 0, 1, 0.5); // σ_U row 0
    const d = state();
    expect(d.data.values[0][6]).toBeCloseTo(Math.hypot(3 * 0.5, 2 * 0.2), 14);
    expect(d.formulaErrors).toBeUndefined();
  });
  it("removing an EARLIER computed column shifts letters but keeps the σ valid", async () => {
    useApp.getState().addFormula("d", "junk", "E * 0");
    await addDerivedColumn("d", { name: "P", expr: "A * C", propagate: true });
    const before = col(state(), 7);
    useApp.getState().removeFormula("d", 0);
    const d = state();
    expect(d.formulaErrors).toBeUndefined();
    expect(col(d, 6)).toEqual(before);
    expect(d.errorRoles).toContainEqual({ channel: 6, target: 5, axis: "y", side: "both" });
  });
  it("editing the value column's formula makes its σ an error, never a mismatched σ", async () => {
    await addDerivedColumn("d", { name: "P", expr: "A * C", propagate: true });
    expect(useApp.getState().updateFormula("d", 0, { expr: "A * C * 2" })).toBe(true);
    const d = state();
    expect(d.formulaErrors?.["σ(P)"]).toMatch(/stale σ: "P" was edited or removed/);
    expect(col(d, 6).every(Number.isNaN)).toBe(true);
    expect(d.formulas![0].unit).toBeUndefined(); // the auto unit described the old formula
  });
  it("renaming or removing the value column also breaks the pair", async () => {
    await addDerivedColumn("d", { name: "P", expr: "A * C", propagate: true });
    useApp.getState().updateFormula("d", 0, { name: "Q" });
    expect(state().formulaErrors?.["σ(P)"]).toMatch(/stale σ/);
    useApp.getState().undo();
    expect(state().formulaErrors).toBeUndefined();
    useApp.getState().removeFormula("d", 0);
    expect(state().formulaErrors?.["σ(P)"]).toMatch(/stale σ/);
    // …and a new column taking the old name does not revive it.
    useApp.getState().addFormula("d", "P", "A");
    expect(state().formulaErrors?.["σ(P)"]).toMatch(/stale σ/);
  });
});

describe("fitted values follow the dataset's saved fit", () => {
  const gauss: FitSpec = { model: "Gaussian", params: [2, 1, 0.5], yKey: 0, exitFlag: 1 };
  const g = (x: number, p: number[]) => p[0] * Math.exp(-((x - p[1]) ** 2) / (2 * p[2] ** 2));

  it("re-resolves on setFitSpec: new params, another model, no fit", async () => {
    useApp.setState({ datasets: [ds("d", { fitSpec: gauss })] });
    await addDerivedColumn("d", { name: "res", expr: 'A - fitval("Gaussian", x)', propagate: false });
    expect(col(state(), 5)).toEqual([0, 1, 2].map((x, i) => [2, 4, 6][i] - g(x, [2, 1, 0.5])));
    expect(state().formulas![0].unit).toBe("V");

    useApp.getState().setFitSpec("d", { ...gauss, params: [3, 0, 1] });
    await vi.waitFor(() => expect(state().formulas![0].derived?.fits?.[0].params).toEqual([3, 0, 1]));
    expect(col(state(), 5)).toEqual([0, 1, 2].map((x, i) => [2, 4, 6][i] - g(x, [3, 0, 1])));

    useApp.getState().setFitSpec("d", { model: "Lorentzian", params: [1, 0, 1] });
    await vi.waitFor(() => expect(state().formulaErrors?.res).toMatch(/fit "Gaussian": the saved fit is "Lorentzian"/));
    expect(col(state(), 5).every(Number.isNaN)).toBe(true);

    useApp.getState().setFitSpec("d", null);
    await vi.waitFor(() => expect(state().formulaErrors?.res).toMatch(/this dataset has no saved fit/));
  });
});

describe(".dwk round-trip", () => {
  it("keeps the derived record (unit, σ link, fit snapshot) and re-types it on load", async () => {
    useApp.setState({ datasets: [ds("d", { fitSpec: { model: "Linear", params: [2, 1], exitFlag: 1 } })] });
    await addDerivedColumn("d", { name: "P", expr: 'A * fit("Linear", "m")', propagate: true });
    const saved = state();
    const [restored] = parseWorkspace(serializeWorkspace({ datasets: [saved] })).datasets;
    expect(restored.formulas).toEqual(saved.formulas);
    expect(restored.errorRoles).toEqual(saved.errorRoles);

    const doc = JSON.parse(serializeWorkspace({ datasets: [saved] }));
    doc.datasets[0].formulas[0].derived = { fits: [{ model: "Linear", paramNames: "m", params: [1] }], sigma: 5, unitAuto: "yes" };
    const [bad] = parseWorkspace(JSON.stringify(doc)).datasets;
    expect(bad.formulas![0].derived).toBeUndefined();
  });
});

describe("recipe replay", () => {
  it("re-derives against the TARGET's own units and error roles", async () => {
    await addDerivedColumn("d", { name: "P", expr: "A * C", propagate: true });
    const step = useApp.getState().macroSteps.at(-1)!;
    const other = ds("o");
    other.data = { ...other.data, units: ["mV", "mV", "A", "A", ""] };
    other.errorRoles = [{ channel: 1, target: 0, axis: "y", side: "both" }]; // only U has an error here
    useApp.setState({ datasets: [...useApp.getState().datasets, other] });
    const res = await executeSteps([makeStep("expression", step.label, step.code, step.params)], "o");
    expect(res.log[Object.keys(res.log)[0]]).toEqual({ status: "ok" });
    const o = useApp.getState().datasets.find((d) => d.id === "o")!;
    expect(o.formulas!.map((f) => [f.name, f.expr, f.unit])).toEqual([
      ["P", "A * C", "mV·A"],
      ["σ(P)", "abs(C * B)", "mV·A"],
    ]);
  });
});
