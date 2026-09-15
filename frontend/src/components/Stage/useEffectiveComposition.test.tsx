// BUG-012: a saved figure's x-axis break reaches the export wire and survives
// reopen, but nothing on screen rendered it — `useEffectiveComposition`'s
// durable fallback covered `facetKey` only, so a reopened document (whose
// transient `composition` is always null) drew one continuous line.
//
// These tests drive the REAL hook `PlotStage.tsx` and `MultiPanelStage.tsx`
// read, against a store shaped exactly like a just-reopened workspace: the
// focused plot window carries a `FigureDocument` with `plot.axisBreaks.x`, and
// `composition` is null. The drift guard below then asserts the fallback's
// arrangement is IDENTICAL to the one the live `breakAtGaps` gesture installs
// from the same data — one builder (`lib/facet.breakCompositionFromBreaks`),
// two call sites, so the reopened figure cannot quietly panel differently from
// the one the user drew.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { breakPanelsOf, facetPanelsOf } from "../../lib/composition";
import { createFigureDocument } from "../../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../../lib/plotview";
import type { DataStruct } from "../../lib/types";
import { useActiveDataset, useApp } from "../../store/useApp";
import { multiPanelShowing, useEffectiveComposition } from "./useEffectiveComposition";

// x = 0,1,2 | 3,4,5 — a break at [2, 3] panels it into two contiguous halves.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [2], [3], [4], [5], [6]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

const BREAKS: [number, number][] = [[2, 3]];

function plotWindow(axisBreaks?: { x: [number, number][] }): PlotWindow {
  return {
    id: "w1",
    kind: "plot",
    title: "",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 480, h: 360 },
    z: 0,
    winState: "normal",
    bg: "theme",
    linkGroup: null,
    pinned: false,
    view: defaultPlotView(),
    document: createFigureDocument({
      id: "fig-w1",
      name: "w1",
      datasetId: "d1",
      view: defaultPlotView(),
      ...(axisBreaks ? { axisBreaks } : {}),
    }),
  };
}

/** The store as it is right after a workspace reopen: the document is the only
 *  thing carrying the break, and `composition` (the live render cache) is
 *  null because it is never serialized. */
function reopenedWith(axisBreaks?: { x: [number, number][] }): void {
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    facetKey: null,
    stackMode: false,
    composition: null,
    plotWindows: [plotWindow(axisBreaks)],
    focusedWindowId: "w1",
  });
}

const effective = () =>
  renderHook(() => useEffectiveComposition(useActiveDataset())).result.current;

describe("useEffectiveComposition — the durable x-break fallback (BUG-012)", () => {
  beforeEach(() => {
    reopenedWith();
  });

  it("panels a reopened document's saved x-break, with no user action", () => {
    reopenedWith({ x: BREAKS });
    const panels = breakPanelsOf(effective());
    expect(panels).toHaveLength(2);
    expect(panels?.[0].xRange).toEqual([0, 2]);
    expect(panels?.[1].xRange).toEqual([3, 5]);
  });

  it("DRIFT GUARD: the fallback's arrangement is identical to the live breakAtGaps gesture's", () => {
    reopenedWith({ x: BREAKS });
    const restored = effective();

    // The same data, the same breaks, applied the way a user applies them.
    useApp.getState().breakAtGaps("d1", BREAKS);
    const live = useApp.getState().composition;

    expect(breakPanelsOf(live)).toHaveLength(2);
    expect(restored).toEqual(live);
  });

  it("a document with no saved break renders an ordinary single plot", () => {
    expect(effective()).toBeNull();
  });

  it("refuses a break with nothing on one side of it — as breakAtGaps does", () => {
    // Every row is at or below 2, so only one panel survives; a one-panel
    // "break" is not an arrangement, and the live gesture declines it too.
    reopenedWith({ x: [[7, 8]] });
    expect(effective()).toBeNull();
  });

  it("PRECEDENCE: a facet binding wins over saved breaks, as the export path resolves it", () => {
    // `routes/export_figures.py` branches on `if req.facets:` before the flat
    // renderer's `x_breaks` override is ever consulted, and
    // `calc/figure_facets.render_facets_figure` honors only a narrow override
    // subset that excludes `x_breaks` — so a figure carrying both exports as a
    // facet grid, and must show one.
    reopenedWith({ x: BREAKS });
    useApp.setState({ facetKey: 0 });
    expect(facetPanelsOf(effective())).toHaveLength(6); // one level per row
    expect(breakPanelsOf(effective())).toBeNull();
  });

  it("the live composition still wins over both durable bindings", () => {
    reopenedWith({ x: BREAKS });
    useApp.getState().facetByColumn("d1", 0);
    const live = useApp.getState().composition;
    expect(facetPanelsOf(live)).not.toBeNull();
    expect(effective()).toBe(live);
  });
});

describe("multiPanelShowing — what the Stage actually mounts", () => {
  beforeEach(() => {
    reopenedWith();
  });

  it("mounts the multi-panel stage for a saved break even with stackMode off", () => {
    reopenedWith({ x: BREAKS });
    // 1 plotted channel, stack toggle off: every other clause is false, so the
    // break arrangement alone is what mounts it. Without this, the fallback
    // above would build panels nothing ever renders.
    expect(multiPanelShowing(effective(), false, 1)).toBe(true);
  });

  it("leaves an ordinary plot alone (no composition, stack off)", () => {
    expect(multiPanelShowing(effective(), false, 2)).toBe(false);
  });

  it("keeps the plain per-channel stack gate: stackMode + 2 plotted channels", () => {
    expect(multiPanelShowing(null, true, 2)).toBe(true);
    expect(multiPanelShowing(null, true, 1)).toBe(false);
  });

  it("keeps the facet gate: one facet panel is enough, but only in stack mode", () => {
    reopenedWith();
    useApp.setState({ facetKey: 0 });
    expect(multiPanelShowing(effective(), true, 1)).toBe(true);
    expect(multiPanelShowing(effective(), false, 1)).toBe(false);
  });
});
