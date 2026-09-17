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
import { shouldAutosave } from "../../useWorkspaceAutosave";
import { multiPanelShowing, useEffectiveComposition } from "./useEffectiveComposition";

// TWO value channels, and the store below binds `xKey: 0` / `yKeys: [1, 0]`
// (review F1). The hook's job is to thread BOTH of those into the shared
// builder; with the single-channel `xKey: null, yKeys: null` fixture this
// file started from, passing them or dropping them was indistinguishable —
// sabotaging either wiring left every test here (and the DOM case, and the
// matrix) green. Channel 0 is the x column (its own distinct value per row,
// so the PRECEDENCE case below still faces one facet level per row) and
// `yKeys` is deliberately NON-default and NON-ascending.
//
// x = 0,1,2 | 3,4,5 — a break at [2, 3] panels it into two contiguous halves.
const DATA: DataStruct = {
  time: [50, 51, 52, 53, 54, 55], // deliberately NOT the x column: xKey is 0
  values: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 6],
  ],
  labels: ["x", "y"],
  units: ["", ""],
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
    xKey: 0,
    yKeys: [1, 0],
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
    // Review F1: the view's OWN channel binding is what the panels are built
    // from — `xKey: 0` (so `x` is the axis the break is expressed in, not
    // `.time`) and `yKeys: [1, 0]` (a non-default, non-ascending series list).
    // Drop either from the hook's `durableComposition` call and this fails.
    expect(panels?.[0].payload.data[0]).toEqual([0, 1, 2]);
    expect(panels?.[0].payload.series.map((s) => s.label)).toEqual(["y", "x"]);
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

// BUG-012 review F3/F4: the two gestures that must be able to take an
// authored break OFF the screen again. Both go through the document (the
// canonical home the durable fallback reads), not through a second flag:
// clearing the live `composition` alone is useless now that the fallback
// rebuilds one from `plot.axisBreaks.x` on the very next render.
describe("clearing an authored break (review F3/F4)", () => {
  beforeEach(() => {
    reopenedWith({ x: BREAKS });
  });

  it("F3: the stack toggle OFF returns a broken-axis figure to a plain XY plot", () => {
    expect(breakPanelsOf(effective())).toHaveLength(2);
    useApp.getState().setStackMode(false);
    expect(effective()).toBeNull();
    expect(useApp.getState().plotWindows[0].document?.plot.axisBreaks.x).toEqual([]);
  });

  it("F3: the toggle clears the FOCUSED window's break only", () => {
    const other = { ...plotWindow({ x: BREAKS }), id: "w2" };
    useApp.setState({ plotWindows: [...useApp.getState().plotWindows, other] });
    useApp.getState().setStackMode(false);
    const [focused, background] = useApp.getState().plotWindows;
    expect(focused.document?.plot.axisBreaks.x).toEqual([]);
    expect(background.document?.plot.axisBreaks.x).toEqual(BREAKS);
  });

  it("F4: a genuine dataset switch drops the break instead of panelling the new dataset at the old one's gap", () => {
    // d3 is unrelated but shares the x range, so the `< 2 panels` refusal
    // would NOT have saved it: before this, the stage panelled d3 at d1's gap
    // with no gesture and no toggle.
    useApp.setState({
      datasets: [...useApp.getState().datasets, { id: "d3", name: "ds3", data: DATA }],
    });
    useApp.getState().setActive("d3");
    expect(useApp.getState().plotWindows[0].document?.plot.axisBreaks.x).toEqual([]);
    expect(effective()).toBeNull();
  });

  it("F4: re-activating the dataset the window is ALREADY on keeps the break", () => {
    // `breakAtGaps`/`facetByColumn` end with exactly this call, and a plain
    // Library click on the active row is the same gesture.
    useApp.getState().setActive("d1");
    expect(useApp.getState().plotWindows[0].document?.plot.axisBreaks.x).toEqual(BREAKS);
    expect(breakPanelsOf(effective())).toHaveLength(2);
  });

  // Round 3, finding 1: F4 covered `setActive` and `rebindWindow` but missed
  // the IMPORT leg -- `addDataset` (import, paste, demo, merge, append) binds
  // the focused window to a brand-new dataset through
  // `rebindFocusedPlotWindow`, which never grew the option. It is the most
  // common way a new dataset reaches the focused window, so F4's exact
  // symptom survived the fix via File > Import.
  it("F4 (import leg): a freshly imported dataset never inherits the old one's break", () => {
    // d2 is unrelated but shares the x range, so the `< 2 panels` refusal
    // would not have saved it either. Its x here is its `.time` -- a fresh
    // import arrives with `datasetViewDefaults`' null `xKey` -- and it spans
    // the old break, so the stale range really does PANEL the new dataset,
    // not merely sit in its document. Measured with the one-line fix
    // reverted: breaks `[[2, 3]]`, panels `[[0, 2], [3, 5]]`,
    // `multiPanelShowing` true.
    const imported: DataStruct = { ...DATA, time: [0, 1, 2, 3, 4, 5] };
    useApp.getState().addDataset({ id: "d2", name: "ds2", data: imported });
    const [w] = useApp.getState().plotWindows;
    expect(useApp.getState().activeId).toBe("d2");
    expect(w.datasetId).toBe("d2"); // the rebind really happened
    expect(w.document?.plot.axisBreaks.x).toEqual([]);
    expect(effective()).toBeNull();
    expect(multiPanelShowing(effective(), useApp.getState().stackMode, 1)).toBe(false);
  });

  // Round 3, finding 4. The clear is unconditional on the new `stackMode`
  // value, and that is deliberate: `multiPanelShowing` short-circuits on a
  // break composition ahead of every `stackMode` clause, so a break left in
  // place would pre-empt the per-channel stack the user just asked for --
  // the ON direction would be inert exactly as OFF was before F3.
  it("F3: the stack toggle ON clears the break too, so stacking is not pre-empted by it", () => {
    expect(breakPanelsOf(effective())).toHaveLength(2);
    useApp.getState().setStackMode(true);
    expect(useApp.getState().plotWindows[0].document?.plot.axisBreaks.x).toEqual([]);
    expect(effective()).toBeNull();
    // 2 plotted channels + stackMode -> the plain per-channel split mounts,
    // which is what the gesture means; with the break still there it would
    // have been the break panels instead.
    expect(multiPanelShowing(effective(), true, 2)).toBe(true);
  });

  // Round 3, finding 3: `Array.prototype.map` always allocates, so the toggle
  // handed `plotWindows` a fresh identity on EVERY call -- including the
  // overwhelmingly common one where no window carries a break at all.
  // `useWorkspaceAutosave`'s `shouldAutosave` compares `plotWindows` by
  // identity, so the toggle flipped the title bar's dirty marker and
  // restarted the 800 ms autosave debounce, and re-rendered every
  // `plotWindows` subscriber, for nothing.
  it("F3: the toggle leaves plotWindows IDENTICAL when no window holds a break", () => {
    reopenedWith(); // no break anywhere
    const before = useApp.getState();
    useApp.getState().setStackMode(true);
    const after = useApp.getState();
    expect(after.stackMode).toBe(true); // the toggle still did its job
    expect(after.plotWindows).toBe(before.plotWindows);
    expect(shouldAutosave(after, before)).toBe(false);
  });

  it("F3: clearing a real break DOES change plotWindows (the guard is not over-eager)", () => {
    const before = useApp.getState();
    useApp.getState().setStackMode(false);
    const after = useApp.getState();
    expect(after.plotWindows).not.toBe(before.plotWindows);
    expect(shouldAutosave(after, before)).toBe(true);
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
