// The stat-stage export draws what the canvas draws (review finding,
// pre-existing): it posted a "Value by Sample" title the canvas never shows,
// and no palette without a colour factor, so matplotlib's blue replaced the
// screen's theme colours. The palette now rides every request (the backend
// half: tests/test_stat_export_theme_colors.py) and no title is sent.

import { beforeEach, describe, expect, it, vi } from "vitest";

const exportStatplotFigure = vi.fn(async () => undefined);
const exportCategoricalFigure = vi.fn(async () => undefined);
vi.mock("../../lib/api/figures", () => ({
  exportStatplotFigure: (...a: unknown[]) => exportStatplotFigure(...(a as [])),
  exportCategoricalFigure: (...a: unknown[]) => exportCategoricalFigure(...(a as [])),
}));
const PALETTE = ["#a785fc", "#04c5b5", "#eba941", "#f44f62", "#51c672", "#449df0", "#f7758a", "#d2bd70"];
vi.mock("../../lib/plotEncodingWire", () => ({ resolvedPalette: () => PALETTE }));

import type { StatDrawData } from "./statRender";
import type { DataStruct } from "../../lib/types";
import { exportStatStage, type StatStageExportInputs } from "./statStageExport";

const stat = (mean: number) => ({ mean, sem: 0.1, n: 3 });

function inputs(over: Partial<StatStageExportInputs> = {}): StatStageExportInputs {
  return {
    data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [3], [4], [5], [6]], labels: ["Value"], units: [""], metadata: {} } as DataStruct,
    mode: "box",
    draw: null,
    drawFacets: null,
    groups: [{ label: "A", values: [1, 2, 3] }, { label: "B", values: [2, 3, 4] }],
    indexedGroups: [],
    valueCol: 0,
    valueLabel: "Value",
    groupLabel: "Sample",
    barValueLabel: "Value",
    barStack: false,
    dist: "normal",
    bins: "auto",
    fit: null,
    marks: null,
    ...over,
  };
}

const posted = (fn: typeof exportStatplotFigure) => (fn.mock.calls.at(-1) as unknown[] | undefined)?.[0] as Record<string, unknown>;

describe("stat-stage export: the canvas' colours, no title the canvas lacks", () => {
  beforeEach(() => {
    exportStatplotFigure.mockClear();
    exportCategoricalFigure.mockClear();
  });

  it("a bar chart without a colour factor posts the palette and no title", async () => {
    const draw = {
      mode: "bar",
      data: { groups: [{ label: "A", series: [stat(3.2)] }, { label: "B", series: [stat(4.5)] }], seriesLabels: ["Value"] },
    } as unknown as StatDrawData;
    await exportStatStage("svg", inputs({ mode: "bar", draw }));
    const spec = posted(exportCategoricalFigure);
    expect(spec.palette).toEqual(PALETTE);
    expect(spec.color_levels).toBeUndefined();
    expect(spec.title).toBeUndefined();
  });

  it.each(["box", "qq", "histogram"] as const)("a %s export posts the palette and no title", async (mode) => {
    await exportStatStage("svg", inputs({ mode }));
    const spec = posted(exportStatplotFigure);
    expect(spec.palette).toEqual(PALETTE);
    expect(spec.title).toBeUndefined();
  });
});
