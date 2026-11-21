// Bar creation from the plot-type gallery: Column per X row and Horizontal Bar
// (ORIGIN_PLOT_TYPE_PARITY_PLAN creation gaps #10 / #14).

import { beforeEach, describe, expect, it } from "vitest";

import { applyPlotType } from "./figureDialogActions";
import { defaultPlotView } from "./plotview";
import { PLOT_TYPES, plotTypePatch } from "./plotTypes";
import type { Dataset } from "./types";
import { useApp } from "../store/useApp";

const ds: Dataset = {
  id: "d",
  name: "d.csv",
  data: { time: [0, 1, 2], values: [[1, 2], [2, 3], [3, 4]], labels: ["A", "B"], units: ["", ""], metadata: {} },
};

beforeEach(() => {
  useApp.setState({ ...defaultPlotView(), datasets: [ds], activeId: "d", history: [], future: [], status: "" });
});

describe("gallery bar creation", () => {
  const view = { seriesStyles: { 0: { color: "#ff0000", fill: "under" as const, marker: true } }, statPicks: {} };

  it("Column per X row draws every plotted column as bars on the XY stage, keeping the Series colour", () => {
    const p = plotTypePatch("columnX", view, [0, 1]);
    expect(p.statMode).toBe(false);
    expect(p.seriesStyles?.[0]).toMatchObject({ bars: true, color: "#ff0000", marker: false });
    expect(p.seriesStyles?.[0]?.fill).toBeUndefined();
    expect(p.seriesStyles?.[1]).toMatchObject({ bars: true });
  });

  it("Horizontal Bar sets bars: horizontal, and a later Line leaves bar mode", () => {
    const h = plotTypePatch("barH", view, [0, 1]);
    expect(h.seriesStyles?.[1]?.bars).toBe("horizontal");
    const back = plotTypePatch("line", { seriesStyles: h.seriesStyles ?? {}, statPicks: {} }, [0, 1]);
    expect(back.seriesStyles?.[0]?.bars).toBeUndefined();
    expect(back.seriesStyles?.[0]?.color).toBe("#ff0000");
  });

  it("the tiles are listed and apply through the gallery action", () => {
    const ids = PLOT_TYPES.map((t) => t.id);
    expect(ids).toContain("columnX");
    expect(ids).toContain("barH");
    applyPlotType("barH");
    expect(useApp.getState().statMode).toBe(false);
    expect(useApp.getState().seriesStyles[1]?.bars).toBe("horizontal");
  });
});
