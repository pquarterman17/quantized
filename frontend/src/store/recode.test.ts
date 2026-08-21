// J2 Recode workshop store (standalone, store/relink.ts precedent).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ComputedColumn, Dataset } from "../lib/types";
import { activeRecodePreview, useRecode } from "./recode";
import { toast } from "./toasts";
import { useApp } from "./useApp";

vi.mock("./toasts", () => ({ toast: vi.fn() }));

function catDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "grades.dat",
    data: {
      time: [0, 1, 2, 3],
      values: [[0], [1], [2], [1]],
      labels: ["Grade"],
      units: [""],
      metadata: {},
      cat_levels: { 0: ["Pass", "OK", "Fail"] },
    },
    ...over,
  };
}

const active = () => useApp.getState().datasets.find((d) => d.id === "d1")!;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [catDataset()], activeId: "d1" });
  useRecode.setState({ open: false, datasetId: null, channel: null, mapping: { groups: [] }, newColumnName: "", savedMappings: [] });
});

describe("openRecode", () => {
  it("opens on a categorical column, seeding an empty draft + a default name", () => {
    useRecode.getState().openRecode("d1", 0);
    const s = useRecode.getState();
    expect(s.open).toBe(true);
    expect(s.datasetId).toBe("d1");
    expect(s.channel).toBe(0);
    expect(s.mapping).toEqual({ groups: [] });
    expect(s.newColumnName).toBe("Grade (recoded)");
  });

  it("refuses (toast, stays closed) on a non-categorical column", () => {
    useApp.setState({ datasets: [{ ...catDataset(), data: { ...catDataset().data, cat_levels: undefined } }] });
    useRecode.getState().openRecode("d1", 0);
    expect(useRecode.getState().open).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/isn't categorical/), "danger");
  });
});

describe("setGroup / clearLevel — draft editing", () => {
  beforeEach(() => useRecode.getState().openRecode("d1", 0));

  it("merges named levels into one group, moving them out of any prior group", () => {
    useRecode.getState().setGroup("Passing", ["Pass", "OK"]);
    expect(useRecode.getState().mapping.groups).toEqual([{ newLabel: "Passing", from: ["Pass", "OK"] }]);
    // Reassigning "OK" elsewhere removes it from the first group instead of
    // belonging to both.
    useRecode.getState().setGroup("Other", ["OK"]);
    expect(useRecode.getState().mapping.groups).toEqual([
      { newLabel: "Passing", from: ["Pass"] },
      { newLabel: "Other", from: ["OK"] },
    ]);
  });

  it("clearLevel reverts a level to identity, dropping an emptied group", () => {
    useRecode.getState().setGroup("Passing", ["Pass"]);
    useRecode.getState().clearLevel("Pass");
    expect(useRecode.getState().mapping.groups).toEqual([]);
  });
});

describe("activeRecodePreview — the live old->new table", () => {
  it("reflects the draft mapping against the open column's current levels", () => {
    useRecode.getState().openRecode("d1", 0);
    useRecode.getState().setGroup("Passing", ["Pass", "OK"]);
    const preview = activeRecodePreview();
    expect(preview?.rows).toEqual([
      { oldLevel: "Pass", newLevel: "Passing" },
      { oldLevel: "OK", newLevel: "Passing" },
      { oldLevel: "Fail", newLevel: "Fail" },
    ]);
    expect(preview?.newLevels).toEqual(["Passing", "Fail"]);
  });

  it("is null when no panel is open", () => {
    expect(activeRecodePreview()).toBeNull();
  });
});

describe("applyFindReplace", () => {
  it("replaces the draft with a mapping built from the column's current levels", () => {
    useRecode.getState().openRecode("d1", 0);
    useRecode.getState().applyFindReplace("Fail", "Failed");
    expect(useRecode.getState().mapping.groups).toEqual([{ newLabel: "Failed", from: ["Fail"] }]);
  });
});

describe("commitRecode", () => {
  beforeEach(() => useRecode.getState().openRecode("d1", 0));

  it("appends a derived column, one undo entry, raw stays immutable", () => {
    useRecode.getState().setGroup("Passing", ["Pass", "OK"]);
    const letter = useRecode.getState().commitRecode();
    expect(letter).toBe("B");
    const d = active();
    expect(d.data.labels).toEqual(["Grade", "Grade (recoded)"]);
    expect(d.data.values.map((r) => r[0])).toEqual([0, 1, 2, 1]); // source untouched
    expect(d.formulas?.[0].recode).toEqual({
      sourceLetter: "A",
      mapping: { groups: [{ newLabel: "Passing", from: ["Pass", "OK"] }] },
    });
    useApp.getState().undo();
    expect(active().data.labels).toEqual(["Grade"]); // one undo removes the whole commit
  });

  it("closes the panel on success", () => {
    useRecode.getState().commitRecode();
    expect(useRecode.getState().open).toBe(false);
  });

  it("refuses (zero mutation) when the source is no longer categorical", () => {
    useApp.setState({ datasets: [{ ...catDataset(), data: { ...catDataset().data, cat_levels: undefined } }] });
    const before = active();
    const letter = useRecode.getState().commitRecode();
    expect(letter).toBeNull();
    expect(active()).toBe(before);
  });
});

describe("commitRecode — DEFECT B closure (Sol audit P1-3): stale-index resync/refuse", () => {
  // Three categorical columns: base "Grade" (A), then two REAL recode
  // columns of it, "Grade2" (identity recode, letter C) and "Grade3"
  // (identity recode, letter D) — both regenerate their own cat_levels on
  // any recompute (unlike a plain `expr` formula), so they stay genuinely
  // categorical across the shift this test forces, keeping the test focused
  // on IDENTITY resolution rather than an unrelated categorical-ness lapse.
  // An unrelated plain formula "Filler" (letter B) sits BEFORE them so
  // removing it shifts both down by one: Grade2 C->B, Grade3 D->C.
  function shiftableDataset(): Dataset {
    const levels = ["Pass", "OK", "Fail"];
    const code: number[] = [0, 1, 2, 1];
    return {
      id: "d1",
      name: "grades.dat",
      data: {
        time: [0, 1, 2, 3],
        values: code.map((c) => [c, 0, c, c]),
        labels: ["Grade", "Filler", "Grade2", "Grade3"],
        units: ["", "", "", ""],
        metadata: {},
        cat_levels: { 0: levels, 2: levels, 3: levels },
      },
      formulas: [
        { name: "Filler", expr: "A * 0", deps: ["A"] },
        { name: "Grade2", expr: "recode(A)", deps: ["A"], recode: { sourceLetter: "A", mapping: { groups: [] } } },
        { name: "Grade3", expr: "recode(A)", deps: ["A"], recode: { sourceLetter: "A", mapping: { groups: [] } } },
      ] satisfies ComputedColumn[],
    };
  }

  it("RETARGETS to the column the panel actually opened on, never the column that shifted into the stale index", () => {
    useApp.setState({ datasets: [shiftableDataset()], activeId: "d1" });
    useRecode.getState().openRecode("d1", 2); // "Grade2" — channel=2, openLabel="Grade2"
    expect(useRecode.getState().openLabel).toBe("Grade2");
    useRecode.getState().setGroup("Passing", ["Pass", "OK"]);

    // Remove "Filler" elsewhere (the SAME index-shift removeFormula produces
    // for DEFECT A) — Grade2 shifts C->B, Grade3 shifts D->C, so the STALE
    // channel index (2) now names Grade3, not Grade2.
    useApp.getState().removeFormula("d1", 0);
    expect(active().data.labels).toEqual(["Grade", "Grade2", "Grade3"]);

    const letter = useRecode.getState().commitRecode();

    expect(letter).not.toBeNull();
    const committed = active().formulas?.at(-1);
    expect(committed?.name).toBe("Grade2 (recoded)");
    // Must be sourced from Grade2 (now letter B) — NOT Grade3 (letter C),
    // which is what the stale index would have silently produced pre-fix.
    expect(committed?.recode?.sourceLetter).toBe("B");
  });

  it("REFUSES (panel stays open, draft intact) when the opened column no longer exists anywhere", () => {
    useApp.setState({ datasets: [shiftableDataset()], activeId: "d1" });
    useRecode.getState().openRecode("d1", 2); // "Grade2"
    useRecode.getState().setGroup("Passing", ["Pass", "OK"]);
    const draftBefore = useRecode.getState().mapping;

    // Simulate a reimport that renamed the column away entirely (reimport.ts
    // never touches useRecode — this reproduces that gap directly).
    useApp.setState((s) => ({
      datasets: [{ ...s.datasets[0], data: { ...s.datasets[0].data, labels: ["Grade", "Filler", "Renamed", "Grade3"] } }],
    }));

    const letter = useRecode.getState().commitRecode();

    expect(letter).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Grade2/), "danger");
    expect(useRecode.getState().open).toBe(true); // panel stays open
    expect(useRecode.getState().mapping).toBe(draftBefore); // draft untouched
  });

  it("REFUSES (never guesses) when the opened column's label is now ambiguous", () => {
    useApp.setState({ datasets: [shiftableDataset()], activeId: "d1" });
    useRecode.getState().openRecode("d1", 2); // "Grade2"

    // Two columns now carry the opened label, and the stale index isn't
    // either of them.
    useApp.setState((s) => ({
      datasets: [{ ...s.datasets[0], data: { ...s.datasets[0].data, labels: ["Grade2", "Filler", "Other", "Grade2"] } }],
    }));

    const letter = useRecode.getState().commitRecode();

    expect(letter).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/ambiguous/), "danger");
    expect(useRecode.getState().open).toBe(true);
  });

  it("activeRecodePreview resyncs the same way (never previews the wrong column)", () => {
    useApp.setState({ datasets: [shiftableDataset()], activeId: "d1" });
    useRecode.getState().openRecode("d1", 2); // "Grade2"
    useApp.getState().removeFormula("d1", 0); // Grade2 shifts C->B

    const preview = activeRecodePreview();

    // Grade2's levels (identity recode of Grade) — NOT Grade3's, and NOT
    // null just because the raw index moved.
    expect(preview?.newLevels).toEqual(["Pass", "OK", "Fail"]);
  });
});

describe("saveMapping / applySavedMapping — save + reapply with refusal (J2 item 3)", () => {
  it("saves the current draft and reapplies it to a DIFFERENT column with matching levels", () => {
    useRecode.getState().openRecode("d1", 0);
    useRecode.getState().setGroup("Passing", ["Pass", "OK"]);
    useRecode.getState().saveMapping("Pass/Fail grouping");
    expect(useRecode.getState().savedMappings).toHaveLength(1);

    // Open on a second categorical column with the SAME levels (a different
    // dataset in practice, simplified here to a second column).
    useApp.setState((s) => ({
      datasets: [
        {
          ...s.datasets[0],
          data: {
            ...s.datasets[0].data,
            labels: ["Grade", "Grade2"],
            units: ["", ""],
            values: s.datasets[0].data.values.map((r) => [...r, r[0]]),
            cat_levels: { 0: ["Pass", "OK", "Fail"], 1: ["Pass", "OK", "Fail"] },
          },
        },
      ],
    }));
    useRecode.getState().openRecode("d1", 1);
    const id = useRecode.getState().savedMappings[0].id;
    useRecode.getState().applySavedMapping(id);
    expect(useRecode.getState().mapping.groups).toEqual([{ newLabel: "Passing", from: ["Pass", "OK"] }]);
  });

  it("refuses with every unmatched level named, never a partial apply", () => {
    useRecode.getState().openRecode("d1", 0);
    useRecode.getState().setGroup("Passing", ["Pass", "OK"]);
    useRecode.getState().saveMapping("Pass/Fail grouping");
    const id = useRecode.getState().savedMappings[0].id;

    // Reopen on a column whose levels don't include "OK".
    useApp.setState((s) => ({
      datasets: [{ ...s.datasets[0], data: { ...s.datasets[0].data, cat_levels: { 0: ["Pass", "Fail"] } } }],
    }));
    useRecode.getState().openRecode("d1", 0);
    const draftBefore = useRecode.getState().mapping;
    useRecode.getState().applySavedMapping(id);
    expect(useRecode.getState().mapping).toBe(draftBefore); // unchanged — refused
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/OK/), "danger");
  });
});
