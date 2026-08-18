// LIBRARY_WORKBOOK_UX_PLAN PR K, K4/K5b: addFormula/updateFormula write-time
// cycle rejection, deps capture (K1/K2), and per-column error state (K5b).

import { beforeEach, describe, expect, it } from "vitest";

import type { ComputedColumn, Dataset } from "../lib/types";
import { useApp } from "./useApp";

// A base dataset with ONE real column, "A".
const baseDs = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name: id,
  data: {
    time: [0, 1, 2],
    values: [[1], [2], [3]],
    labels: ["A"],
    units: [""],
    metadata: {},
  },
  ...over,
});

// A dataset with base column "A" plus already-applied formula columns —
// `data.labels`/`values` MUST include one entry per formula (exactly what
// applyFormulas would have produced) or the formula-letter arithmetic
// (baseCount = labels.length - formulas.length) silently miscounts, which
// is a fixture bug, not a production one — every real Dataset's `data`
// always reflects its `formulas` this way.
function dsWithFormulas(id: string, formulas: ComputedColumn[]): Dataset {
  const labels = ["A", ...formulas.map((f) => f.name)];
  return {
    id,
    name: id,
    data: {
      time: [0, 1, 2],
      values: [
        [1, ...formulas.map(() => 0)],
        [2, ...formulas.map(() => 0)],
        [3, ...formulas.map(() => 0)],
      ],
      labels,
      units: labels.map(() => ""),
      metadata: {},
    },
    formulas,
  };
}

beforeEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    recalcMode: "manual",
    staleDatasets: [],
    staleFits: [],
    status: "",
    macroRecording: false,
    macroSteps: [],
  });
});

describe("addFormula (K1/K2/K4/K5b)", () => {
  it("captures deps at authoring time", () => {
    useApp.setState({ datasets: [baseDs("a")] });
    useApp.getState().addFormula("a", "S", "A * 2");
    const ds = useApp.getState().datasets[0];
    expect(ds.formulas).toEqual([{ name: "S", expr: "A * 2", deps: ["A"] }]);
  });

  it("records visible per-column error state for a formula that fails to compile (red-first: today this was silent)", () => {
    useApp.setState({ datasets: [baseDs("a")] });
    useApp.getState().addFormula("a", "bad", "A +");
    const ds = useApp.getState().datasets[0];
    expect(ds.formulaErrors?.bad).toBeDefined();
    // The NaN-column behavior is UNCHANGED alongside the new error state.
    expect(ds.data.values.every((row) => Number.isNaN(row[row.length - 1]))).toBe(true);
  });

  it("a formula referencing a nonexistent column is still accepted (not a cycle) and errors at eval time", () => {
    useApp.setState({ datasets: [baseDs("a")] });
    const ok = useApp.getState().addFormula("a", "bogus", "Z + 1");
    expect(ok).toBe(true);
    expect(useApp.getState().datasets[0].formulaErrors?.bogus).toMatch(/unknown variable/);
  });

  it("addFormula does not need a cycle rejection for an ordinary new column (nothing points at it yet)", () => {
    useApp.setState({ datasets: [dsWithFormulas("a", [{ name: "B", expr: "A * 2", deps: ["A"] }])] });
    const ok = useApp.getState().addFormula("a", "C", "B + 1");
    expect(ok).toBe(true);
    expect(useApp.getState().status).not.toMatch(/circular/);
  });
});

describe("updateFormula (K4)", () => {
  it("refuses (zero mutation) an edit that would create a 2-column cycle", () => {
    // B (letter B, position 0) = A*2. C (letter C, position 1) = B+1 (C depends on B).
    const ds = baseDs("a", {
      data: { time: [0, 1], values: [[2, 3], [4, 5]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} },
      formulas: [
        { name: "b", expr: "A * 2", deps: ["A"] },
        { name: "c", expr: "B + 1", deps: ["B"] },
      ],
    });
    useApp.setState({ datasets: [ds] });
    const before = useApp.getState().datasets[0];
    const ok = useApp.getState().updateFormula("a", 0, { expr: "C + 1" }); // widen B to depend on C -> B<->C
    expect(ok).toBe(false);
    expect(useApp.getState().status).toMatch(/circular/);
    // Zero mutation: the formula list is untouched (same reference/values).
    expect(useApp.getState().datasets[0]).toBe(before);
  });

  it("refuses a direct self-reference edit", () => {
    const ds = baseDs("a", {
      data: { time: [0, 1], values: [[2, 3]], labels: ["A", "B"], units: ["", ""], metadata: {} },
      formulas: [{ name: "b", expr: "A * 2", deps: ["A"] }],
    });
    useApp.setState({ datasets: [ds] });
    const ok = useApp.getState().updateFormula("a", 0, { expr: "B + 1" }); // B references itself
    expect(ok).toBe(false);
    expect(useApp.getState().status).toMatch(/cannot depend on itself/);
  });

  it("accepts a valid edit, updating deps and clearing a prior error", () => {
    const ds = dsWithFormulas("a", [{ name: "bad", expr: "A +", deps: [] }]);
    useApp.setState({ datasets: [ds] });
    const ok = useApp.getState().updateFormula("a", 0, { expr: "A * 3" });
    expect(ok).toBe(true);
    const updated = useApp.getState().datasets[0];
    expect(updated.formulas).toEqual([{ name: "bad", expr: "A * 3", deps: ["A"] }]);
    expect(updated.formulaErrors).toBeUndefined();
  });

  it("legacy columns without `deps` degrade — cycle detection still works via re-derived deps", () => {
    const ds = baseDs("a", {
      data: { time: [0, 1], values: [[2, 3], [4, 5]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} },
      formulas: [
        { name: "b", expr: "A * 2" }, // no deps (legacy)
        { name: "c", expr: "B + 1" }, // no deps (legacy)
      ],
    });
    useApp.setState({ datasets: [ds] });
    const ok = useApp.getState().updateFormula("a", 0, { expr: "C + 1" });
    expect(ok).toBe(false);
  });

  it("returns false for a nonexistent dataset/index without throwing", () => {
    expect(useApp.getState().updateFormula("ghost", 0, { expr: "1" })).toBe(false);
    useApp.setState({ datasets: [baseDs("a")] });
    expect(useApp.getState().updateFormula("a", 0, { expr: "1" })).toBe(false);
  });
});

describe("addFormula/updateFormula history + macro (K5e precursor)", () => {
  it("addFormula records exactly one history entry", () => {
    useApp.setState({ datasets: [baseDs("a")] });
    const before = useApp.getState().history.length;
    useApp.getState().addFormula("a", "S", "A * 2");
    expect(useApp.getState().history.length).toBe(before + 1);
  });

  it("a REFUSED addFormula/updateFormula records NO history entry", () => {
    const ds = dsWithFormulas("a", [{ name: "b", expr: "A * 2", deps: ["A"] }]);
    useApp.setState({ datasets: [ds] });
    const before = useApp.getState().history.length;
    useApp.getState().updateFormula("a", 0, { expr: "B + 1" }); // self-reference, refused
    expect(useApp.getState().history.length).toBe(before);
  });
});
