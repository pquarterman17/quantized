// A LIVE Break-at-gaps break: screen and export come from ONE source.
//
// The gesture used to install only the store's `composition` render cache,
// so the export (which reads the focused window's `plot.axisBreaks.x`) was
// always a flat plot and the break was lost on save. It now commits the gap
// ranges to the figure document too. It also no longer turns `stackMode` on:
// a break mounts on its own (`multiPanelShowing`), so when the break collapses
// (one side's rows excluded) a 2-series plot falls back to what the user had,
// not to a stack the export cannot draw.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { breakPanelsOf } from "../../lib/composition";
import { createFigureDocument } from "../../lib/figureDocument";
import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView } from "../../lib/plotview";
import { STACK_EXPORT_NOTICE, screenOnlyExportNotice } from "../../lib/screenOnlyExport";
import type { Dataset, DataStruct } from "../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../lib/workspace";
import { useActiveDataset, useApp } from "../../store/useApp";
import { multiPanelShowing, useEffectiveComposition } from "./useEffectiveComposition";

// x = 0,1,2 | 10,11,12 with two y series: one large gap, so Break at gaps panels it in two.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[0, 1, 7], [1, 2, 6], [2, 3, 5], [10, 4, 4], [11, 5, 3], [12, 6, 2]],
  labels: ["x", "a", "b"],
  units: ["", "", ""],
  metadata: {},
};

function setup(): void {
  useApp.setState({
    datasets: [{ id: "d1", name: "ds1", data: DATA }],
    activeId: "d1", xKey: 0, yKeys: [1, 2], y2Keys: null, facetKey: null, groupKey: null,
    stackMode: false, composition: null, polarMode: false, statMode: false, insetMode: false,
    history: [], future: [],
    plotWindows: [
      {
        id: "w1", kind: "plot", title: "", datasetId: "d1",
        geometry: { x: 0, y: 0, w: 480, h: 360 }, z: 0, winState: "normal",
        bg: "theme", linkGroup: null, pinned: false, view: defaultPlotView(),
        document: createFigureDocument({ id: "fig-w1", name: "w1", datasetId: "d1", view: defaultPlotView() }),
      },
    ],
    focusedWindowId: "w1",
  });
}

function exportSpec(id = "d1") {
  const ds = useApp.getState().datasets.find((d) => d.id === id) as Dataset;
  return buildStageFigureSpec(useApp.getState, ds, "fig", { fmt: "pdf", style: "default", dpi: 300, title: "" });
}

/** What the Stage mounts: the effective arrangement and PlotStage's own gate. */
function screen() {
  const hook = renderHook(() => useEffectiveComposition(useActiveDataset()));
  const composition = hook.result.current;
  const multiPanel = multiPanelShowing(composition, useApp.getState().stackMode, 2);
  hook.unmount();
  return { breakPanels: breakPanelsOf(composition)?.length ?? 0, multiPanel };
}

const excludeRightSide = () => {
  const ds = useApp.getState().datasets[0];
  act(() => useApp.setState({ datasets: [{ ...ds, excludedRows: [3, 4, 5] }] }));
};

beforeEach(setup);

describe("Break at gaps — the export draws the live break", () => {
  it("the export request carries x_breaks for a live break, with no screen-only notice", () => {
    useApp.getState().breakAtGaps("d1");
    expect(screen().breakPanels).toBe(2);
    const spec = exportSpec();
    expect(spec.overrides?.x_breaks).toEqual([[2, 10]]);
    expect(screenOnlyExportNotice(useApp.getState(), spec)).toBeNull();
  });

  it("survives a .dwk round-trip, on screen and in the export", () => {
    useApp.getState().breakAtGaps("d1");
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
    setup();
    act(() => useApp.getState().loadWorkspace(parseWorkspace(text)));
    expect(useApp.getState().composition).toBeNull(); // only the document is left
    expect(screen().breakPanels).toBe(2);
    expect(exportSpec().overrides?.x_breaks).toEqual([[2, 10]]);
  });

  it("is one undo step, and undo removes it from screen and export", () => {
    useApp.getState().breakAtGaps("d1");
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["break at gaps"]);
    act(() => useApp.getState().undo());
    expect(screen().breakPanels).toBe(0);
    expect(exportSpec().overrides?.x_breaks).toBeUndefined();
    expect(useApp.getState().plotWindows[0].document?.plot.axisBreaks.x).toEqual([]);
  });

  it("still collapses when every row on one side is excluded", () => {
    useApp.getState().breakAtGaps("d1");
    excludeRightSide();
    expect(screen().breakPanels).toBe(0);
    expect(exportSpec().overrides?.x_breaks).toBeUndefined();
  });
});

describe("Break at gaps — the view after the break collapses", () => {
  it("drops to the plain overlay when the user had no stack, matching the export", () => {
    useApp.getState().breakAtGaps("d1");
    excludeRightSide();
    expect(screen().multiPanel).toBe(false);
    const spec = exportSpec();
    expect(spec.overrides?.x_breaks).toBeUndefined();
    expect(screenOnlyExportNotice(useApp.getState(), spec)).toBeNull();
  });

  it("keeps a stack the user turned on, and the export says it is screen-only", () => {
    useApp.getState().setStackMode(true);
    useApp.getState().breakAtGaps("d1");
    excludeRightSide();
    expect(screen()).toEqual({ breakPanels: 0, multiPanel: true });
    expect(screenOnlyExportNotice(useApp.getState(), exportSpec())).toBe(STACK_EXPORT_NOTICE);
  });
});

describe("Break at gaps on a dataset that is not active (macro replay)", () => {
  it("keeps the axis the gaps were measured on, so the screen, the view and the export agree", () => {
    // Same technique, so activating d2 restores d1's x (column 0) from
    // technique memory. d2's gap is on its TIME axis; column 0 is even.
    const xrd = { technique: "xrd.powder" };
    const d2: DataStruct = {
      ...DATA,
      time: [0, 1, 2, 10, 11, 12],
      values: DATA.values.map((row, i) => [i, row[1], row[2]]),
      metadata: xrd,
    };
    useApp.setState({
      datasets: [{ id: "d1", name: "ds1", data: { ...DATA, metadata: xrd } }, { id: "d2", name: "ds2", data: d2 }],
    });
    useApp.getState().breakAtGaps("d2");
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
    expect(screen().breakPanels).toBe(2);
    const spec = exportSpec("d2");
    expect(spec.overrides?.x_breaks).toEqual([[2, 10]]);
    expect(s.xKey).toBeNull(); // the view plots the time axis the panels show
    expect(breakPanelsOf(s.composition)?.[0].channels).toEqual(spec.y_keys);
  });
});
