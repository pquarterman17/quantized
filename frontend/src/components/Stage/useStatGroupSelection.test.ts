// useStatGroupSelection — the plot half of the summary-table <-> selection
// link (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 4): the marks put on the flat
// draw (bands by slot KEY, rings on points by ORIGINAL row — the selection's
// own index space) and on facet panels (scoped to each panel's rows), and a
// panel-scoped pick.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as categorical from "../../lib/categorical";
import { facetSliceRowIds, facetSlices } from "../../lib/facet";
import { analysisData, analysisRowIds } from "../../lib/rowstate";
import { boxStatsClient, resolveGroupsIndexed } from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { StatDrawData } from "./statRender";
import { decorateDraw, levelAxes, type LevelAxes } from "./statStageLevels";
import { useStatGroupSelection } from "./useStatGroupSelection";
import type { FacetDraw } from "./useStatStageCompute";

vi.mock("../../lib/categorical", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/categorical")>();
  return { ...actual, columnOf: vi.fn(actual.columnOf) };
});

// grp A B C (C empty); fac f0 f1. Row 1 EXCLUDED, so analysis positions shift.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [
    [0, 1, 0],
    [0, 2, 0],
    [0, 3, 1],
    [1, 4, 0],
    [1, 5, 1],
    [1, 6, 1],
  ],
  labels: ["grp", "y", "fac"],
  units: ["", "", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C"], 2: ["f0", "f1"] },
};
const DS: Dataset = { id: "ds", name: "ds", data: DATA, excludedRows: [1] };
const VIEW = analysisData(DS)!;
const ROW_IDS = analysisRowIds(DS);

beforeEach(() => {
  useApp.setState({ datasets: [DS], activeId: "ds", selection: null });
});

function flatSetup() {
  const axes = levelAxes({
    active: DS, data: VIEW, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
    barValueChannels: [1], facetCol: null, slices: null,
  })!;
  const points = resolveGroupsIndexed(VIEW, 0, 1, [1], null, ROW_IDS);
  const raw: StatDrawData = {
    mode: "box",
    boxes: points.map((g) => boxStatsClient(g.points.map((p) => p.value), 1.5, g.label)),
    points,
    valueLabel: "y",
    groupLabel: "grp",
  };
  return { axes, draw: decorateDraw(raw, axes.flat, false, true).draw };
}

describe("decorate — flat", () => {
  it("bands every slot by key and rings the selected points by their ORIGINAL rows", () => {
    const { axes, draw } = flatSetup();
    const { result } = renderHook(() => useStatGroupSelection(DS, axes, false));
    expect(result.current.decorate(draw)).toBe(draw); // nothing selected: untouched
    act(() => useApp.getState().setRowSelection([0, 2, 5]));
    const d = result.current.decorate(draw);
    const marks = d && "selection" in d ? d.selection : null;
    expect(marks?.slots).toEqual([2, 1, 0]); // A all (row 1 excluded), B some, C empty
    expect(marks?.ringPoints).toBe(true);
    // Rings are keyed by ORIGINAL row — the renderer reads the live
    // selection directly (`selectedRows`), not a copy inside `selection`
    // (review finding 7). The points carry 0, 2, 5 themselves even though
    // row 1 is pruned (they used to carry view positions 0, 1, 4).
    const selectedRows = d && "selectedRows" in d ? d.selectedRows : null;
    expect([...(selectedRows ?? [])].sort()).toEqual([0, 2, 5]);
    const ringed = (d?.mode === "box" ? d.points ?? [] : []).flatMap((g) =>
      g.points.filter((p) => selectedRows?.has(p.rowIndex)).map((p) => p.value),
    );
    expect(ringed.sort()).toEqual([1, 3, 6]); // y of rows 0, 2, 5
  });

  it("a selection on ANOTHER dataset marks nothing here", () => {
    const { axes, draw } = flatSetup();
    useApp.setState({ selection: { datasetId: "elsewhere", rows: [0] } });
    const { result } = renderHook(() => useStatGroupSelection(DS, axes, false));
    expect(result.current.decorate(draw)).toBe(draw);
    expect(result.current.counts).toEqual([0, 0, 0]);
  });

  it("a non-empty selection that touches NOTHING drawn here leaves the draw untouched (review finding 4)", () => {
    // Row 1 is EXCLUDED — it belongs to no slot's rows (A's are [0, 2], not
    // [0, 1, 2]) — so selecting it makes `hasSelection` true on THIS dataset
    // without marking any slot. Before the fix, `selectionMarks` still
    // returned a non-null result whenever the selection was non-empty
    // anywhere, so `decorate` always produced a NEW draw object here —
    // a spurious repaint on a selection this plot has nothing to do with.
    const { axes, draw } = flatSetup();
    const { result } = renderHook(() => useStatGroupSelection(DS, axes, false));
    act(() => useApp.getState().setRowSelection([1]));
    expect(useApp.getState().selection?.rows).toEqual([1]);
    expect(result.current.hasSelection).toBe(true);
    expect(result.current.decorate(draw)).toBe(draw); // same object: nothing to mark
  });
});

function facetSetup() {
  const slices = facetSlices(VIEW, 2);
  const axes = levelAxes({
    active: DS, data: VIEW, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
    barValueChannels: [1], facetCol: 2, slices,
  })!;
  const facets: FacetDraw[] = slices.map((s) => {
    const groups = resolveGroupsIndexed(s.data, 0, 1, [1], null, null);
    const raw: StatDrawData = {
      mode: "box",
      boxes: groups.map((g) => boxStatsClient(g.points.map((p) => p.value), 1.5, g.label)),
      valueLabel: "y",
      groupLabel: "grp",
    };
    return { label: s.label, draw: decorateDraw(raw, axes.panels!.get(s.label)!, true, true).draw };
  });
  return { axes, facets };
}

describe("facets — marks and picks are scoped to the panel", () => {
  it("clicking group B in panel f1 selects B's rows in f1 only; each panel marks its own share", () => {
    const { axes, facets } = facetSetup();
    const { result } = renderHook(() => useStatGroupSelection(DS, axes, false));
    const f1 = facets[1].label;
    act(() => result.current.select("1", { toggle: false, range: false }, f1));
    expect(useApp.getState().selection?.rows).toEqual([4, 5]);
    const out = result.current.decorateFacets(facets)!;
    const marksOf = (i: number) => {
      const d = out[i].draw;
      return "selection" in d ? d.selection?.slots : undefined;
    };
    // Panel f0 draws A and B (hide-empty): B's f0 row (3) is not selected, so
    // the panel carries no marks at all.
    expect(marksOf(0)).toBeUndefined();
    // Panel f1 draws A and B: A's f1 row (2) no, B's f1 rows (4, 5) all.
    expect(marksOf(1)).toEqual([0, 2]);
    // The table (whole-plot groups) reads B as partly selected.
    expect(result.current.counts).toEqual([0, 2, 0]);
  });

  it("rings this panel's own selected points by ORIGINAL row (review finding 7)", () => {
    // Box facets never carry points in production today (JMP_GAP J5
    // residual — `computeFacetGroupDraws` hardcodes `points: null`), but the
    // selection link must still map them correctly for when they are: build
    // one by hand, with original rows (`FacetSlice.rows` through the
    // analysis view's row ids), the same way `facetSetup` builds its
    // points-less ones.
    const slices = facetSlices(VIEW, 2);
    const axes = levelAxes({
      active: DS, data: VIEW, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
      barValueChannels: [1], facetCol: 2, slices,
    })!;
    const f1 = slices[1]; // fac=1: original rows 2 (grp A), 4, 5 (grp B)
    const ids = facetSliceRowIds(f1, ROW_IDS);
    expect(ids).toEqual([2, 4, 5]);
    const groups = resolveGroupsIndexed(f1.data, 0, 1, [1], null, ids);
    expect(groups.map((g) => g.points.map((p) => p.rowIndex))).toEqual([[2], [4, 5]]);
    const raw: StatDrawData = {
      mode: "box",
      boxes: groups.map((g) => boxStatsClient(g.points.map((p) => p.value), 1.5, g.label)),
      points: groups,
      valueLabel: "y",
      groupLabel: "grp",
    };
    const facetDraw: FacetDraw = { label: f1.label, draw: decorateDraw(raw, axes.panels!.get(f1.label)!, true, true).draw };
    const { result } = renderHook(() => useStatGroupSelection(DS, axes, false));
    act(() => useApp.getState().setRowSelection([5]));
    const out = result.current.decorateFacets([facetDraw])!;
    const d = out[0].draw;
    expect("selection" in d ? d.selection?.ringPoints : undefined).toBe(true);
    // The renderer reads the live selection directly (`selectedRows`), not a
    // copy inside `selection` (review finding 7).
    const points = "selectedRows" in d ? d.selectedRows : undefined;
    expect([...(points ?? [])]).toEqual([5]);
    // Exactly one drawn point is ringed: row 5 (y = 6), in group B.
    const ringed = groups.flatMap((g) => g.points.filter((p) => points?.has(p.rowIndex)).map((p) => p.value));
    expect(ringed).toEqual([6]);
  });
});

describe("anchor reset on axis/summary identity change (review finding 2)", () => {
  it("a stale anchor from a previous axis does not seed a range after a dataset switch", () => {
    const { axes: axes1 } = flatSetup(); // DS: A/B/C keyed "0"/"1"/"2", C empty
    // A second dataset with the SAME key layout (grp A/B/C) but its own rows
    // — if the anchor were not reset, its OLD key ("1", picked on DS) would
    // still be "known" here, since DS2's axis has the identical key set.
    const DS2: Dataset = { ...DS, id: "ds2", data: { ...DATA, values: DATA.values.map((r) => [r[0], r[1] + 100, r[2]]) } };
    const view2 = analysisData(DS2)!;
    const axes2 = levelAxes({
      active: DS2, data: view2, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
      barValueChannels: [1], facetCol: null, slices: null,
    })!;

    const { result, rerender } = renderHook(
      (props: { active: Dataset; axes: LevelAxes }) => useStatGroupSelection(props.active, props.axes, false),
      { initialProps: { active: DS, axes: axes1 } },
    );
    act(() => result.current.select("1", { toggle: false, range: false })); // anchor = "1" (B, on DS)
    rerender({ active: DS2, axes: axes2 }); // axes identity changes: summary is rebuilt
    // Shift-click "2" (C, EMPTY on both datasets) with no anchorHint. Reset,
    // this is a PLAIN pick of an empty group: the selection clears. Stale,
    // "1" (B) is still "known" (DS2 has the same key set) and seeds a RANGE
    // "1".."2" — B is non-empty, so the selection would carry its rows.
    act(() => result.current.select("2", { toggle: false, range: true }));
    expect(useApp.getState().selection).toBeNull();
  });
});

describe("memoization (review finding 5)", () => {
  it("never re-derives a facet panel's rows from the facet column per gesture", () => {
    const { axes, facets } = facetSetup();
    const { result } = renderHook(() => useStatGroupSelection(DS, axes, false));
    // `levelAxes` (above) and mounting the hook (its stats pass) both read
    // the dataset's columns legitimately — clear those first, so only calls
    // made BY A GESTURE below count.
    vi.mocked(categorical.columnOf).mockClear();
    act(() => result.current.select("1", { toggle: false, range: false }, facets[1].label));
    result.current.decorateFacets(facets);
    act(() => result.current.select("0", { toggle: true, range: false }, facets[0].label));
    result.current.decorateFacets(facets);
    expect(categorical.columnOf).not.toHaveBeenCalled();
  });
});

describe("the table's stats pass is gated by tableOpen (review finding 6)", () => {
  it("skips stats when closed, computes them when open, over the SAME axes", () => {
    const { axes } = flatSetup();
    const closed = renderHook(() => useStatGroupSelection(DS, axes, false, false));
    expect(closed.result.current.summary?.rows.every((r) => r.stats.length === 0)).toBe(true);
    const open = renderHook(() => useStatGroupSelection(DS, axes, false, true));
    expect(open.result.current.summary?.rows.some((r) => r.stats.length > 0)).toBe(true);
  });
});
