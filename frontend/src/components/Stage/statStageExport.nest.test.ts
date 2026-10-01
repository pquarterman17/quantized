// The nested-axis flag on a box export must follow the CURRENT grouping, not
// the last finished draw. Right after "then by" changes, the stage's draw is
// pending (null) while `groups` already carry the two-tier labels; the export
// used to read `nestLabel` off that null draw and post `tiered: false` with
// nested labels (seen as an intermittent e2e failure in
// stat-summary-long-labels.spec.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";

const exportStatplotFigure = vi.fn(async () => undefined);
vi.mock("../../lib/api/figures", () => ({
  exportStatplotFigure: (...a: unknown[]) => exportStatplotFigure(...(a as [])),
  exportCategoricalFigure: vi.fn(async () => undefined),
}));

import type { ResolvedStatMarks } from "../../lib/statMarks";
import type { DataStruct } from "../../lib/types";
import { exportStatStage, type StatStageExportInputs } from "./statStageExport";

const marks: ResolvedStatMarks = {
  points: "none", jitterWidth: 0, summary: "none", errorBars: "none",
  connectMeans: false, labelRotation: 0, labelWrap: false,
} as unknown as ResolvedStatMarks;

function inputs(over: Partial<StatStageExportInputs> = {}): StatStageExportInputs {
  return {
    data: {} as DataStruct,
    mode: "box",
    draw: null,
    drawFacets: null,
    groups: [
      { label: "Lot = A / Wafer = 1", values: [1, 2, 3] },
      { label: "Lot = A / Wafer = 2", values: [2, 3, 4] },
    ],
    indexedGroups: [],
    valueCol: 0,
    valueLabel: "thickness",
    groupLabel: "Lot / Wafer",
    barValueLabel: "thickness",
    barStack: false,
    dist: "normal",
    bins: "auto",
    fit: null,
    marks,
    ...over,
  };
}

function postedAxisStyle(): { tiered: boolean; tiers?: unknown[] } | null {
  const spec = (exportStatplotFigure.mock.calls.at(-1) as unknown[] | undefined)?.[0] as
    | { axis_style: { tiered: boolean; tiers?: unknown[] } | null }
    | undefined;
  return spec?.axis_style ?? null;
}

describe("exportStatStage nested axis while the draw is pending", () => {
  beforeEach(() => exportStatplotFigure.mockClear());

  it("posts a tiered axis from the current nestLabel when the draw is still null", async () => {
    await exportStatStage("svg", inputs({ nestLabel: "Wafer" }));
    expect(postedAxisStyle()?.tiered).toBe(true);
    expect(postedAxisStyle()?.tiers).toHaveLength(2);
  });

  it("stays flat when the current grouping is not nested", async () => {
    await exportStatStage("svg", inputs({
      nestLabel: null,
      groups: [{ label: "A", values: [1, 2] }, { label: "B", values: [3, 4] }],
    }));
    expect(postedAxisStyle()?.tiered).toBe(false);
  });
});
