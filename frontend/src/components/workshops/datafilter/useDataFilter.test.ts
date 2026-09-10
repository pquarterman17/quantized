import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct, Dataset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { useApp } from "../../../store/useApp";
import { useDataFilter } from "./useDataFilter";

// 12 rows: channel 0 is a 2-level categorical column; channel 1 is continuous.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10], [0, 12], [0, 14], [0, 16], [0, 18], [0, 20],
    [1, 30], [1, 32], [1, 34], [1, 36], [1, 38], [1, 40],
  ],
  labels: ["grp", "val"],
  units: ["", ""],
  metadata: { x_column_name: "T" },
};

const filterOf = (id: string) => useApp.getState().datasets.find((d) => d.id === id)?.filter;

beforeEach(() => {
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
});

describe("useDataFilter", () => {
  it("classifies columns: x + continuous → range, categorical → set with levels", () => {
    const { result } = renderHook(() => useDataFilter());
    const cols = result.current.columns;
    expect(cols.map((c) => c.index)).toEqual([-1, 0, 1]);
    expect(cols[0]).toMatchObject({ index: -1, kind: "range" }); // x
    expect(cols[1]).toMatchObject({ index: 0, kind: "set" }); // grp (categorical)
    expect(cols[1].levels).toEqual([0, 1]);
    expect(cols[2]).toMatchObject({ index: 1, kind: "range" }); // val (continuous)
  });

  it("shows imported categorical labels instead of leaking numeric codes", () => {
    useApp.setState({
      datasets: [{
        id: "d1",
        name: "samples.csv",
        data: { ...DATA, cat_levels: { 0: ["Reference", "Annealed"] } },
      }],
    });
    const { result } = renderHook(() => useDataFilter());
    const group = result.current.columns.find((c) => c.index === 0)!;
    expect(group.levels).toEqual([0, 1]);
    expect(group.levelLabels).toEqual(["Reference", "Annealed"]);
  });

  it("exposes each range column's own data bounds (RangeSlider domain), ignoring the current filter", () => {
    const { result } = renderHook(() => useDataFilter());
    const cols = result.current.columns;
    expect(cols[0]).toMatchObject({ index: -1, dataMin: 0, dataMax: 11 }); // x
    expect(cols[2]).toMatchObject({ index: 1, dataMin: 10, dataMax: 40 }); // val
    // a categorical column carries no data range (it's a level checklist)
    expect(cols[1].dataMin).toBeUndefined();
    expect(cols[1].dataMax).toBeUndefined();
  });

  it("data bounds stay the FULL range even after a filter narrows the kept rows", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.setRange(1, 20, 30));
    const val = result.current.columns.find((c) => c.index === 1);
    expect(val).toMatchObject({ dataMin: 10, dataMax: 40 }); // unchanged by the active predicate
  });

  it("setRange writes a range predicate and updates the kept count", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.setRange(1, 15, undefined)); // val ≥ 15
    expect(filterOf("d1")).toEqual([{ col: 1, kind: "range", min: 15 }]);
    // values 10,12,14 drop → 9 of 12 kept
    expect(result.current.kept).toBe(9);
    expect(result.current.total).toBe(12);
    expect(result.current.active).toBe(true);
  });

  // R9 code-review F3: `filter` (`active?.filter ?? NO_FILTER`) must reuse a
  // single stable empty-array identity in the common unfiltered case — a
  // bare `?? []` would mint a fresh array every render, defeating the
  // `columns` memo's `[active, filter]` dep on every re-render of an
  // unfiltered dataset (by far the common case). An unrelated re-render
  // (`rerender()` with no store change) must leave `columns` at the SAME
  // object identity.
  it("columns stays referentially stable across an unrelated re-render when unfiltered (NO_FILTER identity)", () => {
    const { result, rerender } = renderHook(() => useDataFilter());
    const before = result.current.columns;
    rerender();
    expect(result.current.columns).toBe(before);
  });

  // R9 (POST_SPRINT_INDEPENDENT_REVIEW): `columns[*].current` is populated by
  // `currentOf`, a closure over `filter` that the surrounding useMemo
  // deliberately excludes from its own deps (only `[active, filter]` — see
  // useDataFilter.ts's comment). This pins down that the memo's `current`
  // field still tracks a fresh filter commit, immediately and on the very
  // next filter edit, so that exclusion can't quietly regress into a
  // one-render-stale value.
  it("columns[*].current reflects the just-written predicate on the same render (currentOf freshness)", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.setRange(1, 15, undefined));
    let col = result.current.columns.find((c) => c.index === 1);
    expect(col?.current).toEqual({ col: 1, kind: "range", min: 15 });
    // A second, different edit to the SAME column must also show up right
    // away (not the previous predicate, not stale).
    act(() => result.current.setRange(1, 20, 30));
    col = result.current.columns.find((c) => c.index === 1);
    expect(col?.current).toEqual({ col: 1, kind: "range", min: 20, max: 30 });
    // Clearing drops it back to undefined on the same render too.
    act(() => result.current.clear());
    col = result.current.columns.find((c) => c.index === 1);
    expect(col?.current).toBeUndefined();
  });

  it("toggleLevel narrows a categorical column to the checked levels", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.toggleLevel(0, 1)); // uncheck level 1 → keep {0}
    expect(filterOf("d1")).toEqual([{ col: 0, kind: "set", values: [0] }]);
    expect(result.current.kept).toBe(6); // only the six grp=0 rows
  });

  it("dropping the predicate when all levels are re-checked", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.toggleLevel(0, 1)); // keep {0}
    act(() => result.current.toggleLevel(0, 1)); // re-check 1 → all levels → no constraint
    expect(filterOf("d1")).toBeUndefined();
    expect(result.current.active).toBe(false);
  });

  it("clear removes the filter", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.setRange(1, 15, 35));
    expect(filterOf("d1")).toBeTruthy();
    act(() => result.current.clear());
    expect(filterOf("d1")).toBeUndefined();
    expect(result.current.kept).toBe(12);
  });

  it("an open range (no bounds) writes no predicate", () => {
    const { result } = renderHook(() => useDataFilter());
    act(() => result.current.setRange(1, undefined, undefined));
    expect(filterOf("d1")).toBeUndefined();
  });
});

// The classification above (`kind: cat ? "set" : "range"`) already runs
// through `channelModelingType`, whose own documented precedence checks a
// `channelTypes` override BEFORE the `isCategoricalChannel` signal. These
// pin that precedence through the Data Filter workbench's own path (not just
// `lib/modeling.ts`'s unit tests), per PRIMARY_SOFTWARE_AUDIT_PLAN's
// instruction to verify the override rule holds through this workbench.
describe("useDataFilter — explicit channelTypes override wins over inference", () => {
  it("overriding a genuinely categorical column (cat_levels) to continuous renders it as a range", () => {
    useApp.setState({
      datasets: [{
        id: "d1",
        name: "samples.csv",
        data: { ...DATA, cat_levels: { 0: ["Reference", "Annealed"] } },
        channelTypes: { 0: "continuous" },
      }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useDataFilter());
    const grp = result.current.columns.find((c) => c.index === 0)!;
    expect(grp.kind).toBe("range");
    expect(grp.dataMin).toBe(0);
    expect(grp.dataMax).toBe(1);
  });

  it("overriding a plain numeric column to nominal renders it as a level checklist", () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, channelTypes: { 1: "nominal" } }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useDataFilter());
    const val = result.current.columns.find((c) => c.index === 1)!;
    expect(val.kind).toBe("set");
    expect(val.levels).toEqual([10, 12, 14, 16, 18, 20, 30, 32, 34, 36, 38, 40]);
  });
});

// BUG-003 (plans/BUGS_AND_ISSUES.md): a predicate written under a column's
// PRIOR classification becomes unrepresentable once `setChannelType` (or a
// reimport that changes `cat_levels`) reclassifies it. The conservative
// choice implemented in useDataFilter.ts: mask it from `current` (so neither
// control renders a foreign predicate shape) without deleting it from the
// store, and keep the raw filter's `active` flag (the "Clear" affordance)
// honest about it.
describe("useDataFilter — a stale kind-mismatched predicate is masked, not deleted (BUG-003)", () => {
  it("a set filter on a categorical column survives an override to continuous, hidden from `current`", () => {
    const { result, rerender } = renderHook(() => useDataFilter());
    act(() => result.current.toggleLevel(0, 1)); // keep grp={0} -> a "set" predicate on col 0
    expect(filterOf("d1")).toEqual([{ col: 0, kind: "set", values: [0] }]);

    act(() => useApp.getState().setChannelType("d1", 0, "continuous"));
    rerender();

    const grp = result.current.columns.find((c) => c.index === 0)!;
    expect(grp.kind).toBe("range"); // reclassified
    expect(grp.current).toBeUndefined(); // the stale "set" predicate can't render here
    // Not deleted: the raw store entry is untouched...
    expect(filterOf("d1")).toEqual([{ col: 0, kind: "set", values: [0] }]);
    // ...and still visibly active, so "Clear" stays reachable.
    expect(result.current.active).toBe(true);

    // Reverting the override brings the SAME predicate back as `current`.
    act(() => useApp.getState().setChannelType("d1", 0, null));
    rerender();
    const grpAgain = result.current.columns.find((c) => c.index === 0)!;
    expect(grpAgain.kind).toBe("set");
    expect(grpAgain.current).toEqual({ col: 0, kind: "set", values: [0] });
  });
});

// Persisted filter state must round-trip: a categorical column's level-set
// filter, saved into a project (`Dataset.filter` via
// `lib/workspaceSerialize.ts`/`lib/workspace.ts`), has to come back wired
// the same way through this workbench after reopen — not just as a bare
// `ColumnFilter[]` shape (workspace.test.ts already pins that), but with the
// SAME kind/levels/labels/current a live session would show.
describe("useDataFilter — a categorical filter round-trips through project save/reopen", () => {
  it("survives serializeWorkspace -> parseWorkspace with its kind, level labels, and predicate intact", () => {
    const saved: Dataset = {
      id: "d1",
      name: "samples.csv",
      data: {
        time: [0, 1, 2, 3],
        values: [[0], [0], [1], [1]],
        labels: ["Treatment"],
        units: [""],
        metadata: {},
        cat_levels: { 0: ["Reference", "Annealed"] },
      },
      filter: [{ col: 0, kind: "set", values: [1] }], // keep only "Annealed"
    };
    const reopened = parseWorkspace(serializeWorkspace({ datasets: [saved] })).datasets[0];

    // The round trip itself: not a mutated copy of the pre-save object.
    expect(reopened.data.cat_levels).toEqual({ 0: ["Reference", "Annealed"] });
    expect(reopened.filter).toEqual([{ col: 0, kind: "set", values: [1] }]);

    useApp.setState({ datasets: [reopened], activeId: reopened.id });
    const { result } = renderHook(() => useDataFilter());
    const treatment = result.current.columns.find((c) => c.index === 0)!;
    expect(treatment.kind).toBe("set");
    expect(treatment.levelLabels).toEqual(["Reference", "Annealed"]);
    expect(treatment.current).toEqual({ col: 0, kind: "set", values: [1] });
    expect(result.current.kept).toBe(2); // only the two "Annealed" (code 1) rows
    expect(result.current.total).toBe(4);
  });
});

// Group O-2b: the checkbox list a user picks levels from must show the SAME
// order the axis draws them in (`lib/categorical.ts`'s `categoryLevels`) —
// this used to be a private plain-ascending copy (`distinctLevels`), which
// would have silently disagreed with an axis honouring a stored
// `level_order`. `levelLabels` must stay aligned 1:1 with the REORDERED
// `levels`, not the ascending list `cat_levels` itself is written in.
describe("useDataFilter — honours a stored level_order (Group O-2b)", () => {
  it("returns levels in the stored display order, with levelLabels aligned 1:1", () => {
    useApp.setState({
      datasets: [{
        id: "d1",
        name: "samples.csv",
        data: {
          ...DATA,
          cat_levels: { 0: ["Reference", "Annealed"] }, // code 0 -> Reference, code 1 -> Annealed
          level_order: { 0: [1, 0] }, // user put Annealed first
        },
      }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useDataFilter());
    const group = result.current.columns.find((c) => c.index === 0)!;
    expect(group.levels).toEqual([1, 0]);
    expect(group.levelLabels).toEqual(["Annealed", "Reference"]); // aligned to `levels`, not code order
  });

  it("fails open: a level_order naming only some levels still lists all of them, unnamed ones ascending at the end", () => {
    useApp.setState({
      datasets: [{
        id: "d1",
        name: "3level.csv",
        data: {
          time: [0, 1, 2],
          values: [[0], [1], [2]],
          labels: ["grp"],
          units: [""],
          metadata: {},
          cat_levels: { 0: ["Low", "Mid", "High"] },
          level_order: { 0: [2] }, // only "High" has an opinion
        },
      }],
      activeId: "d1",
    });
    const { result } = renderHook(() => useDataFilter());
    const group = result.current.columns.find((c) => c.index === 0)!;
    expect(group.levels).toEqual([2, 0, 1]); // High first, then Low/Mid ascending
    expect(group.levelLabels).toEqual(["High", "Low", "Mid"]);
  });
});
