// Waterfall X offset (`PlotView.waterfallDx`, Origin's waterfall X step) —
// persistence. An ADDITIVE field: no workspace version bump, so no new
// migration fixture (`versionFixtureGuard.test.ts` only demands one per
// version left behind). What it must guarantee instead: every frozen older
// document loads with the X step OFF, and a set step survives a .dwk round
// trip on each place a view is stored — a plot window, an editable figure,
// and a plot recipe's visual block.
import { describe, expect, it } from "vitest";

import v1 from "./__fixtures__/workspace/v1.dwk.json";
import v2 from "./__fixtures__/workspace/v2.dwk.json";
import v3 from "./__fixtures__/workspace/v3.dwk.json";
import v4 from "./__fixtures__/workspace/v4.dwk.json";
import { defaultPlotView, sanitizePlotView } from "./plotview";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const VIEWPORT = { width: 1600, height: 900 };

describe("waterfallDx — older documents load with the X step off", () => {
  for (const [version, doc] of [[1, v1], [2, v2], [3, v3], [4, v4]] as const) {
    it(`v${version}: every stored view reads waterfallDx 0`, () => {
      const loaded = parseWorkspace(JSON.stringify(doc), VIEWPORT);
      for (const w of loaded.plotWindows) expect(w.view.waterfallDx).toBe(0);
      for (const f of loaded.editableFigures) expect(f.plot.view.waterfallDx).toBe(0);
      for (const r of loaded.plotRecipes) expect(r.visual.waterfallDx ?? 0).toBe(0);
    });
  }

  it("a view object with no waterfallDx (or a non-finite one) sanitizes to 0", () => {
    const { waterfallDx: _gone, ...legacy } = defaultPlotView();
    expect(sanitizePlotView(legacy).waterfallDx).toBe(0);
    expect(sanitizePlotView({ ...legacy, waterfallDx: "0.2" }).waterfallDx).toBe(0);
    expect(sanitizePlotView({ ...legacy, waterfallDx: Number.NaN }).waterfallDx).toBe(0);
  });
});

describe("waterfallDx — a set X step round-trips the .dwk", () => {
  it("survives on a window view, an editable figure and a plot recipe (negative steps too)", () => {
    const loaded = parseWorkspace(JSON.stringify(v4), VIEWPORT);
    expect(loaded.editableFigures.length).toBeGreaterThan(0);
    expect(loaded.plotRecipes.length).toBeGreaterThan(0);
    loaded.editableFigures[0].plot.view.waterfallDx = -0.15;
    loaded.plotRecipes[0] = { ...loaded.plotRecipes[0], visual: { ...loaded.plotRecipes[0].visual, waterfallDx: 0.3 } };
    loaded.plotWindows = [{
      id: "w1", kind: "plot", datasetId: "a", title: "w", geometry: { x: 0, y: 0, w: 400, h: 300 },
      winState: "normal", z: 1, bg: "theme", linkGroup: null, pinned: false, view: { ...defaultPlotView(), waterfallDx: 0.05 },
    }];
    loaded.focusedWindowId = "w1";
    const again = parseWorkspace(serializeWorkspace(loaded), VIEWPORT);
    expect(again.editableFigures[0].plot.view.waterfallDx).toBe(-0.15);
    expect(again.plotRecipes[0].visual.waterfallDx).toBe(0.3);
    expect(again.plotWindows.find((w) => w.id === "w1")?.view.waterfallDx).toBe(0.05);
  });

  it("a malformed recipe X step is dropped, not kept", () => {
    const loaded = parseWorkspace(JSON.stringify(v4), VIEWPORT);
    const bad = { ...loaded.plotRecipes[0], visual: { ...loaded.plotRecipes[0].visual, waterfallDx: "wide" } };
    const again = parseWorkspace(serializeWorkspace({ ...loaded, plotRecipes: [bad as never] }), VIEWPORT);
    expect(again.plotRecipes[0].visual.waterfallDx ?? 0).toBe(0);
    expect(typeof (again.plotRecipes[0].visual.waterfallDx ?? 0)).toBe("number");
  });
});
