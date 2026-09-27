// P2.6 box 1 — canvas <-> export PARITY for the categorical marks: drive the
// real Stat Stage hook, set each option, and assert that the draw the canvas
// paints and the request the export posts carry the SAME resolved options,
// the same raw points (row for row) and the same error-bar numbers. The
// backend half (`tests/test_calc_figure_stat_marks.py`) renders every one of
// those request fields and reads the artists back.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox, statsViolin } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import { errorHalfWidth } from "../../lib/statMarks";
import type { DataStruct, Dataset } from "../../lib/types";
import { barErrorHalf } from "./statDrawMarks";
import { categoryAxisLayout } from "./statRenderAxes";
import { useStatStage } from "./useStatStage";

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

// lot (2 levels) x wafer (2 levels) x value; row 5 is an outlier in lot 0.
const ROWS = [
  [0, 0, 1], [0, 1, 2], [0, 0, 2.5], [0, 1, 3], [0, 0, 3.2], [0, 1, 40],
  [1, 0, 10], [1, 1, 11], [1, 0, 12], [1, 1, 13], [1, 0, 12.5], [1, 1, 11.5],
];
const DATA: DataStruct = {
  time: ROWS.map((_, i) => i),
  values: ROWS,
  labels: ["lot", "wafer", "y"],
  units: ["", "", ""],
  metadata: {},
  cat_levels: { 0: ["L1", "L2"], 1: ["W1", "W2"] },
};
const DS: Dataset = { id: "m", name: "marks.csv", data: DATA };
// Hoisted: a fresh array per render would re-trigger the hook's compute effect forever.
const Y_KEYS = [2];
const params = () => ({ active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(statsBox).mockRejectedValue(new Error("offline")); // the client fallback: same algorithm
  vi.mocked(statsViolin).mockImplementation(async (data: number[]) => ({
    x: [Math.min(...data), Math.max(...data)], density: [0.5, 0.5], bandwidth: 1, quartiles: [1, 2, 3], n: data.length,
  }));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

async function exported(result: { current: ReturnType<typeof useStatStage> }) {
  await act(async () => {
    await result.current.exportFigure("svg");
  });
  return vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
}

describe("categorical marks — the canvas and the export carry the same options", () => {
  it("box: every point, jitter, mean +/- SD, rotated wrapped labels", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    await waitFor(() => expect(result.current.groupCol).toBe(0));
    act(() => result.current.setValueCol(2));
    act(() =>
      result.current.setMarks({
        points: "all", jitterWidth: 0.5, summary: "mean", errorBars: "sd", labelRotation: 45, labelWrap: true,
      }),
    );
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "box" && d.marks?.errorBars === "sd" && d.points != null).toBe(true);
    });
    const draw = result.current.draw;
    if (draw?.mode !== "box") throw new Error("expected a box draw");
    const spec = await exported(result);
    expect(draw.marks).toEqual(result.current.marks);
    expect(spec).toMatchObject({
      kind: "box", points: "all", jitter_width: 0.5, summary: "mean", error_bars: "sd",
      axis_style: { rotation: 45, wrap: 12, tiered: false },
    });
    // The export's jittered points are the canvas's, row for row.
    expect(spec.point_row_indices).toEqual(draw.points?.map((g) => g.points.map((p) => p.rowIndex)));
    expect(spec.point_row_indices?.[0]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("strip: outliers only, median marker, no jitter", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setMode("strip"));
    act(() => result.current.setValueCol(2));
    act(() => result.current.setMarks({ points: "outliers", jitter: false, summary: "median" }));
    await waitFor(() => expect(result.current.draw?.mode === "strip" && result.current.draw.marks?.points).toBe("outliers"));
    const spec = await exported(result);
    expect(spec).toMatchObject({ kind: "strip", points: "outliers", jitter_width: 0, summary: "median" });
    expect(spec.point_row_indices).not.toBeNull();
  });

  it("violin: points ride the draw and the request; no summary fields", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setMode("violin"));
    act(() => result.current.setValueCol(2));
    act(() => result.current.setMarks({ points: "all", jitterWidth: 1 }));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "violin" && d.points != null && d.marks?.points === "all").toBe(true);
    });
    const draw = result.current.draw;
    if (draw?.mode !== "violin") throw new Error("expected a violin draw");
    const spec = await exported(result);
    expect(spec).toMatchObject({ kind: "violin", points: "all", jitter_width: 1 });
    expect(spec.summary).toBeUndefined();
    expect(spec.point_row_indices).toEqual(draw.points?.map((g) => g.points.map((p) => p.rowIndex)));
  });

  it("nested: the two-tier axis on screen is the tiered axis in the export", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setValueCol(2));
    act(() => result.current.setGroup2Col(1));
    await waitFor(() => expect(result.current.draw?.mode === "box" && result.current.draw.boxes.length).toBe(4));
    const draw = result.current.draw;
    if (draw?.mode !== "box") throw new Error("expected a box draw");
    const labels = draw.slots?.map((s) => s.label) ?? draw.boxes.map((b) => b.label);
    expect(categoryAxisLayout(labels).tiers?.map((r) => r.label)).toEqual(["lot = L1", "lot = L2"]);
    const spec = await exported(result);
    expect(spec.labels).toEqual(labels);
    expect(spec.axis_style).toEqual({ rotation: 0, wrap: null, tiered: true });
  });

  it("bar: the exported error half-widths are the ones the canvas draws, per kind", async () => {
    const { result } = renderHook(() => useStatStage({ ...params(), yKeys: Y_KEYS }));
    act(() => result.current.setMode("bar"));
    for (const kind of ["se", "sd", "ci95", "none"] as const) {
      act(() => result.current.setMarks({ errorBars: kind }));
      await waitFor(() => {
        const d = result.current.draw;
        expect(d?.mode === "bar" && d.marks?.errorBars).toBe(kind);
      });
      const draw = result.current.draw;
      if (draw?.mode !== "bar") throw new Error("expected a bar draw");
      await act(async () => {
        await result.current.exportFigure("svg");
      });
      const spec = vi.mocked(exportCategoricalFigure).mock.calls.at(-1)![0];
      const screen = draw.data.groups.map((g) => g.series.map((s) => barErrorHalf(draw, s)));
      expect(spec.errors).toEqual(screen.map((row) => row.map((h) => (Number.isFinite(h) ? h : null))));
      const s0 = draw.data.groups[0].series[0];
      if (kind !== "none") expect(spec.errors[0][0]).toBe(errorHalfWidth(kind, s0.sem, s0.n));
      else expect(spec.errors.flat().every((e) => e === null)).toBe(true);
    }
  });

  it("faceted: each panel shows what a panel can (fliers, summary; no points, no connect line), as the export does", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setValueCol(2));
    act(() => result.current.setFacetCol(1));
    act(() => result.current.setMarks({ points: "all", summary: "mean", errorBars: "se", connectMeans: true }));
    await waitFor(() => expect(result.current.drawFacets?.length).toBe(2));
    for (const f of result.current.drawFacets ?? []) {
      expect(f.draw.mode === "box" && f.draw.marks).toMatchObject({
        points: "outliers", summary: "mean", errorBars: "se", connectMeans: false,
      });
    }
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
    // The request names the stage's choice; the backend maps it per panel
    // with the SAME rule (calc.figure_facets._facet_marks: box "all" ->
    // its fliers) and draws no connect line in a facet.
    expect(spec).toMatchObject({ points: "all", summary: "mean", error_bars: "se" });
    expect(spec.facets).toHaveLength(2);
    expect(spec.show_connect_means).toBeUndefined();
  });

  it("marks are display-only: switching error bars never re-fetches the box stats", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setValueCol(2));
    await waitFor(() => expect(result.current.draw?.mode).toBe("box"));
    const calls = vi.mocked(statsBox).mock.calls.length;
    act(() => result.current.setMarks({ summary: "mean", errorBars: "se" }));
    await waitFor(() => expect(result.current.draw?.mode === "box" && result.current.draw.marks?.errorBars).toBe("se"));
    expect(vi.mocked(statsBox).mock.calls.length).toBe(calls);
  });
});
