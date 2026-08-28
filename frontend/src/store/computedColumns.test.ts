// LIBRARY_WORKBOOK_UX_PLAN PR K, K4/K5b: addFormula/updateFormula write-time
// cycle rejection, deps capture (K1/K2), and per-column error state (K5b).

import { beforeEach, describe, expect, it } from "vitest";

import { facetComposition } from "../lib/composition";
import { buildErrorSpans } from "../lib/errorbars";
import { facetCompositionFromBinding, facetPayloads } from "../lib/facet";
import { createFigureDocument } from "../lib/figureDocument";
import { fitDataForSpec } from "../lib/fitselection";
import { defaultPlotView } from "../lib/plotview";
import type { ComputedColumn, Dataset, FitSpec } from "../lib/types";
import { formulaLetter } from "./computedColumns";
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

  // Review-round P1: the previous test suite had ZERO coverage that
  // addFormula's wouldCreateCycle check (store/computedColumns.ts:74-83) is
  // actually wired in — deleting the check left all 23 targeted tests
  // green. A display-name self-reference (e.g. addFormula("a", "S", "S+1"))
  // is a FALSE NEGATIVE for this purpose: formulas resolve dependencies by
  // CHANNEL LETTER (see lib/formula.ts's colSnapshot/ctx keying), never by
  // the column's display `name`, so the only real self-reference a brand-
  // new column can make is against the LETTER it's about to occupy —
  // computed here via the exported `formulaLetter`, not guessed.
  it("refuses a new formula that references the channel letter it will itself occupy (P1 regression)", () => {
    const base = baseDs("a"); // 1 base column "A", no formulas yet
    useApp.setState({ datasets: [base] });
    const target = formulaLetter(base.data.labels.length, 0, 0); // the letter "S" will land on
    const beforeDatasets = useApp.getState().datasets;
    const beforeHistory = useApp.getState().history.length;

    const ok = useApp.getState().addFormula("a", "S", `${target} + 1`);

    expect(ok).toBe(false);
    expect(useApp.getState().status).toMatch(/cannot depend on itself/);
    // Zero mutation: same datasets array reference, no formula appended.
    expect(useApp.getState().datasets).toBe(beforeDatasets);
    expect(useApp.getState().datasets[0].formulas).toBeUndefined();
    // No history entry for a refused write.
    expect(useApp.getState().history.length).toBe(beforeHistory);
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

describe("removeFormula (DEFECT A closure, Sol audit P1-3): surviving formulas follow the shift", () => {
  it("the concrete corruption case: F3='B+C' errors instead of silently reading F2's data as 'B'", () => {
    // base m(A); F1(B)=A*1; F2(C)=A*2; F3(D)=B+C.
    const ds = dsWithFormulas("a", [
      { name: "F1", expr: "A * 1", deps: ["A"] },
      { name: "F2", expr: "A * 2", deps: ["A"] },
      { name: "F3", expr: "B + C", deps: ["B", "C"] },
    ]);
    useApp.setState({ datasets: [ds] });

    useApp.getState().removeFormula("a", 0); // remove F1 (letter B)

    const updated = useApp.getState().datasets[0];
    expect(updated.formulas?.map((f) => f.name)).toEqual(["F2", "F3"]);
    // F2 now occupies letter B (it shifted down from C).
    expect(updated.data.labels).toEqual(["A", "F2", "F3"]);
    // F3 must NOT silently evaluate against F2's data at its old "B" slot —
    // it must be flagged as an error, never a quietly-wrong number.
    expect(updated.formulaErrors?.F3).toBeDefined();
    expect(updated.formulaErrors?.F3).toMatch(/removed column/);
    expect(updated.data.values.every((row) => Number.isNaN(row[2]))).toBe(true);
  });

  it("rewrites a surviving formula's expr/deps to follow the shift when it does NOT reference the removed column", () => {
    // base m(A); F1(B)=A*1; F2(C)=A*2; F3(D)=A+C (only references C, not B).
    const ds = dsWithFormulas("a", [
      { name: "F1", expr: "A * 1", deps: ["A"] },
      { name: "F2", expr: "A * 2", deps: ["A"] },
      { name: "F3", expr: "A + C", deps: ["A", "C"] },
    ]);
    useApp.setState({ datasets: [ds] });

    useApp.getState().removeFormula("a", 0); // remove F1 (letter B)

    const updated = useApp.getState().datasets[0];
    const f3 = updated.formulas?.find((f) => f.name === "F3");
    // C (F2's old letter) shifted down to B.
    expect(f3?.expr).toMatch(/^A \+ B$/);
    expect(f3?.deps).toEqual(["A", "B"]);
    expect(updated.formulaErrors?.F3).toBeUndefined();
    // The rewritten formula still evaluates correctly against the shifted data.
    const aIdx = 0;
    const f2Idx = updated.data.labels.indexOf("F2");
    const f3Idx = updated.data.labels.indexOf("F3");
    updated.data.values.forEach((row) => {
      expect(row[f3Idx]).toBeCloseTo(row[aIdx] + row[f2Idx]);
    });
  });

  it("a formula referencing the removed column directly errors (deps rewrite case: partial refs also shift)", () => {
    // base m(A),n(B); F1(C)=A*1; F2(D)=B+C (references BASE column B and F1's C).
    const ds: Dataset = {
      id: "a",
      name: "a",
      data: {
        time: [0, 1, 2],
        values: [
          [1, 10, 0, 0],
          [2, 20, 0, 0],
          [3, 30, 0, 0],
        ],
        labels: ["A", "B", "F1", "F2"],
        units: ["", "", "", ""],
        metadata: {},
      },
      formulas: [
        { name: "F1", expr: "A * 1", deps: ["A"] },
        { name: "F2", expr: "B + C", deps: ["B", "C"] },
      ],
    };
    useApp.setState({ datasets: [ds] });

    useApp.getState().removeFormula("a", 0); // remove F1 (letter C)

    const updated = useApp.getState().datasets[0];
    expect(updated.formulas?.map((f) => f.name)).toEqual(["F2"]);
    expect(updated.formulaErrors?.F2).toMatch(/references removed column C/);
    expect(updated.formulas?.[0].deps).toEqual([]);
  });

  it("a recode column's sourceLetter follows the same shift/error rule as a plain expr", () => {
    const ds: Dataset = {
      id: "a",
      name: "a",
      data: {
        time: [0, 1],
        values: [
          [1, 0, 0],
          [2, 0, 0],
        ],
        labels: ["A", "F1", "Recoded"],
        units: ["", "", ""],
        metadata: {},
        cat_levels: { 0: ["x", "y"] },
      },
      formulas: [
        { name: "F1", expr: "A * 1", deps: ["A"] },
        {
          name: "Recoded",
          expr: "recode(B)",
          deps: ["B"],
          recode: { sourceLetter: "B", mapping: { groups: [] } },
        },
      ],
    };
    useApp.setState({ datasets: [ds] });

    useApp.getState().removeFormula("a", 0); // remove F1 (letter B) — Recoded sourced from it

    const updated = useApp.getState().datasets[0];
    const recoded = updated.formulas?.find((f) => f.name === "Recoded");
    expect(recoded?.recode?.sourceLetter).not.toBe("B"); // must not silently keep pointing at the shifted-in column
    expect(updated.formulaErrors?.Recoded).toMatch(/references removed column B/);
  });

  it("a recode sourced from a column AFTER the removed one has its sourceLetter shift, not error (chained recode)", () => {
    // A (base, categorical) -> F1 (A*1, letter B, to remove) -> Src (recode of
    // A, letter C) -> Recoded (recode of Src, letter D, sourceLetter "C").
    const ds: Dataset = {
      id: "a",
      name: "a",
      data: {
        time: [0, 1],
        values: [
          [0, 0, 0, 0],
          [1, 0, 0, 0],
        ],
        labels: ["A", "F1", "Src", "Recoded"],
        units: ["", "", "", ""],
        metadata: {},
        cat_levels: { 0: ["x", "y"] }, // A (a real base column, never shifts) is categorical
      },
      formulas: [
        { name: "F1", expr: "A * 1", deps: ["A"] },
        { name: "Src", expr: "recode(A)", deps: ["A"], recode: { sourceLetter: "A", mapping: { groups: [] } } },
        {
          name: "Recoded",
          expr: "recode(C)",
          deps: ["C"],
          recode: { sourceLetter: "C", mapping: { groups: [] } },
        },
      ],
    };
    useApp.setState({ datasets: [ds] });

    useApp.getState().removeFormula("a", 0); // remove F1 (letter B); Src shifts C -> B

    const updated = useApp.getState().datasets[0];
    const recoded = updated.formulas?.find((f) => f.name === "Recoded");
    expect(recoded?.recode?.sourceLetter).toBe("B");
    expect(recoded?.deps).toEqual(["B"]);
    expect(updated.formulaErrors?.Recoded).toBeUndefined();
  });

  it("a formula referencing only columns BEFORE the removed one is left untouched", () => {
    const ds = dsWithFormulas("a", [
      { name: "F1", expr: "A * 1", deps: ["A"] },
      { name: "F2", expr: "A * 2", deps: ["A"] },
    ]);
    useApp.setState({ datasets: [ds] });

    useApp.getState().removeFormula("a", 1); // remove F2 (letter C) — F1 unaffected

    const updated = useApp.getState().datasets[0];
    const f1 = updated.formulas?.find((f) => f.name === "F1");
    expect(f1?.expr).toBe("A * 1");
    expect(f1?.deps).toEqual(["A"]);
    expect(updated.formulaErrors?.F1).toBeUndefined();
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

// P2-2 (Sol's Day-6 audit): removeFormula's existence check must run BEFORE
// recordHistory -- a no-op removal (missing dataset id, or a dataset with no
// formulas at all) must never push a phantom undo entry.
describe("removeFormula never records a phantom no-op undo entry (P2-2)", () => {
  it("missing dataset id records no history", () => {
    useApp.setState({ datasets: [baseDs("a")] });
    const before = useApp.getState().history.length;
    useApp.getState().removeFormula("nope", 0);
    expect(useApp.getState().history.length).toBe(before);
  });

  it("a dataset with no formulas records no history", () => {
    useApp.setState({ datasets: [baseDs("a")] }); // no `formulas` field at all
    const before = useApp.getState().history.length;
    useApp.getState().removeFormula("a", 0);
    expect(useApp.getState().history.length).toBe(before);
  });

  it("a genuine removal still records exactly one history entry", () => {
    const ds = dsWithFormulas("a", [{ name: "b", expr: "A * 2", deps: ["A"] }]);
    useApp.setState({ datasets: [ds] });
    const before = useApp.getState().history.length;
    useApp.getState().removeFormula("a", 0);
    expect(useApp.getState().history.length).toBe(before + 1);
    expect(useApp.getState().datasets.find((d) => d.id === "a")?.formulas).toBeUndefined();
  });
});

// Independent-review BUG 1: `Dataset.errorRoles` is index-keyed on BOTH
// `channel` (the error column) and `target` (the column it describes), but
// `removeFormula` never remapped it -- unlike channelRoles/channelTypes/filter
// just above. A dataset with columns A, B, SCRATCH, SIGMA, OTHER, SIGMA bound
// as A's +/- error: removing SCRATCH must leave the binding pointing at
// SIGMA's NEW slot, not silently drift onto OTHER.
describe("removeFormula (BUG 1 closure): errorRoles follows the shift", () => {
  // Two base columns (A, B) plus three formula columns (SCRATCH, SIGMA,
  // OTHER) -- formulas are always the dataset's LAST columns (module doc),
  // so this lays out exactly A(0) B(1) SCRATCH(2) SIGMA(3) OTHER(4).
  function dsForErrorRoles(): Dataset {
    // Constant-valued formulas -- `removeFormula` RECOMPUTES every formula
    // column from `base` + `formulas` (withRecomputedFormulasAnd), so a
    // hand-written `values` array for a formula column would just be
    // overwritten; the true per-column value has to come from its `expr`.
    const formulas: ComputedColumn[] = [
      { name: "SCRATCH", expr: "0", deps: [] },
      { name: "SIGMA", expr: "7", deps: [] }, // the TRUE error value
      { name: "OTHER", expr: "999", deps: [] }, // unrelated -- what a broken remap would misread
    ];
    const labels = ["A", "B", ...formulas.map((f) => f.name)];
    return {
      id: "a",
      name: "a",
      data: {
        time: [0, 1],
        values: [
          [1, 10, 0, 7, 999],
          [2, 20, 0, 7, 999],
        ],
        labels,
        units: labels.map(() => ""),
        metadata: {},
      },
      formulas,
      errorRoles: [{ channel: 3, target: 0, axis: "y", side: "both" }], // SIGMA -> A
    };
  }

  it("remaps errorRoles' channel/target indices in the store write", () => {
    useApp.setState({ datasets: [dsForErrorRoles()] });
    useApp.getState().removeFormula("a", 0); // remove SCRATCH (formula index 0, column 2)
    const updated = useApp.getState().datasets.find((d) => d.id === "a");
    expect(updated?.data.labels).toEqual(["A", "B", "SIGMA", "OTHER"]);
    // SIGMA shifted from column 3 to column 2; A (target) is untouched.
    expect(updated?.errorRoles).toEqual([{ channel: 2, target: 0, axis: "y", side: "both" }]);
  });

  it("RENDERED CONSEQUENCE: buildErrorSpans reads the true +/-7, not the stale +/-999", () => {
    useApp.setState({ datasets: [dsForErrorRoles()] });
    useApp.getState().removeFormula("a", 0); // remove SCRATCH
    const updated = useApp.getState().datasets.find((d) => d.id === "a")!;

    const spans = buildErrorSpans(updated.data, [0], updated.errorRoles ?? []);
    const span = spans.get(1)?.find((s) => s.axis === "y"); // uPlot column 1 = plotted channel A
    expect(span?.plus).toEqual([7, 7]);
    expect(span?.minus).toEqual([7, 7]);
    // The corruption this bug produced: reading OTHER's 999 instead.
    expect(span?.plus).not.toEqual([999, 999]);
  });

  it("drops a binding whose channel or target WAS the removed column, rather than leaving it dangling", () => {
    // channel IS the removed column (SCRATCH itself wrongly bound as an error column).
    const dsChannelRemoved: Dataset = {
      ...dsForErrorRoles(),
      errorRoles: [{ channel: 2, target: 0, axis: "y", side: "both" }],
    };
    useApp.setState({ datasets: [dsChannelRemoved] });
    useApp.getState().removeFormula("a", 0);
    expect(useApp.getState().datasets.find((d) => d.id === "a")?.errorRoles).toEqual([]);

    // target IS the removed column (SCRATCH itself wrongly bound as a target).
    const dsTargetRemoved: Dataset = {
      ...dsForErrorRoles(),
      errorRoles: [{ channel: 3, target: 2, axis: "y", side: "both" }],
    };
    useApp.setState({ datasets: [dsTargetRemoved] });
    useApp.getState().removeFormula("a", 0);
    expect(useApp.getState().datasets.find((d) => d.id === "a")?.errorRoles).toEqual([]);
  });

  it("leaves a target: -1 (x-axis) error binding's target untouched -- it is a sentinel, not a column index", () => {
    const dsXError: Dataset = {
      ...dsForErrorRoles(),
      errorRoles: [{ channel: 3, target: -1, axis: "x", side: "both" }],
    };
    useApp.setState({ datasets: [dsXError] });
    useApp.getState().removeFormula("a", 0); // remove SCRATCH (column 2)
    // channel 3 (SIGMA) shifts to 2; target stays -1, never touched as if it were column 0.
    expect(useApp.getState().datasets.find((d) => d.id === "a")?.errorRoles).toEqual([
      { channel: 2, target: -1, axis: "x", side: "both" },
    ]);
  });
});

// Independent-review BUG 2: `facetKey`/`groupKey` are channel-indexed VIEW
// bindings ("bindings-owned like xKey/yKeys", lib/plotview.ts) but were
// missing from remapViewChannels, so removeFormula never remapped them for
// the active dataset's live view.
describe("removeFormula (BUG 2 closure): facetKey/groupKey follow the shift", () => {
  // Two base columns (A, GRP) plus three formula columns (F1, SITE, BATCH):
  // A(0) GRP(1) F1(2) SITE(3) BATCH(4) -- mirrors the reported scenario.
  function dsForFacet(): Dataset {
    const formulas: ComputedColumn[] = [
      { name: "F1", expr: "A * 1", deps: ["A"] },
      { name: "SITE", expr: "A * 2", deps: ["A"] },
      { name: "BATCH", expr: "A * 3", deps: ["A"] },
    ];
    const labels = ["A", "GRP", ...formulas.map((f) => f.name)];
    return {
      id: "a",
      name: "a",
      data: {
        time: [0, 1],
        values: [
          [1, 10, 0, 0, 0],
          [2, 20, 0, 0, 0],
        ],
        labels,
        units: labels.map(() => ""),
        metadata: {},
      },
      formulas,
    };
  }

  it("shifts a stale facetKey down instead of leaving it pointing at a different (later) column", () => {
    useApp.setState({ datasets: [dsForFacet()], activeId: "a", facetKey: 3, groupKey: 4 }); // faceted by SITE(3), grouped by BATCH(4)
    useApp.getState().removeFormula("a", 0); // remove F1 (formula index 0, column 2)
    // SITE shifts 3 -> 2, BATCH shifts 4 -> 3.
    expect(useApp.getState().facetKey).toBe(2);
    expect(useApp.getState().groupKey).toBe(3);
  });

  it("nulls facetKey/groupKey when the removed column WAS the bound one", () => {
    useApp.setState({ datasets: [dsForFacet()], activeId: "a", facetKey: 2, groupKey: 2 }); // both bound to F1 itself
    useApp.getState().removeFormula("a", 0); // remove F1
    expect(useApp.getState().facetKey).toBeNull();
    expect(useApp.getState().groupKey).toBeNull();
  });

  it("leaves facetKey/groupKey untouched when the dataset is not the active one", () => {
    useApp.setState({
      datasets: [dsForFacet(), baseDs("other")],
      activeId: "other",
      facetKey: 3,
      groupKey: 4,
    });
    useApp.getState().removeFormula("a", 0); // "a" is not active -- must not touch the live view
    expect(useApp.getState().facetKey).toBe(3);
    expect(useApp.getState().groupKey).toBe(4);
  });
});

// Independent review round 2 (2026-08-27), finding 1 -- the most serious of
// the three: `Dataset.fitSpec.xKey`/`.yKey` are channel-indexed exactly like
// errorRoles/facetKey above, but `remapDatasetChannels` never touched them.
// `removeFormula`'s trailing `touchDataset` runs `recomputeStaleFits`, which
// stamps a fresh fit result straight back onto `fitSpec` -- so a stale yKey
// doesn't just misdraw a fit spec, it silently OVERWRITES a saved fit's
// params with a fit of the WRONG column.
describe("removeFormula (finding 1, review round 2): fitSpec follows the shift", () => {
  // A(0) B(1) SCRATCH(2) SIGMA(3) OTHER(4) -- same layout as the errorRoles
  // fixture above; SIGMA's true value is 7 in every row, OTHER's is 999
  // (what a broken remap would misread after the shift).
  function dsForFitSpec(fitSpec: FitSpec): Dataset {
    const formulas: ComputedColumn[] = [
      { name: "SCRATCH", expr: "0", deps: [] },
      { name: "SIGMA", expr: "7", deps: [] },
      { name: "OTHER", expr: "999", deps: [] },
    ];
    const labels = ["A", "B", ...formulas.map((f) => f.name)];
    return {
      id: "a",
      name: "a",
      data: {
        time: [10, 20],
        values: [
          [1, 100, 0, 7, 999],
          [2, 200, 0, 7, 999],
        ],
        labels,
        units: labels.map(() => ""),
        metadata: {},
      },
      formulas,
      fitSpec,
    };
  }

  it("shifts a surviving yKey down with it -- RENDERED CONSEQUENCE: fitDataForSpec reads SIGMA's true 7s, not OTHER's stale 999s", () => {
    useApp.setState({ datasets: [dsForFitSpec({ model: "Linear", yKey: 3 })] }); // fit recorded against SIGMA (col 3)
    useApp.getState().removeFormula("a", 0); // remove SCRATCH (formula index 0, column 2)
    const updated = useApp.getState().datasets.find((d) => d.id === "a")!;
    expect(updated.fitSpec).toEqual({ model: "Linear", yKey: 2 }); // SIGMA shifted 3 -> 2
    const sel = fitDataForSpec(updated, updated.fitSpec!, null, null, null);
    expect(sel?.y).toEqual([7, 7]);
    // The corruption this bug produced: reading OTHER's 999 instead.
    expect(sel?.y).not.toEqual([999, 999]);
  });

  it("drops fitSpec ENTIRELY when the removed column WAS the fit's subject (yKey) -- a shifted or defaulted yKey would silently refit the wrong column", () => {
    useApp.setState({ datasets: [dsForFitSpec({ model: "Linear", yKey: 2 })] }); // fit recorded against SCRATCH itself
    useApp.getState().removeFormula("a", 0); // remove SCRATCH
    const updated = useApp.getState().datasets.find((d) => d.id === "a")!;
    expect(updated.fitSpec).toBeUndefined();
  });

  it("clears xKey to undefined (not null) when xKey WAS the removed column, keeping the surviving yKey", () => {
    useApp.setState({ datasets: [dsForFitSpec({ model: "Linear", xKey: 2, yKey: 3 })] }); // x=SCRATCH, y=SIGMA
    useApp.getState().removeFormula("a", 0); // remove SCRATCH (x's column)
    const updated = useApp.getState().datasets.find((d) => d.id === "a")!;
    expect(updated.fitSpec).toEqual({ model: "Linear", yKey: 2 }); // xKey undefined, absent from toEqual
    // RENDERED CONSEQUENCE: fitDataForSpec falls back to the time axis for x
    // (fitselection.ts's `xKey ?? null`), never re-reads whatever shifted
    // into SCRATCH's old slot.
    const sel = fitDataForSpec(updated, updated.fitSpec!, null, null, null);
    expect(sel?.x).toEqual([10, 20]);
  });
});

// Independent review round 2 (2026-08-27), finding 2 -- the third instance of
// the recurring class: a saved `editableFigures` document's `bindings` are
// channel-indexed exactly like the live view's xKey/yKeys/facetKey, but
// `removeFormula` never touched them, so a reopened saved figure plotted the
// wrong column.
describe("removeFormula (finding 2, review round 2): editableFigures' bindings follow the shift", () => {
  // A(0) F1(1) F2(2) F3(3) -- one base column, three formulas.
  function dsForFigures(): Dataset {
    const formulas: ComputedColumn[] = [
      { name: "F1", expr: "A * 1", deps: ["A"] },
      { name: "F2", expr: "A * 2", deps: ["A"] },
      { name: "F3", expr: "A * 3", deps: ["A"] },
    ];
    const labels = ["A", ...formulas.map((f) => f.name)];
    return {
      id: "a",
      name: "a",
      data: {
        time: [0, 1],
        values: [
          [1, 0, 0, 0],
          [2, 0, 0, 0],
        ],
        labels,
        units: labels.map(() => ""),
        metadata: {},
      },
      formulas,
    };
  }

  it("RENDERED CONSEQUENCE: a saved figure reopens on F2's true slot, not F3's, after F1 is removed", () => {
    const doc = createFigureDocument({
      id: "fig1",
      name: "Fig",
      datasetId: "a",
      view: { ...defaultPlotView(), yKeys: [3] }, // F3 (col 3) at save time
      facetKey: 2, // faceted by F2 (col 2)
    });
    useApp.setState({ datasets: [dsForFigures()], editableFigures: [doc] });
    useApp.getState().removeFormula("a", 0); // remove F1 (formula index 0, column 1)
    const updated = useApp.getState().editableFigures.find((d) => d.id === "fig1")!;
    // F3 shifts 3 -> 2, F2 shifts 2 -> 1.
    expect(updated.bindings.yKeys).toEqual([2]);
    expect(updated.bindings.facetKey).toBe(1);
  });

  it("nulls a binding whose column WAS removed", () => {
    const doc = createFigureDocument({
      id: "fig1",
      name: "Fig",
      datasetId: "a",
      view: { ...defaultPlotView(), yKeys: [1] }, // F1 itself
      groupKey: 1,
    });
    useApp.setState({ datasets: [dsForFigures()], editableFigures: [doc] });
    useApp.getState().removeFormula("a", 0); // remove F1
    const updated = useApp.getState().editableFigures.find((d) => d.id === "fig1")!;
    expect(updated.bindings.yKeys).toEqual([]);
    expect(updated.bindings.groupKey).toBeNull();
  });

  it("leaves a figure bound to a different dataset untouched", () => {
    const doc = createFigureDocument({
      id: "fig1",
      name: "Fig",
      datasetId: "other",
      view: { ...defaultPlotView(), yKeys: [3] },
    });
    useApp.setState({ datasets: [dsForFigures(), baseDs("other")], editableFigures: [doc] });
    useApp.getState().removeFormula("a", 0);
    const updated = useApp.getState().editableFigures.find((d) => d.id === "fig1")!;
    expect(updated.bindings.yKeys).toEqual([3]);
  });
});

// SILENT_STATE_CORRUPTION_PLAN Task 3 (2026-08-27): `remapFigureBindings`
// (finding 2 above, #244) covers `FigureBindings`, but a saved figure also
// holds a `plot.view` copy of `seriesOrder`/`hiddenChannels`/`seriesStyles`/
// `seriesLabels` -- channel-indexed exactly like the live view's identically
// named fields (see lib/channelRemap.ts's `remapViewChannels`) -- that
// `removeFormula` never touched. Severity is cosmetic (a style/hidden flag
// follows the shifted column, not "plots the wrong column"), but the plan's
// own acceptance case is concrete: hiding F1 must not silently hide F2 once
// F1 is gone and F2 has shifted into F1's old slot.
describe("removeFormula (Task 3, SILENT_STATE_CORRUPTION_PLAN): editableFigures' plot.view channel fields follow the shift", () => {
  // W(0) X(1) Y(2) F1(3) F2(4) -- three base columns, two formulas, so F1
  // lands at column 3 and F2 at column 4 (the plan's own acceptance case).
  function dsForPlotViewFigures(): Dataset {
    const formulas: ComputedColumn[] = [
      { name: "F1", expr: "W * 1", deps: ["W"] },
      { name: "F2", expr: "W * 2", deps: ["W"] },
    ];
    const labels = ["W", "X", "Y", ...formulas.map((f) => f.name)];
    return {
      id: "a",
      name: "a",
      data: {
        time: [0, 1],
        values: [
          [1, 10, 100, 0, 0],
          [2, 20, 200, 0, 0],
        ],
        labels,
        units: labels.map(() => ""),
        metadata: {},
      },
      formulas,
    };
  }

  it("ACCEPTANCE: a saved figure's hiddenChannels:[3] (F1) must not hide F2 (shifted 4 -> 3) after F1 is removed", () => {
    const doc = createFigureDocument({
      id: "fig1",
      name: "Fig",
      datasetId: "a",
      view: { ...defaultPlotView(), hiddenChannels: [3] }, // hides F1 (col 3)
    });
    useApp.setState({ datasets: [dsForPlotViewFigures()], editableFigures: [doc] });
    useApp.getState().removeFormula("a", 0); // remove F1 (formula index 0, column 3)
    const updated = useApp.getState().editableFigures.find((d) => d.id === "fig1")!;
    // F1 (the hidden column) is gone entirely; F2 shifted 4 -> 3 and must NOT
    // silently inherit F1's stale hide.
    expect(updated.plot.view.hiddenChannels).toEqual([]);
  });

  it("shifts seriesOrder/seriesStyles/seriesLabels entries down with the column, same as the live view", () => {
    const doc = createFigureDocument({
      id: "fig1",
      name: "Fig",
      datasetId: "a",
      view: {
        ...defaultPlotView(),
        seriesOrder: [4, 3],
        seriesStyles: { 4: { color: "#ff0000" } },
        seriesLabels: { 4: "F2 renamed" },
      },
    });
    useApp.setState({ datasets: [dsForPlotViewFigures()], editableFigures: [doc] });
    useApp.getState().removeFormula("a", 0); // remove F1 (column 3)
    const updated = useApp.getState().editableFigures.find((d) => d.id === "fig1")!;
    expect(updated.plot.view.seriesOrder).toEqual([3]);
    expect(updated.plot.view.seriesStyles).toEqual({ 3: { color: "#ff0000" } });
    expect(updated.plot.view.seriesLabels).toEqual({ 3: "F2 renamed" });
  });

  it("leaves a figure bound to a different dataset's plot.view untouched", () => {
    const doc = createFigureDocument({
      id: "fig1",
      name: "Fig",
      datasetId: "other",
      view: { ...defaultPlotView(), hiddenChannels: [4] },
    });
    useApp.setState({ datasets: [dsForPlotViewFigures(), baseDs("other")], editableFigures: [doc] });
    useApp.getState().removeFormula("a", 0);
    const updated = useApp.getState().editableFigures.find((d) => d.id === "fig1")!;
    expect(updated.plot.view.hiddenChannels).toEqual([4]);
  });
});

// Independent review round 2 (2026-08-27), finding 3 -- makes this branch's
// OWN facetKey fix (BUG 2 above) inert: `useEffectiveComposition` prefers the
// ephemeral `composition` render cache over the durable `facetKey` binding
// fallback, so a stale pre-removal `composition` keeps rendering even once
// `facetKey` is correctly remapped -- until an unrelated focus switch nulls
// `composition` out.
describe("removeFormula (finding 3, review round 2): composition is invalidated so the remapped facetKey wins", () => {
  // A(0) F1(1) SITE(2) BATCH(3) -- one base column, three formulas.
  function dsForComposition(): Dataset {
    const formulas: ComputedColumn[] = [
      { name: "F1", expr: "A * 1", deps: ["A"] },
      { name: "SITE", expr: "A * 2", deps: ["A"] }, // facet column: A=1,2 -> SITE=2,4 (2 levels)
      { name: "BATCH", expr: "A * 3", deps: ["A"] },
    ];
    const labels = ["A", ...formulas.map((f) => f.name)];
    return {
      id: "a",
      name: "a",
      data: {
        time: [0, 1],
        values: [
          [1, 0, 2, 0],
          [2, 0, 4, 0],
        ],
        labels,
        units: labels.map(() => ""),
        metadata: {},
      },
      formulas,
    };
  }

  it("RENDERED CONSEQUENCE: the pre-removal facet panels don't keep rendering -- composition is cleared so the stage rebuilds from the shifted facetKey", () => {
    const ds = dsForComposition();
    const staleComposition = facetComposition(facetPayloads(ds.data, 2, null, null)); // faceted by SITE (col 2), pre-removal
    useApp.setState({
      datasets: [ds],
      activeId: "a",
      facetKey: 2, // SITE
      composition: staleComposition,
    });
    useApp.getState().removeFormula("a", 0); // remove F1 (column 1)
    // The immediate render cache must not keep showing the pre-removal panels.
    expect(useApp.getState().composition).toBeNull();
    // The durable binding shifted correctly (SITE: 2 -> 1)...
    expect(useApp.getState().facetKey).toBe(1);
    // ...and the fallback `useEffectiveComposition` uses rebuilds correctly off it.
    const updatedDs = useApp.getState().datasets.find((d) => d.id === "a")!;
    const rebuilt = facetCompositionFromBinding(updatedDs, useApp.getState().facetKey, null, null);
    expect(rebuilt?.kind).toBe("facet");
    expect(rebuilt && "panels" in rebuilt ? rebuilt.panels.length : 0).toBe(2);
  });

  it("leaves composition untouched when the dataset is not the active one", () => {
    const ds = dsForComposition();
    const staleComposition = facetComposition(facetPayloads(ds.data, 2, null, null));
    useApp.setState({
      datasets: [ds, baseDs("other")],
      activeId: "other",
      facetKey: 2,
      composition: staleComposition,
    });
    useApp.getState().removeFormula("a", 0);
    expect(useApp.getState().composition).toBe(staleComposition);
  });
});
