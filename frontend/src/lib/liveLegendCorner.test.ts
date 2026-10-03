// The Stage export pins an "auto" legend to the corner the screen drew it in
// (plot audit round 4; an eight-species SIMS profile drew bottom right on
// screen and centre left in the PDF).
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "./api/figures";
import { buildStageFigureSpec } from "./figureSpecStage";
import { withLiveLegendCorner } from "./liveLegendCorner";
import { useApp } from "../store/useApp";

const spec = (loc: string): FigureSpec => ({
  dataset: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
  overrides: { legend: { show: true, loc }, grid: true },
});

function stage(lc: string | null, legendClass: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "qzk-stage";
  if (lc) el.dataset.lc = lc;
  const legend = document.createElement("div");
  legend.className = `qzk-glass qzk-legend ${legendClass}`;
  el.appendChild(legend);
  return document.body.appendChild(el);
}

afterEach(() => document.body.replaceChildren());

describe("withLiveLegendCorner", () => {
  it("pins an auto legend to the screen's corner", () => {
    stage("se", "auto");
    expect(withLiveLegendCorner(spec("auto")).overrides).toEqual({ legend: { show: true, loc: "lower right" }, grid: true });
  });

  it("leaves an outside column, a fixed corner and a stage without a corner alone", () => {
    stage("se", "out");
    expect(withLiveLegendCorner(spec("auto")).overrides?.legend?.loc).toBe("auto");
    document.body.replaceChildren();
    stage("se", "auto");
    expect(withLiveLegendCorner(spec("upper left")).overrides?.legend?.loc).toBe("upper left");
    document.body.replaceChildren();
    stage(null, "auto");
    expect(withLiveLegendCorner(spec("auto")).overrides?.legend?.loc).toBe("auto");
  });

  it("is applied by the Stage export's spec builder", () => {
    stage("sw", "auto");
    useApp.setState({ plotWindows: [], focusedWindowId: null, legendPos: "auto", showLegend: true, yKeys: null, xKey: null });
    const ds = { id: "d1", name: "a.csv", data: spec("auto").dataset };
    const st = useApp.getState;
    const built = buildStageFigureSpec(vi.fn(() => ({ ...st(), datasets: [ds], activeId: "d1" })) as unknown as typeof st, ds, "a", {
      fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "",
    });
    expect(built.overrides?.legend?.loc).toBe("lower left");
  });
});
