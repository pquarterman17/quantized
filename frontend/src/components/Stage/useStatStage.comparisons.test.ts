// Significance marks on the REAL stage hook (gap audit 8 lane SIG): the groups
// tested are the plotted ones (row exclusion respected), the live draw carries
// the marks, the screen footnote names the test and correction, the export
// request carries the SAME marks, and nothing is drawn (with a reason) where
// the comparison would be ambiguous. Opt-in: off, no request at all.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsTukey } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import type { StatMarksByMode, StatPicks } from "../../lib/plotviewSanitize";
import type { Dataset } from "../../lib/types";
import { useStatStage, type UseStatStageParams } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn().mockRejectedValue(new Error("offline")),
  statsTukey: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

// group column (levels A, B, C) x value: three well separated groups of 3.
const DS: Dataset = {
  id: "d1",
  name: "d",
  data: {
    time: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    values: [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [1, 6], [2, 9], [2, 10], [2, 11]],
    labels: ["grp", "y"],
    units: ["", ""],
    metadata: {},
    cat_levels: { 0: ["A", "B", "C"] },
  },
};
const COLS = { group: [0, "grp"], group2: null, value: [1, "y"], facet: null, color: null } as StatPicks["cols"];

function params(over: Partial<UseStatStageParams> & { marks?: StatMarksByMode } = {}, picks: StatPicks = { mode: "box", cols: COLS }): UseStatStageParams {
  return { active: DS, yKeys: [1], xKey: null, seriesOrder: null, seed: null, onSeedConsumed: vi.fn(), picks, ...over };
}
/** Params are built ONCE: a fresh `picks` / `marks` object per render would re-run the stage's effects forever. */
function hook(over: Parameters<typeof params>[0] = {}, picks?: StatPicks) {
  const p = params(over, picks);
  return renderHook(() => useStatStage(p));
}
const BRACKETS: StatMarksByMode = { box: { comparisons: "brackets" }, bar: { comparisons: "brackets" } };
const TUKEY = [{ i: 0, j: 1, p: 0.2 }, { i: 0, j: 2, p: 0.0004 }, { i: 1, j: 2, p: 0.03 }];

beforeEach(() => {
  vi.mocked(statsTukey).mockReset();
  vi.mocked(statsTukey).mockResolvedValue({ pairs: TUKEY });
  vi.mocked(exportStatplotFigure).mockReset().mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockReset().mockResolvedValue(undefined);
});

describe("off by default", () => {
  it("sends no request and draws no marks", async () => {
    const { result } = hook();
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    expect(statsTukey).not.toHaveBeenCalled();
    expect((result.current.draw as { comparisons?: unknown }).comparisons).toBeUndefined();
    expect(result.current.errorNote).toBeNull();
  });
});

describe("box with brackets", () => {
  it("tests the plotted groups, draws the brackets, and names the test under the plot", async () => {
    const { result } = hook({ marks: BRACKETS });
    await waitFor(() => expect(result.current.errorNote).toContain("Tukey HSD"));
    expect(vi.mocked(statsTukey).mock.calls[0][0]).toEqual([[1, 2, 3], [4, 5, 6], [9, 10, 11]]);
    const d = result.current.draw as { comparisons?: { brackets: { label: string }[]; top: number } };
    expect(d.comparisons?.brackets.map((b) => b.label)).toEqual(["*", "***"]);
    expect(result.current.errorNote).toContain("familywise alpha = 0.05");
    expect(result.current.comparisons.error).toBeNull();
  });

  it("respects an excluded row: the test sees the plot's groups, not the raw column", async () => {
    const active = { ...DS, excludedRows: [8] };
    const { result } = hook({ active, marks: BRACKETS });
    await waitFor(() => expect(result.current.errorNote).toContain("Tukey HSD"));
    expect(vi.mocked(statsTukey).mock.calls.at(-1)![0]).toEqual([[1, 2, 3], [4, 5, 6], [9, 10]]);
  });

  it("exports the same marks, and keeps its own footnote text out of error_note", async () => {
    const { result } = hook({ marks: { box: { comparisons: "brackets", summary: "mean", errorBars: "sd" } } });
    await waitFor(() => expect(result.current.errorNote).toContain("Tukey HSD"));
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    const draw = result.current.draw as { comparisons?: unknown };
    expect(spec.comparisons).toEqual(draw.comparisons);
    expect(spec.error_note).toBe("Error bars: SD");
  });
});

describe("bar", () => {
  const bar: StatPicks = { mode: "bar", cols: COLS };
  it("compares the categories of a one-series grouped bar chart and exports the marks", async () => {
    const { result } = hook({ marks: BRACKETS }, bar);
    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    expect(result.current.comparisons.error).toBeNull();
    await waitFor(() => expect(result.current.errorNote).toContain("Tukey HSD"));
    const d = result.current.draw as { comparisons?: { brackets: unknown[] } };
    expect(d.comparisons?.brackets).toHaveLength(2);
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    expect(vi.mocked(exportCategoricalFigure).mock.calls[0][0].comparisons).toEqual(d.comparisons);
  });

  it("refuses a stacked bar chart with a reason", async () => {
    const { result } = hook({ marks: BRACKETS }, { ...bar, barStack: true });
    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    expect(result.current.comparisons.error).toMatch(/grouped bars, one series/);
    expect((result.current.draw as { comparisons?: unknown }).comparisons).toBeUndefined();
    expect(statsTukey).not.toHaveBeenCalled();
  });
});

describe("faceted", () => {
  it("refuses with a reason and sends no request", async () => {
    const facetCols = { group: [0, "grp"], group2: null, value: [1, "y"], facet: [0, "grp"], color: null } as StatPicks["cols"];
    const { result } = hook({ marks: BRACKETS }, { mode: "box", cols: facetCols });
    await waitFor(() => expect(result.current.comparisons.error).toMatch(/faceted/));
    expect(statsTukey).not.toHaveBeenCalled();
  });
});
