// P2.6 box 1, second pass — canvas <-> export PARITY for the marks bar and
// violin gained: drive the real Stat Stage hook, set each option, and assert
// the draw the canvas paints and the request the export posts carry the SAME
// marks, the same raw points (row for row, ORIGINAL rows under exclusion) and
// the same error-bar footnote. The backend half (`tests/
// test_stat_marks_violin_bar.py`) renders those request fields and reads the
// matplotlib artists back.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox, statsViolin } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import { errorBarNote } from "../../lib/statMarks";
import { boxStatsClient } from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
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

// lot (2 levels) x value; row 5 is an outlier in lot 0; row 2 is EXCLUDED.
const ROWS = [
  [0, 1], [0, 2], [0, 99], [0, 3], [0, 3.2], [0, 40],
  [1, 10], [1, 11], [1, 12], [1, 13], [1, 12.5], [1, 11.5],
];
const DATA: DataStruct = {
  time: ROWS.map((_, i) => i),
  values: ROWS,
  labels: ["lot", "y"],
  units: ["", ""],
  metadata: {},
  cat_levels: { 0: ["L1", "L2"] },
};
const DS: Dataset = { id: "m2", name: "marks2.csv", data: DATA, excludedRows: [2] };
const Y_KEYS = [1];
const params = () => ({ active: DS, yKeys: Y_KEYS, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  vi.mocked(statsViolin).mockImplementation(async (data: number[]) => ({
    x: [Math.min(...data) - 1, Math.max(...data) + 1], density: [0.5, 0.5], bandwidth: 1, quartiles: [1, 2, 3], n: data.length,
  }));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

async function exportBar(result: { current: ReturnType<typeof useStatStage> }) {
  await act(async () => {
    await result.current.exportFigure("svg");
  });
  return vi.mocked(exportCategoricalFigure).mock.calls.at(-1)![0];
}

describe("bar marks — the canvas and the export carry the same points and summary", () => {
  it("grouped: every point (original rows, excluded row gone), jitter, median", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setMode("bar"));
    act(() => result.current.setMarks({ points: "all", jitterWidth: 0.5, summary: "median" }));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "bar" && d.data.groups[0].series[0].raw != null).toBe(true);
    });
    const draw = result.current.draw;
    if (draw?.mode !== "bar") throw new Error("expected a bar draw");
    const cells = draw.data.groups.map((g) => g.series.map((s) => s.raw!));
    // The analysis view dropped row 2, yet every point keeps its ORIGINAL row.
    expect(cells[0][0].points.map((p) => p.rowIndex)).toEqual([0, 1, 3, 4, 5]);
    expect(cells[0][0].median).toBe(boxStatsClient([1, 2, 3, 3.2, 40]).median);
    const spec = await exportBar(result);
    expect(spec).toMatchObject({ points: "all", jitter_width: 0.5, summary: "median" });
    expect(spec.raw_rows).toEqual(cells.map((row) => row.map((c) => c.points.map((p) => p.rowIndex))));
    expect(spec.raw).toEqual(cells.map((row) => row.map((c) => c.points.map((p) => p.value))));
    expect(spec.groups).toEqual(draw.data.groups.map((g) => g.label)); // the jitter's category key
  });

  it("stacked bars, and bars with no mark, post the request they always did", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setMode("bar"));
    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    const plain = await exportBar(result);
    for (const k of ["points", "summary", "jitter_width", "raw", "raw_rows"] as const) expect(plain[k]).toBeUndefined();
    act(() => result.current.setBarStack(true));
    act(() => result.current.setMarks({ points: "all", summary: "mean" }));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "bar" && d.stacked && d.marks?.points).toBe("all");
    });
    const stacked = await exportBar(result);
    expect(stacked.stacked).toBe(true);
    for (const k of ["points", "summary", "raw"] as const) expect(stacked[k]).toBeUndefined();
  });

  it("outliers without a median posts the rows, a mean diamond alone posts none", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setMode("bar"));
    act(() => result.current.setMarks({ points: "outliers" }));
    await waitFor(() => expect(result.current.draw?.mode === "bar" && result.current.draw.marks?.points).toBe("outliers"));
    expect((await exportBar(result)).raw_rows).not.toBeUndefined();
    act(() => result.current.setMarks({ points: "none", summary: "mean" }));
    await waitFor(() => expect(result.current.draw?.mode === "bar" && result.current.draw.marks?.summary).toBe("mean"));
    const spec = await exportBar(result);
    expect(spec).toMatchObject({ points: "none", summary: "mean" });
    expect(spec.raw).toBeUndefined();
  });
});

describe("violin marks — summary marker, error bars and the footnote", () => {
  it("mean +/- error bar: the draw carries the box stats, the request the marks, both the note", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setMode("violin"));
    await waitFor(() => expect(result.current.draw?.mode).toBe("violin"));
    expect(result.current.errorNote).toBeNull();
    for (const kind of ["sd", "se", "ci95"] as const) {
      act(() => result.current.setMarks({ summary: "mean", errorBars: kind }));
      await waitFor(() => expect(result.current.errorNote).toBe(errorBarNote(kind)));
      const draw = result.current.draw;
      if (draw?.mode !== "violin") throw new Error("expected a violin draw");
      expect(draw.boxes?.map((b) => b.mean)).toEqual([(1 + 2 + 3 + 3.2 + 40) / 5, 70 / 6]);
      await act(async () => {
        await result.current.exportFigure("svg");
      });
      const spec = vi.mocked(exportStatplotFigure).mock.calls.at(-1)![0];
      expect(spec).toMatchObject({ kind: "violin", summary: "mean", error_bars: kind, error_note: errorBarNote(kind) });
    }
    act(() => result.current.setMarks({ summary: "median" }));
    await waitFor(() => expect(result.current.errorNote).toBeNull()); // no error bar on a median
  });
});
