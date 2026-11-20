// An Origin column chart opened on the Stat Stage (`originFigureSelection.
// figureBarState`: bar mode grouped by X, one category per row): a row with X
// but no Y is no category (Origin draws none there), the 100 % stack draws
// shares, and the layer's own Y range is the value axis on screen AND export.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportCategoricalFigure } from "../../lib/api/figures";
import type { StatPicks } from "../../lib/plotviewSanitize";
import type { Dataset } from "../../lib/types";
import { useStatStage, type UseStatStageParams } from "./useStatStage";

vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportCategoricalFigure: vi.fn(),
}));

// X 1..8; Y only on rows 1-3 (the Etna Graph19 shape: rows 4-8 have X, no Y).
const NAN = Number.NaN;
const DS: Dataset = {
  id: "d1",
  name: "Book1",
  data: {
    time: [1, 2, 3, 4, 5, 6, 7, 8],
    values: [[1, 3], [2, 2], [5, 15], [NAN, NAN], [NAN, NAN], [NAN, NAN], [NAN, NAN], [NAN, NAN]],
    labels: ["B", "C"],
    units: ["", ""],
    metadata: {},
  },
};
const COLS = { group: [-1, ""], group2: null, value: [0, "B"], facet: null, color: null } as StatPicks["cols"];

function params(picks: StatPicks, hideEmptyLevels = false): UseStatStageParams {
  return { active: DS, yKeys: [0, 1], xKey: null, seriesOrder: null, seed: null, onSeedConsumed: vi.fn(), picks, hideEmptyLevels };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

describe("useStatStage: an Origin column chart grouped by X", () => {
  it("draws one category per row that has a Y, never an empty n=0 slot", async () => {
    const { result } = renderHook((p: UseStatStageParams) => useStatStage(p), { initialProps: params({ mode: "bar", barStack: true, cols: COLS }) });
    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    const d = result.current.draw;
    if (d?.mode !== "bar") throw new Error("bar draw expected");
    expect(d.data.groups).toHaveLength(3);
    expect(d.data.groups.map((g) => g.series.map((s) => s.mean))).toEqual([[1, 3], [2, 2], [5, 15]]);
  });

  it("a 100 % stack draws shares and the layer's Y range rides to the export", async () => {
    const picks: StatPicks = { mode: "bar", barStack: true, barPercent: true, valueRange: [0, 100], cols: COLS };
    const { result } = renderHook((p: UseStatStageParams) => useStatStage(p), { initialProps: params(picks) });
    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    const d = result.current.draw;
    if (d?.mode !== "bar") throw new Error("bar draw expected");
    expect(d.valueRange).toEqual([0, 100]);
    expect(d.data.groups.map((g) => g.series.map((s) => s.mean))).toEqual([[25, 75], [50, 50], [25, 75]]);
    await act(async () => {
      await result.current.exportFigure("pdf");
    });
    const spec = vi.mocked(exportCategoricalFigure).mock.calls[0][0];
    expect(spec.stacked).toBe(true);
    expect(spec.y_domain).toEqual([0, 100]);
    expect(spec.values).toEqual([[25, 75], [50, 50], [25, 75]]);
  });

  it("changing the layout or a column drops the saved range (a 100 % axis must not clip a raw stack)", () => {
    const picks: StatPicks = { mode: "bar", barStack: true, barPercent: true, valueRange: [0, 100], cols: COLS };
    const onPicksChange = vi.fn();
    const { result } = renderHook((p: UseStatStageParams) => useStatStage(p), { initialProps: { ...params(picks), onPicksChange } });
    const after = (): StatPicks => (onPicksChange.mock.lastCall![0] as (p: StatPicks) => StatPicks)(picks);
    act(() => result.current.setBarLayout("percent")); // no change: the range stays
    expect(after()).toBe(picks);
    act(() => result.current.setBarLayout("stacked"));
    expect(after()).toEqual({ mode: "bar", barStack: true, barPercent: false, cols: COLS });
    act(() => result.current.setValueCol(1));
    expect(after()).not.toHaveProperty("valueRange");
    act(() => result.current.setMode("box")); // the bar values are unchanged: kept
    expect(after().valueRange).toEqual([0, 100]);
  });

  it("no saved range: the export autoscales as before (no y_domain sent)", async () => {
    const { result } = renderHook((p: UseStatStageParams) => useStatStage(p), { initialProps: params({ mode: "bar", barStack: false, cols: COLS }) });
    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    await act(async () => {
      await result.current.exportFigure("pdf");
    });
    expect(vi.mocked(exportCategoricalFigure).mock.calls[0][0]).not.toHaveProperty("y_domain");
  });
});
