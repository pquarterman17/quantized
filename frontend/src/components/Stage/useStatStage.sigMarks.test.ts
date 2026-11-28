// Significance marks from supplied p-values on the REAL stage hook (plan item
// 23): a saved post-hoc result's pairs become brackets on the plot, with no
// test run; the export carries the same layout; a source whose groups are not
// the plot's draws nothing and says which groups are missing.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsTukey } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import type { PosthocResult } from "../../lib/api/statsTestsMore";
import type { StatMarksByMode, StatPicks } from "../../lib/plotviewSanitize";
import { statisticalTestAnalysisResult } from "../../lib/statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "../../lib/statsTests";
import { describeResult } from "../../lib/statsTestsResults";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
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

const DS: Dataset = {
  id: "d1",
  name: "d",
  data: {
    time: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    values: [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [1, 6], [2, 9], [2, 10], [2, 11]],
    labels: ["grp", "y"], units: ["", ""], metadata: {}, cat_levels: { 0: ["A", "B", "C"] },
  },
};
const COLS = { group: [0, "grp"], group2: null, value: [1, "y"], facet: null, color: null } as StatPicks["cols"];
const pair = (i: number, j: number, p: number) => ({ i, j, diff: 1, p, ciLow: null, ciHigh: null, significant: p < 0.05, effect_size: null });

/** A saved Post hoc result, built the way the workshop saves one. */
function posthoc(id: string, labels: string[], key: PosthocResult["key"] = "tukey") {
  const data: PosthocResult = {
    pairs: [pair(0, 1, 0.2), pair(0, 2, 0.0004), pair(1, 2, 0.012)], n_groups: 3, alpha: 0.05, method: "Tukey HSD", key,
    omnibus_p: 0.01, adjusted: true, groups: [],
  };
  const out = describeResult({ id: "posthoc", data }, labels, 0.05);
  const params = { ...DEFAULT_PARAMS, more: { ...DEFAULT_PARAMS.more, posthoc: key } };
  return statisticalTestAnalysisResult(id, DS, "posthoc", DEFAULT_SELECTION, params, labels, out);
}
const GOOD = posthoc("good", ["grp = A", "grp = B", "grp = C"]);
const WRONG = posthoc("wrong", ["grp = A", "grp = B", "grp = Z"]);

function hook(marks: StatMarksByMode, picks: StatPicks = { mode: "box", cols: COLS }) {
  const p: UseStatStageParams = {
    active: DS, yKeys: [1], xKey: null, seriesOrder: null, seed: null, onSeedConsumed: vi.fn(), picks, marks,
  } as UseStatStageParams;
  return renderHook(() => useStatStage(p));
}
const sigOf = (resultId: string, over = {}) => ({ source: { kind: "result" as const, resultId }, ...over });

beforeEach(() => {
  vi.mocked(statsTukey).mockReset();
  vi.mocked(exportStatplotFigure).mockReset().mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockReset().mockResolvedValue(undefined);
  useApp.setState({ analysisResults: [GOOD, WRONG] });
});

describe("marks from a saved post-hoc result", () => {
  it("draws the result's pairs with hand-set thresholds, runs no test, and names the source", async () => {
    const { result } = hook({ box: { sig: sigOf("good") } });
    await waitFor(() => expect(result.current.errorNote).toContain("p-values from"));
    const d = result.current.draw as { comparisons?: { brackets: { a: number; b: number; label: string }[] } };
    // p = 0.2 is ns (hidden), 0.0004 < 0.001 -> ***, 0.012 < 0.05 -> *; narrower span first
    expect(d.comparisons?.brackets.map((b) => [b.a, b.b, b.label])).toEqual([[1, 2, "*"], [0, 2, "***"]]);
    expect(statsTukey).not.toHaveBeenCalled();
    expect(result.current.errorNote).toContain("tukey");
    expect(result.current.comparisons.error).toBeNull();
  });

  it("shows ns and the p-value text when asked", async () => {
    const { result } = hook({ box: { sig: sigOf("good", { showNs: true, showP: true }) } });
    await waitFor(() => expect(result.current.errorNote).toContain("p-values shown"));
    const d = result.current.draw as { comparisons?: { brackets: { label: string }[] } };
    expect(d.comparisons?.brackets.map((b) => b.label)).toEqual(["p = 0.2", "p = 0.012", "p = 0.0004"]);
  });

  it("uses the user's own thresholds", async () => {
    const levels = [{ mark: "+", below: 0.5 }, { mark: "++", below: 0.005 }];
    const { result } = hook({ box: { sig: sigOf("good", { levels }) } });
    await waitFor(() => expect(result.current.errorNote).toContain("p-values from"));
    const d = result.current.draw as { comparisons?: { brackets: { a: number; b: number; label: string }[] } };
    expect(d.comparisons?.brackets.map((b) => [b.a, b.b, b.label])).toEqual([[0, 1, "+"], [1, 2, "+"], [0, 2, "++"]]);
  });

  it("exports the very layout the screen drew", async () => {
    const { result } = hook({ box: { sig: sigOf("good", { showNs: true }) } });
    await waitFor(() => expect(result.current.errorNote).toContain("p-values from"));
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.comparisons).toEqual((result.current.draw as { comparisons?: unknown }).comparisons);
    expect(spec.comparisons?.brackets.map((b) => b.label)).toEqual(["ns", "*", "***"]);
  });

  it("marks a grouped bar chart the same way", async () => {
    const { result } = hook({ bar: { sig: sigOf("good") } }, { mode: "bar", cols: COLS });
    await waitFor(() => expect(result.current.errorNote).toContain("p-values from"));
    const d = result.current.draw as { comparisons?: { brackets: { label: string }[] } };
    expect(d.comparisons?.brackets.map((b) => b.label)).toEqual(["*", "***"]);
  });
});

describe("refusals draw nothing and say why", () => {
  it("a source run on other groups names the groups on each side", async () => {
    const { result } = hook({ box: { sig: sigOf("wrong") } });
    await waitFor(() => expect(result.current.comparisons.error).toContain('names "grp = Z"'));
    expect(result.current.comparisons.error).toContain("no p-values for the plot's \"grp = C\"");
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    expect((result.current.draw as { comparisons?: unknown }).comparisons).toBeUndefined();
    expect(result.current.errorNote).toBeNull();
  });

  it("no source is picked for the user: an empty source asks for one", async () => {
    const { result } = hook({ box: { sig: sigOf("") } });
    await waitFor(() => expect(result.current.comparisons.error).toContain("Pick a post-hoc"));
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    expect((result.current.draw as { comparisons?: unknown }).comparisons).toBeUndefined();
  });

  it("a stacked bar chart is refused as the inline test is", async () => {
    const { result } = hook({ bar: { sig: sigOf("good") } }, { mode: "bar", cols: COLS, barStack: true });
    await waitFor(() => expect(result.current.comparisons.error).toMatch(/grouped bars, one series/));
  });
});
