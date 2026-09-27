// P2.5 derived expressions in the store: commit (one undo entry, the σ error
// binding, the recorded step), recompute (cell edit, removal, edit), fitted
// values following the fit, .dwk round-trip, and recipe replay.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyCorrections, fetchBookData, fitModel } from "../lib/api";
import { resetBookTransportForTests } from "../lib/bookData";
import { makeStep } from "../lib/pipeline";
import type { Dataset, FitSpec } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { executeSteps } from "../components/workshops/pipeline/executeSteps";
import { addDerivedColumn, refreshFitRefsFor } from "./derivedColumnRun";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  fetchBookData: vi.fn(),
  // Review finding 3: fitModel/applyCorrections are mocked here (not just
  // fetchBookData) so a recalcNow race can be forced deterministically.
  fitModel: vi.fn(),
  applyCorrections: vi.fn(),
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
  vi.mocked(fitModel).mockReset();
  vi.mocked(applyCorrections).mockReset();
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
  it("removing the value column breaks the pair — but renaming it does NOT (review finding 9)", async () => {
    await addDerivedColumn("d", { name: "P", expr: "A * C", propagate: true });
    // Renaming the value column follows the link (updateFormula carries the
    // rename into the σ column's derived.sigmaOf.name) — no stale error, and
    // the σ still evaluates against the renamed column's own values.
    useApp.getState().updateFormula("d", 0, { name: "Q" });
    expect(state().formulaErrors).toBeUndefined();
    expect(state().formulas![1].derived?.sigmaOf).toEqual({ name: "Q", method: "first-order, uncorrelated" });
    expect(col(state(), 6).every((v) => !Number.isNaN(v))).toBe(true);
    useApp.getState().undo();
    expect(state().formulas![0].name).toBe("P");
    expect(state().formulaErrors).toBeUndefined();
    // Removing it for real is the one thing that still breaks the pair.
    useApp.getState().removeFormula("d", 0);
    expect(state().formulaErrors?.["σ(P)"]).toMatch(/stale σ/);
    // …and a new column taking the old name does not revive it.
    useApp.getState().addFormula("d", "P", "A");
    expect(state().formulaErrors?.["σ(P)"]).toMatch(/stale σ/);
  });
  it("renaming the σ column itself also follows the link (review finding 9)", async () => {
    await addDerivedColumn("d", { name: "P", expr: "A * C", propagate: true });
    useApp.getState().updateFormula("d", 1, { name: "sigP" });
    expect(state().formulaErrors).toBeUndefined();
    expect(state().formulas![0].derived?.sigma).toBe("sigP");
    expect(col(state(), 6).every((v) => !Number.isNaN(v))).toBe(true);
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

describe("review round: edits, copies, refresh side effects", () => {
  const lin: FitSpec = { model: "Linear", params: [2, 1], exitFlag: 1 };

  it("an expr edit keeps the fitted-value snapshot, so fit() still resolves", async () => {
    useApp.setState({ datasets: [ds("d", { fitSpec: lin })] });
    await addDerivedColumn("d", { name: "k", expr: 'fit("Linear", "m") * 2', propagate: false });
    useApp.getState().updateFormula("d", 0, { expr: 'fit("Linear", "m") * 3' });
    expect(state().formulaErrors).toBeUndefined();
    expect(col(state(), 5)).toEqual([6, 6, 6]);
  });
  it("a typed unit stops being automatic, so a later expr edit keeps it", async () => {
    await addDerivedColumn("d", { name: "P", expr: "A * A", propagate: false });
    useApp.getState().updateFormula("d", 0, { unit: "W" });
    expect(state().formulas![0].derived?.unitAuto).toBeUndefined();
    useApp.getState().updateFormula("d", 0, { expr: "A * A * 2" });
    expect(state().formulas![0].unit).toBe("W");
  });
  it("a duplicated dataset has no saved fit, so its fit() column says so", async () => {
    useApp.setState({ datasets: [ds("d", { fitSpec: lin })] });
    await addDerivedColumn("d", { name: "k", expr: 'fit("Linear", "m") * A', propagate: false });
    await useApp.getState().duplicateDataset("d");
    const cloneId = useApp.getState().activeId!;
    await vi.waitFor(() => expect(useApp.getState().datasets.find((x) => x.id === cloneId)?.formulaErrors?.k).toMatch(/no saved fit/));
    expect(state().formulaErrors).toBeUndefined(); // the source is untouched
  });
  it("a refresh that changes nothing writes nothing; one that does keeps other columns' specific errors", async () => {
    useApp.setState({ datasets: [ds("d", { fitSpec: lin })] });
    await addDerivedColumn("d", { name: "k", expr: 'fit("Linear", "m") * A', propagate: false });
    const before = useApp.getState().datasets;
    refreshFitRefsFor("d");
    expect(useApp.getState().datasets).toBe(before);
    useApp.getState().addFormula("d", "J", "A * 1"); // column G
    useApp.getState().addFormula("d", "B2", "G * 2");
    useApp.getState().removeFormula("d", 1); // B2 now "references removed column G"
    expect(state().formulaErrors?.B2).toMatch(/references removed column G/);
    useApp.getState().setFitSpec("d", { ...lin, params: [5, 0] });
    await vi.waitFor(() => expect(state().formulas![0].derived?.fits?.[0].params).toEqual([5, 0]));
    expect(col(state(), 5)).toEqual([10, 20, 30]); // k was recomputed…
    expect(state().formulaErrors?.B2).toMatch(/references removed column G/); // …and B2 kept its reason
  });
  it("a refresh that changes values marks what is downstream stale — not the dataset's own fit", async () => {
    useApp.setState({ recalcMode: "manual", staleDatasets: [], staleFits: [], datasets: [ds("d", { fitSpec: lin }), ds("w", { derivedFrom: { datasetId: "d", pipeline: "copy" } })] });
    await addDerivedColumn("d", { name: "k", expr: 'fit("Linear", "m") * A', propagate: false });
    useApp.setState({ staleDatasets: [], staleFits: [] });
    useApp.getState().setFitSpec("d", { ...lin, params: [5, 0] });
    await vi.waitFor(() => expect(useApp.getState().staleDatasets).toEqual(["w"]));
    expect(useApp.getState().staleFits).not.toContain("d");
  });
  it("a fit refresh's own recalcNow, reached mid-pass, gets a follow-up pass — not a silent no-op (review finding 3)", async () => {
    // Build "d"'s fit() column under a quiet (manual) mode first, so this
    // setup step never itself races the auto-mode debounce below.
    useApp.setState({ recalcMode: "manual", datasets: [ds("d", { fitSpec: lin })] });
    const added = await addDerivedColumn("d", { name: "k", expr: 'fit("Linear", "m") * A', propagate: false });
    expect(added.ok).toBe(true);
    const dWithFit = state();
    // "d" gets refit below, so its OWN refresh (refreshFitRefsLater ->
    // refreshFitRefsFor -> recalcNow) reaches recalcNow WHILE the OUTER
    // recalcNow() that is refitting BOTH "d" and "d2" is still busy on
    // "d2"'s slower fit — the A ("d") -> B ("w") dependency case: "w" is
    // downstream of "d", not of "d2".
    useApp.setState({
      recalcMode: "auto",
      staleDatasets: [],
      staleFits: ["d", "d2"],
      datasets: [dWithFit, ds("d2", { fitSpec: lin }), ds("w", { derivedFrom: { datasetId: "d", pipeline: "copy" } })],
    });
    vi.mocked(applyCorrections).mockResolvedValue(ds("w").data); // "w"'s recompute, once reached
    let resolveD2!: (v: { params: number[]; exitFlag: number }) => void;
    vi.mocked(fitModel)
      .mockResolvedValueOnce({ params: [5, 0], exitFlag: 1 }) // "d" resolves right away…
      .mockImplementationOnce(() => new Promise((resolve) => (resolveD2 = resolve))); // …"d2" hangs
    const p = useApp.getState().recalcNow(); // NOT awaited yet — still in flight below
    // "d"'s fit settles, refreshFitRefsFor runs and marks "w" stale, all
    // while `p` is still pending on "d2" — the exact mid-pass window.
    await vi.waitFor(() => expect(useApp.getState().staleDatasets).toEqual(["w"]));
    resolveD2({ params: [5, 0], exitFlag: 1 }); // let the original pass finish
    await p;
    // Without the fix, "w" is orphaned here forever (recalcNow no-op'd mid-
    // pass); with it, the follow-up pass this settling triggers picks it up.
    await vi.waitFor(() => expect(useApp.getState().staleDatasets).toEqual([]));
  });
});

describe("unit contradictions: refused once, added on a second ask", () => {
  it("the same formula submitted again is added with no unit, and the step replays that choice", async () => {
    const first = await addDerivedColumn("d", { name: "S", expr: "A + C", propagate: false });
    expect(first).toMatchObject({ ok: false, error: /units differ .* \(or press Add again to add it without a unit\)/ });
    const second = await addDerivedColumn("d", { name: "S", expr: "A + C", propagate: false });
    expect(second).toMatchObject({ ok: true, message: expect.stringMatching(/added WITHOUT a unit, as asked/) });
    expect(state().formulas![0].unit).toBeUndefined();
    const step = useApp.getState().macroSteps.at(-1)!;
    expect(step.params).toMatchObject({ allowUnitMismatch: true });
    useApp.setState({ datasets: [...useApp.getState().datasets, ds("o")] });
    const res = await executeSteps([makeStep("expression", step.label, step.code, step.params)], "o");
    expect(Object.values(res.log)[0]).toEqual({ status: "ok" });
    const refused = await executeSteps([makeStep("expression", step.label, step.code, { ...step.params, allowUnitMismatch: false })], "o");
    expect(Object.values(refused.log)[0]).toMatchObject({ status: "failed" });
  });
  it("a different formula in between resets the second-ask", async () => {
    await addDerivedColumn("d", { name: "S", expr: "A + C", propagate: false });
    await addDerivedColumn("d", { name: "T", expr: "A * 2", propagate: false });
    expect(await addDerivedColumn("d", { name: "S", expr: "A + C", propagate: false })).toMatchObject({ ok: false });
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

  it("re-resolves a stale fit snapshot against the LOADED fitSpec, not the saved one (review finding 10)", async () => {
    useApp.setState({ datasets: [ds("d", { fitSpec: { model: "Linear", params: [2, 1], exitFlag: 1 } })] });
    await addDerivedColumn("d", { name: "P", expr: 'A * fit("Linear", "m")', propagate: false });
    const saved = state();
    expect(saved.formulas![0].derived?.fits?.[0].params).toEqual([2, 1]);
    expect(col(saved, saved.data.labels.indexOf("P"))).toEqual([4, 8, 12]); // A * 2
    const doc = JSON.parse(serializeWorkspace({ datasets: [saved] }));
    // The .dwk's OWN fitSpec was refit since the derived.fits snapshot was
    // taken — an internally stale file, exactly what a hand edit or an old
    // save produces.
    doc.datasets[0].fitSpec.params = [9, 9];
    const [reloaded] = parseWorkspace(JSON.stringify(doc)).datasets;
    expect(reloaded.formulas![0].derived?.fits?.[0].params).toEqual([9, 9]); // re-resolved, not the stale [2,1]
    expect(reloaded.formulaErrors).toBeUndefined();
    expect(col(reloaded, reloaded.data.labels.indexOf("P"))).toEqual([18, 36, 54]); // A * 9, recomputed
  });

  it("a .dwk whose fit was cleared since the snapshot was saved becomes an explicit error on load, not a stale value (review finding 10)", async () => {
    useApp.setState({ datasets: [ds("d", { fitSpec: { model: "Linear", params: [2, 1], exitFlag: 1 } })] });
    await addDerivedColumn("d", { name: "P", expr: 'A * fit("Linear", "m")', propagate: false });
    const doc = JSON.parse(serializeWorkspace({ datasets: [state()] }));
    delete doc.datasets[0].fitSpec; // the fit was cleared since the snapshot was saved
    const [reloaded] = parseWorkspace(JSON.stringify(doc)).datasets;
    expect(reloaded.formulaErrors?.P).toMatch(/no saved fit/);
    expect(col(reloaded, reloaded.data.labels.indexOf("P")).every(Number.isNaN)).toBe(true);
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
