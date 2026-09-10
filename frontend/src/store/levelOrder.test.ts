// Group O-2b: the categorical level reorder store (standalone, store/
// recode.ts precedent).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { filteredOutRows } from "../lib/datafilter";
import type { ComputedColumn, Dataset } from "../lib/types";
import { useLevelOrder } from "./levelOrder";
import { toast } from "./toasts";
import { useApp } from "./useApp";

vi.mock("./toasts", () => ({ toast: vi.fn() }));

function catDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "grades.dat",
    data: {
      time: [0, 1, 2, 3],
      values: [[0], [1], [2], [3]],
      labels: ["Grade"],
      units: [""],
      metadata: {},
      // code 0 -> Bravo, 1 -> Alpha, 2 -> Delta, 3 -> Charlie. Alphabetical
      // order differs from code order on purpose (sortByLabel non-vacuity).
      cat_levels: { 0: ["Bravo", "Alpha", "Delta", "Charlie"] },
    },
    ...over,
  };
}

const active = () => useApp.getState().datasets.find((d) => d.id === "d1")!;
const resetPanel = () => useLevelOrder.setState({ open: false, datasetId: null, channel: null, openLabel: null, draft: [] });

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [catDataset()], activeId: "d1" });
  resetPanel();
});

describe("openLevelOrder", () => {
  it("opens on a categorical column, seeding the draft from the CURRENT display order", () => {
    useLevelOrder.getState().openLevelOrder("d1", 0);
    const s = useLevelOrder.getState();
    expect(s.open).toBe(true);
    expect(s.datasetId).toBe("d1");
    expect(s.channel).toBe(0);
    expect(s.openLabel).toBe("Grade");
    expect(s.draft).toEqual([0, 1, 2, 3]); // no level_order yet -> ascending
  });

  it("seeds the draft from a STORED level_order, not plain ascending", () => {
    useApp.setState({ datasets: [catDataset({ data: { ...catDataset().data, level_order: { 0: [2, 0, 1, 3] } } })] });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    expect(useLevelOrder.getState().draft).toEqual([2, 0, 1, 3]);
  });

  it("refuses (toast, stays closed) on a non-categorical column", () => {
    useApp.setState({ datasets: [{ ...catDataset(), data: { ...catDataset().data, cat_levels: undefined } }] });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    expect(useLevelOrder.getState().open).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/isn't categorical/), "danger");
  });
});

describe("moveUp / moveDown", () => {
  beforeEach(() => useLevelOrder.getState().openLevelOrder("d1", 0)); // draft = [0,1,2,3]

  it("swaps a level up one place", () => {
    useLevelOrder.getState().moveUp(2);
    expect(useLevelOrder.getState().draft).toEqual([0, 2, 1, 3]);
  });

  it("swaps a level down one place", () => {
    useLevelOrder.getState().moveDown(1);
    expect(useLevelOrder.getState().draft).toEqual([0, 2, 1, 3]);
  });

  it("moveUp at the first row is a no-op", () => {
    useLevelOrder.getState().moveUp(0);
    expect(useLevelOrder.getState().draft).toEqual([0, 1, 2, 3]);
  });

  it("moveDown at the last row is a no-op", () => {
    useLevelOrder.getState().moveDown(3);
    expect(useLevelOrder.getState().draft).toEqual([0, 1, 2, 3]);
  });
});

describe("sortByLabel", () => {
  it("orders by display LABEL, not code — non-vacuous (alphabetical order differs from code order)", () => {
    useLevelOrder.getState().openLevelOrder("d1", 0); // draft = [0,1,2,3] (Bravo,Alpha,Delta,Charlie)
    useLevelOrder.getState().sortByLabel();
    // Alphabetical: Alpha(1), Bravo(0), Charlie(3), Delta(2).
    expect(useLevelOrder.getState().draft).toEqual([1, 0, 3, 2]);
  });

  it("is a STABLE sort — two levels sharing one label keep their prior relative order", () => {
    // A second dataset where codes 1 and 2 display the SAME label "A".
    useApp.setState({
      datasets: [
        catDataset({
          data: {
            ...catDataset().data,
            cat_levels: { 0: ["B", "A", "A", "C"] }, // code0=B, code1=A, code2=A, code3=C
          },
        }),
      ],
    });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    // Review round MEDIUM 4: the tied pair (1, 2) must be seeded in
    // DESCENDING relative order. An earlier version seeded [3, 0, 1, 2] —
    // ascending — where a comparator that tiebreaks by ascending code
    // (`labelOf(a).localeCompare(labelOf(b)) || (a - b)`) emits exactly the
    // same array as a stable sort, so the test passed under that sabotage
    // while its comment claimed it could not. Seeded 2-before-1, the two
    // answers differ: stable keeps [2, 1, ...], an ascending-code tiebreak
    // emits [1, 2, ...].
    useLevelOrder.setState({ draft: [3, 0, 2, 1] });
    useLevelOrder.getState().sortByLabel();
    // Ascending labels: A, A, B, C.
    expect(useLevelOrder.getState().draft).toEqual([2, 1, 0, 3]);
  });
});

describe("resetToCodeOrder", () => {
  it("sets the draft to ascending code order without touching the store", () => {
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().moveUp(2); // perturb the draft
    expect(useLevelOrder.getState().draft).not.toEqual([0, 1, 2, 3]);
    useLevelOrder.getState().resetToCodeOrder();
    expect(useLevelOrder.getState().draft).toEqual([0, 1, 2, 3]);
    expect(active().data.level_order).toBeUndefined(); // draft-only, nothing committed yet
  });
});

describe("commit — membership is never changed", () => {
  it("a permuted draft commits to exactly a permutation of the present codes", () => {
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().moveUp(3); // draft: [0,1,3,2]
    const ok = useLevelOrder.getState().commit();
    expect(ok).toBe(true);
    const stored = active().data.level_order?.[0];
    expect(stored).toEqual([0, 1, 3, 2]);
    expect([...stored!].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]); // same set, nothing added/dropped
  });

  it("closes the panel on success", () => {
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().moveUp(3);
    useLevelOrder.getState().commit();
    expect(useLevelOrder.getState().open).toBe(false);
  });
});

describe("commit — reset-to-ascending DELETES rather than stores", () => {
  it("resetToCodeOrder then commit removes the key (not an ascending array)", () => {
    useApp.setState({ datasets: [catDataset({ data: { ...catDataset().data, level_order: { 0: [3, 2, 1, 0] } } })] });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().resetToCodeOrder();
    useLevelOrder.getState().commit();
    expect(active().data.level_order).toBeUndefined(); // the whole map dropped — the ONLY entry
    expect(Object.prototype.hasOwnProperty.call(active().data, "level_order")).toBe(false);
  });

  it("drops only the committed channel's key, leaving a sibling channel's order intact", () => {
    useApp.setState({
      datasets: [
        catDataset({
          data: {
            time: [0, 1, 2, 3],
            values: [[0, 0], [1, 1], [2, 2], [3, 3]],
            labels: ["Grade", "Grade2"],
            units: ["", ""],
            metadata: {},
            cat_levels: { 0: ["Bravo", "Alpha", "Delta", "Charlie"], 1: ["Bravo", "Alpha", "Delta", "Charlie"] },
            level_order: { 0: [3, 2, 1, 0], 1: [1, 0, 2, 3] },
          },
        }),
      ],
    });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().resetToCodeOrder();
    useLevelOrder.getState().commit();
    expect(active().data.level_order).toEqual({ 1: [1, 0, 2, 3] }); // channel 0's key gone, 1's untouched
  });

  it("a MANUAL drag back to ascending also deletes rather than stores (agrees with resetToCodeOrder)", () => {
    useApp.setState({ datasets: [catDataset({ data: { ...catDataset().data, level_order: { 0: [1, 0, 2, 3] } } })] });
    useLevelOrder.getState().openLevelOrder("d1", 0); // draft seeded [1,0,2,3]
    useLevelOrder.getState().moveUp(0); // manually drag 0 back above 1 -> [0,1,2,3], plain ascending
    expect(useLevelOrder.getState().draft).toEqual([0, 1, 2, 3]);
    useLevelOrder.getState().commit();
    expect(active().data.level_order).toBeUndefined(); // same outcome as the Reset button
  });
});

describe("commit — fail-open re-derivation of a stale draft", () => {
  it("a vanished code is dropped from the committed order, never re-invented", () => {
    useLevelOrder.getState().openLevelOrder("d1", 0); // draft = [0,1,2,3]
    // Put 1 before 0 (a non-ascending relative order for the two survivors
    // below) so the fail-open re-derivation has something non-trivial to
    // preserve, not just happen to land back on ascending.
    useLevelOrder.setState({ draft: [1, 3, 2, 0] });
    // Simulate the column shrinking to 2 levels while the panel sat open
    // (e.g. a cell edit elsewhere collapsed the level table) — code 2 and 3
    // no longer occur in `values`, only 0 and 1 remain present.
    useApp.setState((s) => ({
      datasets: [
        {
          ...s.datasets[0],
          data: {
            ...s.datasets[0].data,
            values: [[0], [1], [0], [1]],
            cat_levels: { 0: ["Bravo", "Alpha"] },
          },
        },
      ],
    }));
    const ok = useLevelOrder.getState().commit();
    expect(ok).toBe(true);
    const stored = active().data.level_order?.[0];
    // Only 0 and 1 may appear — 2 and 3 (named in the stale draft) must not
    // be written back into membership — and their draft ORDER (1 before 0)
    // survives, which is also why this isn't a no-op delete-to-ascending.
    expect(stored).toEqual([1, 0]);
  });

  it("an appeared code lands ascending at the end, not dropped", () => {
    useLevelOrder.getState().openLevelOrder("d1", 0); // draft = [0,1,2,3]
    useLevelOrder.getState().moveUp(3); // draft = [0,1,3,2] — names all four existing codes
    // Simulate a 5th level (code 4) appearing while the panel sat open.
    useApp.setState((s) => ({
      datasets: [
        {
          ...s.datasets[0],
          data: {
            ...s.datasets[0].data,
            values: [...s.datasets[0].data.values, [4]],
            time: [...s.datasets[0].data.time, 4],
            cat_levels: { 0: ["Bravo", "Alpha", "Delta", "Charlie", "Echo"] },
          },
        },
      ],
    }));
    useLevelOrder.getState().commit();
    const stored = active().data.level_order?.[0];
    expect(stored).toEqual([0, 1, 3, 2, 4]); // 4 wasn't in the draft -> appended, ascending among unnamed
  });
});

describe("commit — DEFECT B: stale-index resync/refuse", () => {
  // Same construction as store/recode.test.ts's DEFECT B suite: three
  // categorical columns, a plain-formula "Filler" sitting before two real
  // recode columns so removing it shifts both down by one.
  function shiftableDataset(): Dataset {
    const levels = ["Bravo", "Alpha", "Delta", "Charlie"];
    const code: number[] = [0, 1, 2, 3];
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

  it("RETARGETS to the column the panel actually opened on, writing level_order under the NEW index", () => {
    useApp.setState({ datasets: [shiftableDataset()], activeId: "d1" });
    useLevelOrder.getState().openLevelOrder("d1", 2); // "Grade2" — channel=2, openLabel="Grade2"
    useLevelOrder.getState().moveUp(3); // perturb the draft (not ascending)

    // Remove "Filler" — Grade2 shifts C(2)->B(1), Grade3 shifts D(3)->C(2).
    useApp.getState().removeFormula("d1", 0);
    expect(active().data.labels).toEqual(["Grade", "Grade2", "Grade3"]);

    const ok = useLevelOrder.getState().commit();

    expect(ok).toBe(true);
    // Written under channel 1 (Grade2's NEW index), never 2 (Grade3, what
    // the stale index would have silently hit pre-fix).
    expect(active().data.level_order?.[1]).toBeDefined();
    expect(active().data.level_order?.[2]).toBeUndefined();
  });

  it("updates `channel` in the panel state on a resolved retarget, observable even when a LATER guard still refuses the commit", () => {
    useApp.setState({ datasets: [shiftableDataset()], activeId: "d1" });
    useLevelOrder.getState().openLevelOrder("d1", 2); // "Grade2" — channel=2
    useApp.getState().removeFormula("d1", 0); // Grade2 shifts C(2)->B(1) — real shift, no pending yet

    // NOW mark the dataset pending, directly (removeFormula itself also
    // refuses on a pending dataset, so it has to happen after the shift) —
    // refusePendingEdit fires AFTER the retarget `set` but before anything
    // else in `commit`, so the resync is observable without the success
    // path's own panel-close hiding it.
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "d1" ? { ...d, pending: { kind: "upload", bookId: "b1", rows: 4, cols: 1, previewSampled: true } } : d)),
    }));

    const ok = useLevelOrder.getState().commit();

    expect(ok).toBe(false); // still refused (pending)
    expect(useLevelOrder.getState().channel).toBe(1); // but the resync itself already ran
    expect(useLevelOrder.getState().open).toBe(true);
  });

  it("REFUSES (panel stays open, draft intact, zero mutation) when the opened column no longer exists anywhere", () => {
    useApp.setState({ datasets: [shiftableDataset()], activeId: "d1" });
    useLevelOrder.getState().openLevelOrder("d1", 2); // "Grade2"
    useLevelOrder.getState().moveUp(3);
    const draftBefore = useLevelOrder.getState().draft;

    useApp.setState((s) => ({
      datasets: [{ ...s.datasets[0], data: { ...s.datasets[0].data, labels: ["Grade", "Filler", "Renamed", "Grade3"] } }],
    }));

    const ok = useLevelOrder.getState().commit();

    expect(ok).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Grade2/), "danger");
    expect(toast).toHaveBeenCalledWith(expect.not.stringMatching(/recode/i), "danger"); // copy rewritten, not Recode's
    expect(useLevelOrder.getState().open).toBe(true); // panel stays open
    expect(useLevelOrder.getState().draft).toBe(draftBefore); // draft untouched
    // Zero mutation from the commit itself — no level_order was ever written.
    expect(active().data.level_order).toBeUndefined();
  });

  it("REFUSES (never guesses) when the opened column's label is now ambiguous", () => {
    useApp.setState({ datasets: [shiftableDataset()], activeId: "d1" });
    useLevelOrder.getState().openLevelOrder("d1", 2); // "Grade2"

    useApp.setState((s) => ({
      datasets: [{ ...s.datasets[0], data: { ...s.datasets[0].data, labels: ["Grade2", "Filler", "Other", "Grade2"] } }],
    }));

    const ok = useLevelOrder.getState().commit();

    expect(ok).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/ambiguous/), "danger");
    expect(useLevelOrder.getState().open).toBe(true);
  });
});

describe("commit — refuses on a pending dataset (BUG-006 site 9 class)", () => {
  it("does nothing, records no undo entry, and says why", () => {
    useApp.setState({
      datasets: [{ ...catDataset(), pending: { kind: "upload", bookId: "b1", rows: 4, cols: 1, previewSampled: true } }],
      activeId: "d1",
      history: [],
    } as unknown as Parameters<typeof useApp.setState>[0]);
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().moveUp(3);

    const ok = useLevelOrder.getState().commit();

    expect(ok).toBe(false);
    expect(active().data.level_order).toBeUndefined();
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toMatch(/still loading its full data/);
    expect(useLevelOrder.getState().open).toBe(true); // panel stays open
  });
});

describe("undo — one entry", () => {
  it("commit then undo restores the prior order exactly, in ONE history entry", () => {
    useApp.setState({
      datasets: [catDataset({ data: { ...catDataset().data, level_order: { 0: [2, 0, 1, 3] } } })],
      history: [],
    });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().sortByLabel();
    useLevelOrder.getState().commit();
    expect(active().data.level_order?.[0]).not.toEqual([2, 0, 1, 3]); // it did change
    // Review round MEDIUM 3: the store header and the commit message both
    // claim "ONE recordHistory, so a reorder is one undo entry", and NOTHING
    // asserted it — adding a second `recordHistory` next to the first left
    // both undo tests green, because two pre-mutation snapshots restore the
    // same state and one `undo()` cannot tell them apart. Assert the DEPTH.
    expect(useApp.getState().history).toHaveLength(1);

    useApp.getState().undo();

    expect(active().data.level_order).toEqual({ 0: [2, 0, 1, 3] }); // exactly the prior order restored
    expect(useApp.getState().history).toHaveLength(0); // and nothing left to undo
  });

  it("commit then undo restores an absent level_order (no phantom entry left behind)", () => {
    useLevelOrder.getState().openLevelOrder("d1", 0); // no level_order at all yet
    useLevelOrder.getState().moveUp(3);
    useLevelOrder.getState().commit();
    expect(active().data.level_order).toBeDefined();

    useApp.getState().undo();

    expect(active().data.level_order).toBeUndefined();
  });
});

describe("commit never destroys an order for a level that has no rows (review HIGH 1)", () => {
  /** `cat_levels` declares Low/Mid/High but only Low and High occur in any
   *  row — the state a row delete, a `lib/merge.ts` union remap, or a `.dwk`
   *  can all produce. */
  const declaredButAbsent = () =>
    catDataset({
      data: {
        time: [1, 2],
        values: [[0], [2]],
        labels: ["Grade"],
        units: [""],
        metadata: {},
        cat_levels: { 0: ["Low", "Mid", "High"] },
        level_order: { 0: [1, 0, 2] }, // Mid, Low, High
      },
    });

  it("a no-op Commit leaves the stored order intact instead of deleting it", () => {
    useApp.setState({ datasets: [declaredButAbsent()], activeId: "d1" });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    // The panel SHOWS the declared-but-absent level, which is the only way a
    // user can position it deliberately.
    expect(useLevelOrder.getState().draft).toEqual([1, 0, 2]);
    expect(useLevelOrder.getState().commit()).toBe(true);
    // Before the fix this deleted `level_order` outright: the draft pruned to
    // the PRESENT codes [0, 2], which is ascending, so the ascending check
    // fired. The user's Mid-first preference vanished on a Commit they
    // believed changed nothing, and came back ascending once Mid rows did.
    expect(active().data.level_order).toEqual({ 0: [1, 0, 2] });
  });

  it("an explicit reorder keeps the absent level in its chosen slot", () => {
    useApp.setState({ datasets: [declaredButAbsent()], activeId: "d1" });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().moveUp(2); // High above Low -> Mid, High, Low
    useLevelOrder.getState().commit();
    expect(active().data.level_order).toEqual({ 0: [1, 2, 0] });
  });

  it("reset-to-code-order still DELETES, over the declared domain", () => {
    useApp.setState({ datasets: [declaredButAbsent()], activeId: "d1" });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().resetToCodeOrder();
    expect(useLevelOrder.getState().draft).toEqual([0, 1, 2]); // the union, ascending
    useLevelOrder.getState().commit();
    expect(active().data.level_order).toBeUndefined();
  });
});

describe("delete rule — branches nothing covered (review LOW 8)", () => {
  it("resetting one channel keeps a -1 (x column) entry, so level_order survives", () => {
    useApp.setState({
      datasets: [
        catDataset({
          data: { ...catDataset().data, level_order: { 0: [3, 2, 1, 0], [-1]: [1, 0] } },
        }),
      ],
      activeId: "d1",
    });
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().resetToCodeOrder();
    useLevelOrder.getState().commit();
    const order = active().data.level_order;
    expect(order?.[0]).toBeUndefined(); // this channel's entry deleted
    expect(order?.[-1]).toEqual([1, 0]); // the x column's preference untouched
  });

  it("a stored set-filter predicate still selects the same ROWS after a reorder", () => {
    useApp.setState({ datasets: [catDataset()], activeId: "d1" });
    const keep = [0, 2];
    useApp.getState().setDatasetFilter("d1", [{ col: 0, kind: "set", values: keep }]);
    const before = filteredOutRows(active().filter, active().data);
    useLevelOrder.getState().openLevelOrder("d1", 0);
    useLevelOrder.getState().moveUp(3);
    useLevelOrder.getState().commit();
    // The predicate keys on the CODE, so reordering cannot move the boundary.
    expect(active().filter).toEqual([{ col: 0, kind: "set", values: keep }]);
    expect(filteredOutRows(active().filter, active().data)).toEqual(before);
  });
});

describe("DEFECT B, READ side: sortByLabel/resetToCodeOrder resolve the live index (review MEDIUM 2)", () => {
  // Same shiftable fixture as the commit-side suite, rebuilt here because the
  // defect is on the paths that RUN WHILE the panel is open, before commit.
  function shiftable(): Dataset {
    const levels = ["Bravo", "Alpha", "Delta", "Charlie"];
    const code = [0, 1, 2, 3];
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

  it("sortByLabel sorts by the REAL labels after a column to the left is removed", () => {
    useApp.setState({ datasets: [shiftable()], activeId: "d1" });
    useLevelOrder.getState().openLevelOrder("d1", 3); // "Grade3"
    useApp.getState().removeFormula("d1", 0); // Grade3 shifts 3 -> 2; index 3 is gone

    useLevelOrder.getState().sortByLabel();

    // Alpha(1), Bravo(0), Charlie(3), Delta(2). Before the fix the label
    // lookup ran at the STALE index 3, found no level table there, and every
    // label degraded to a bare code string — so this sorted "0".."3", i.e.
    // [0, 1, 2, 3], and then committed that as the user's "sort by label".
    expect(useLevelOrder.getState().draft).toEqual([1, 0, 3, 2]);
  });

  it("resetToCodeOrder yields the real domain, not an empty draft", () => {
    useApp.setState({ datasets: [shiftable()], activeId: "d1" });
    useLevelOrder.getState().openLevelOrder("d1", 3);
    useApp.getState().removeFormula("d1", 0);

    useLevelOrder.getState().resetToCodeOrder();

    // Pre-fix: `columnOf(data, 3)` was undefined per row, `levelsOf` filtered
    // them all out, and the panel read "0 levels".
    expect(useLevelOrder.getState().draft).toEqual([0, 1, 2, 3]);
  });
});
