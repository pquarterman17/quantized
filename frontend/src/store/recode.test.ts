// J2 Recode workshop store (standalone, store/relink.ts precedent).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
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
