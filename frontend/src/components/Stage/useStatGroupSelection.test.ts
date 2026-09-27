// useStatGroupSelection — the plot half of the summary-table <-> selection
// link (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 4): the marks put on the flat
// draw (bands by slot KEY, rings on points in the analysis-view index space)
// and on facet panels (scoped to each panel's rows), and a panel-scoped pick.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { facetSlices } from "../../lib/facet";
import { analysisData } from "../../lib/rowstate";
import { boxStatsClient, resolveGroupsIndexed } from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import type { StatDrawData } from "./statRender";
import { decorateDraw, levelAxes } from "./statStageLevels";
import { useStatGroupSelection } from "./useStatGroupSelection";
import type { FacetDraw } from "./useStatStageCompute";

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

beforeEach(() => {
  useApp.setState({ datasets: [DS], activeId: "ds", selection: null });
});

function flatSetup() {
  const axes = levelAxes({
    active: DS, data: VIEW, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
    barValueChannels: [1], facetCol: null, slices: null,
  })!;
  const points = resolveGroupsIndexed(VIEW, 0, 1, [1], null);
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
  it("bands every slot by key and rings the selected points in their own index space", () => {
    const { axes, draw } = flatSetup();
    const { result } = renderHook(() => useStatGroupSelection(DS, axes, false));
    expect(result.current.decorate(draw)).toBe(draw); // nothing selected: untouched
    act(() => useApp.getState().setRowSelection([0, 2, 5]));
    const d = result.current.decorate(draw);
    const marks = d && "selection" in d ? d.selection : null;
    expect(marks?.slots).toEqual([2, 1, 0]); // A all (row 1 excluded), B some, C empty
    // Original rows 0, 2, 5 are analysis positions 0, 1, 4 (row 1 is pruned).
    expect([...(marks?.points ?? [])].sort()).toEqual([0, 1, 4]);
  });

  it("a selection on ANOTHER dataset marks nothing here", () => {
    const { axes, draw } = flatSetup();
    useApp.setState({ selection: { datasetId: "elsewhere", rows: [0] } });
    const { result } = renderHook(() => useStatGroupSelection(DS, axes, false));
    expect(result.current.decorate(draw)).toBe(draw);
    expect(result.current.counts).toEqual([0, 0, 0]);
  });
});

describe("facets — marks and picks are scoped to the panel", () => {
  function facetSetup() {
    const slices = facetSlices(VIEW, 2);
    const axes = levelAxes({
      active: DS, data: VIEW, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
      barValueChannels: [1], facetCol: 2, slices,
    })!;
    const facets: FacetDraw[] = slices.map((s) => {
      const groups = resolveGroupsIndexed(s.data, 0, 1, [1], null);
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
});
