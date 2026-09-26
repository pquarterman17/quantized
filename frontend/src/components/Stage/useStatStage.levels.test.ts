// P2.6 — the Stat Stage end of "missing levels and unbalanced groups are
// explicit": the empty slots reach the DRAW (spliced around the stats the
// backend computed for the filled groups only) AND the export request, with the
// same count labels; the hide option, the notice and the dropped-row line.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import { statsBox, statsViolin } from "../../lib/api";
import { CAVEAT } from "../../lib/levelSlots";
import type { DataStruct, Dataset } from "../../lib/types";
import { useStatStage, type UseStatStageParams } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
  statsViolin: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

// lot: declared A/B/C/D. A has 12 rows, B 2 rows (caveated: n < 3 and 2/12 <
// 0.2), C's y is all NaN, D has no rows at all.
const Y = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const DATA: DataStruct = {
  time: Array.from({ length: 16 }, (_, i) => i),
  values: [
    ...Y.map((y) => [0, y]),
    [1, 40],
    [1, 42],
    [2, NaN],
    [2, NaN],
  ],
  labels: ["lot", "y"],
  units: ["", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C", "D"] },
};
const DS: Dataset = { id: "d1", name: "lots", data: DATA };

const box = (label: string, n: number, mean: number) => ({
  label, q1: mean, median: mean, q3: mean, iqr: 0, whislo: mean, whishi: mean, mean,
  sem: 1, ci_lo: mean - 1, ci_hi: mean + 1, n, fliers: [], whis: 1.5,
});

function params(over: Partial<UseStatStageParams> = {}): UseStatStageParams {
  return { active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: vi.fn(), ...over };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(statsBox).mockImplementation(async (groups, labels) => ({
    n_groups: groups.length,
    boxes: groups.map((g, i) => box(labels?.[i] ?? "", g.length, g[0])),
  }));
  vi.mocked(statsViolin).mockImplementation(() => new Promise(() => {}));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
});

describe("useStatStage — empty level slots (P2.6)", () => {
  it("stats are computed for the FILLED groups only; the draw carries every declared slot", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    const d = result.current.draw;
    if (d?.mode !== "box") throw new Error("expected a box draw");
    expect(vi.mocked(statsBox).mock.lastCall?.[1]).toEqual(["lot = A", "lot = B"]);
    expect(d.boxes.map((b) => [b.label, b.n])).toEqual([
      ["lot = A", 12], ["lot = B", 2], ["lot = C", 0], ["lot = D", 0],
    ]);
    expect(d.countLabels).toEqual(["n=12", `n=2${CAVEAT}`, "n=0", "n=0"]);
  });

  it("hideEmptyLevels drops the empty slots from the draw", async () => {
    const { result } = renderHook(() => useStatStage(params({ hideEmptyLevels: true })));
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    const d = result.current.draw;
    if (d?.mode !== "box") throw new Error("expected a box draw");
    expect(d.boxes.map((b) => b.label)).toEqual(["lot = A", "lot = B"]);
  });

  it("showGroupN=false keeps n=0 and the caveat but drops the plain count", async () => {
    const { result } = renderHook(() => useStatStage(params({ showGroupN: false })));
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    expect(result.current.draw?.countLabels).toEqual([null, `n=2${CAVEAT}`, "n=0", "n=0"]);
  });

  it("surfaces the unbalanced notice and the per-level dropped rows", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    await waitFor(() => expect(result.current.draw).not.toBeNull());
    expect(result.current.levelNotice).toContain("Unbalanced groups (n = 2 to 12");
    expect(result.current.dropped).toEqual({
      text: "Dropped: 2 non-finite Y values",
      detail: "lot = C: 2 non-finite Y",
    });
  });

  it("strip: the empty slot keeps an empty points group, index-aligned with its box", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    result.current.setMode("strip");
    await waitFor(() => expect(result.current.draw?.mode).toBe("strip"));
    const d = result.current.draw;
    if (d?.mode !== "strip") throw new Error("expected a strip draw");
    expect(d.points.map((g) => [g.label, g.points.length])).toEqual([
      ["lot = A", 12], ["lot = B", 2], ["lot = C", 0], ["lot = D", 0],
    ]);
    expect(d.boxes.map((b) => b.n)).toEqual([12, 2, 0, 0]);
  });

  it("export sends every slot (empty ones as data: []), the same count labels, and the notice as footnote", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    await result.current.exportFigure("svg");
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.labels).toEqual(["lot = A", "lot = B", "lot = C", "lot = D"]);
    expect((spec.data as number[][]).map((g) => g.length)).toEqual([12, 2, 0, 0]);
    expect(spec.count_labels).toEqual(result.current.draw?.countLabels);
    expect(spec.footnote).toBe(result.current.levelNotice);
  });

  it("the display-only toggles (hide empty, n) never re-run the stats request", async () => {
    const { result, rerender } = renderHook((p: UseStatStageParams) => useStatStage(p), { initialProps: params() });
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    const calls = vi.mocked(statsBox).mock.calls.length;
    rerender(params({ hideEmptyLevels: true, showGroupN: false }));
    await waitFor(() => expect(result.current.draw?.countLabels).toEqual([null, `n=2${CAVEAT}`]));
    expect(vi.mocked(statsBox).mock.calls.length).toBe(calls);
  });

  it("no notice or dropped line while a facet grid is drawn (its panels use their own grouping)", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    await waitFor(() => expect(result.current.levelNotice).not.toBeNull());
    result.current.setFacetCol(0);
    await waitFor(() => expect(result.current.levelNotice).toBeNull());
    expect(result.current.dropped).toBeNull();
  });
});

describe("useStatStage — STACKED bar counts (PR #433)", () => {
  // lot A: 6 rows with y only — y2 is the top segment, so the old top-segment
  // n labelled lot A's visible bar "n=0". lot B: 6 rows ALTERNATING y-only and
  // y2-only, so its total (6) differs from any single series' n (3): only a
  // count over row identities gets it right.
  const STACK: Dataset = {
    id: "s1",
    name: "stack",
    data: {
      time: Array.from({ length: 12 }, (_, i) => i),
      values: Array.from({ length: 12 }, (_, i) =>
        i < 6 ? [0, i, NaN] : i % 2 === 0 ? [1, i, NaN] : [1, NaN, i],
      ),
      labels: ["lot", "y", "y2"],
      units: ["", "", ""],
      metadata: {},
      cat_levels: { 0: ["A", "B"] },
    },
  };
  const KEYS = [1, 2];

  it("labels each stacked category with its total n, on screen and in the export", async () => {
    vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
    const { result } = renderHook(() => useStatStage(params({ active: STACK, yKeys: KEYS })));
    act(() => {
      result.current.setMode("bar");
      result.current.setBarStack(true);
    });
    await waitFor(() => expect(result.current.draw?.mode === "bar" && result.current.draw.stacked).toBe(true));
    expect(result.current.draw?.countLabels).toEqual(["n=6", "n=6"]);
    expect(result.current.levelNotice).toBeNull();
    await result.current.exportFigure("svg");
    expect(vi.mocked(exportCategoricalFigure).mock.lastCall?.[0].count_labels).toEqual(["n=6", "n=6"]);
  });
});

describe("useStatStage — bar categories (P2.6)", () => {
  it("empty categories stay on the axis with n=0, and the export carries the same count labels", async () => {
    vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
    const { result } = renderHook(() => useStatStage(params({ yKeys: [1] })));
    result.current.setMode("bar");
    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    const d = result.current.draw;
    if (d?.mode !== "bar") throw new Error("expected a bar draw");
    expect(d.data.groups.map((g) => [g.label, g.series[0].n])).toEqual([
      ["A", 12], ["B", 2], ["C", 0], ["D", 0],
    ]);
    expect(d.countLabels).toEqual(["n=12", `n=2${CAVEAT}`, "n=0", "n=0"]);
    await result.current.exportFigure("svg");
    const spec = vi.mocked(exportCategoricalFigure).mock.calls[0][0];
    expect(spec.groups).toEqual(["A", "B", "C", "D"]);
    expect(spec.count_labels).toEqual(d.countLabels);
    expect(spec.footnote).toBe(result.current.levelNotice);
  });
});
