// JMP_GAP J5 residual / P2.6 "not done" (closed 2026-09-29): raw points in
// FACET panels. Every facet slice carries the rows it kept
// (`lib/facet.FacetSlice.rows`), composed with the analysis view's `rowIds`
// through `facetSliceRowIds`, so a panel's points carry ORIGINAL dataset
// rows exactly as the flat plot's do. Drives the real Stat Stage hook and
// asserts, per panel, that the draw the canvas paints and the request the
// export posts carry the same points row for row, under the same category
// labels -- the two inputs of the shared jitter hash (`lib/jitter.ts`,
// `calc.statplots.deterministic_jitter`), so the screen and the figure put
// every point in the same place. The backend half is
// `tests/test_stat_facet_points.py` (artists read back per panel).

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox, statsViolin } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
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

// lot x wafer x value; row 2 is EXCLUDED (every later row shifts one place
// in the analysis view, and again inside its facet slice).
const ROWS = [
  [0, 0, 1], [0, 1, 2], [0, 0, 99], [0, 1, 3], [0, 0, 2.5], [0, 1, 40],
  [1, 0, 10], [1, 1, 11], [1, 0, 12], [1, 1, 13], [1, 0, 12.5], [1, 1, 11.5], [0, 0, 3],
];
const DATA: DataStruct = {
  time: ROWS.map((_, i) => i),
  values: ROWS,
  labels: ["lot", "wafer", "y"],
  units: ["", "", ""],
  metadata: {},
  cat_levels: { 0: ["L1", "L2"], 1: ["W1", "W2"] },
};
const EXCLUDED = 2;
const DS: Dataset = { id: "fp", name: "facetpoints.csv", data: DATA, excludedRows: [EXCLUDED] };
const Y_KEYS = [2];
const params = () => ({ active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} });

/** The ORIGINAL rows of (wafer, lot), straight from the fixture. */
const cellRows = (wafer: number, lot: number) =>
  ROWS.flatMap((r, i) => (r[1] === wafer && r[0] === lot && i !== EXCLUDED ? [i] : []));
const PANEL_ROWS = [0, 1].map((w) => [0, 1].map((l) => cellRows(w, l)));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(statsBox).mockRejectedValue(new Error("offline")); // the client fallback: same algorithm
  vi.mocked(statsViolin).mockImplementation(async (data: number[]) => ({
    x: [Math.min(...data) - 1, Math.max(...data) + 1], density: [0.5, 0.5], bandwidth: 1, quartiles: [1, 2, 3], n: data.length,
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

type Hook = { current: ReturnType<typeof useStatStage> };
/** Each panel's drawn points: [panel][group] -> { label, rows }. */
function panelPoints(result: Hook) {
  return (result.current.drawFacets ?? []).map((f) => {
    const d = f.draw;
    if (d.mode !== "box" && d.mode !== "violin" && d.mode !== "strip") throw new Error(`unexpected ${d.mode}`);
    return (d.points ?? []).map((g) => ({ label: g.label, rows: g.points.map((p) => p.rowIndex) }));
  });
}

describe("faceted box / strip / violin — every panel draws its own points, as the export does", () => {
  it.each(["box", "strip", "violin"] as const)(
    "%s: panel points carry ORIGINAL rows (excluded row gone) and the export posts them per panel",
    async (mode) => {
      const { result } = renderHook(() => useStatStage(params()));
      act(() => result.current.setMode(mode));
      act(() => result.current.setValueCol(2));
      act(() => result.current.setFacetCol(1));
      act(() => result.current.setMarks({ points: "all", jitterWidth: 0.5 }));
      await waitFor(() => {
        const f = result.current.drawFacets;
        expect(f?.length === 2 && f.every((p) => "points" in p.draw && p.draw.points?.length === 2)).toBe(true);
      });
      for (const f of result.current.drawFacets ?? []) {
        expect(f.draw.mode).toBe(mode);
        expect("marks" in f.draw && f.draw.marks).toMatchObject({ points: "all", jitterWidth: 0.5 });
      }
      const drawn = panelPoints(result);
      expect(drawn.map((p) => p.map((g) => g.rows))).toEqual(PANEL_ROWS);
      const spec = await exported(result);
      expect(spec).toMatchObject({ kind: mode, points: "all", jitter_width: 0.5 });
      expect(spec.facets).toHaveLength(2);
      spec.facets!.forEach((panel, i) => {
        expect(panel.kind).toBe(mode);
        // The jitter hash's two inputs, identical on both sides.
        expect(panel.point_row_indices).toEqual(drawn[i].map((g) => g.rows));
        expect(panel.labels).toEqual(drawn[i].map((g) => g.label));
        expect(panel.data).toEqual(drawn[i].map((g) => g.rows.map((r) => ROWS[r][2])));
      });
    },
  );

  it("box with points 'outliers' resolves no raw rows and posts none (fliers, as before)", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setValueCol(2));
    act(() => result.current.setFacetCol(1));
    act(() => result.current.setMarks({ points: "outliers" }));
    await waitFor(() => expect(result.current.drawFacets?.length).toBe(2));
    for (const f of result.current.drawFacets ?? []) {
      expect(f.draw.mode === "box" && f.draw.marks?.points).toBe("outliers");
      expect(f.draw.mode === "box" && f.draw.points).toBeNull();
    }
    const spec = await exported(result);
    for (const panel of spec.facets ?? []) expect(panel.point_row_indices).toBeUndefined();
  });

  it("strip offers faceting and its panels count their points", async () => {
    const { result } = renderHook(() => useStatStage(params()));
    act(() => result.current.setMode("strip"));
    act(() => result.current.setValueCol(2));
    act(() => result.current.setFacetCol(1));
    await waitFor(() => expect(result.current.drawFacets?.length).toBe(2));
    expect(result.current.draw).toBeNull();
    expect(panelPoints(result).map((p) => p.map((g) => g.rows))).toEqual(PANEL_ROWS);
  });
});

async function exportBar(result: Hook) {
  await act(async () => {
    await result.current.exportFigure("svg");
  });
  return vi.mocked(exportCategoricalFigure).mock.calls.at(-1)![0];
}

describe("faceted grouped bars — every panel draws its own points and summary, as the export does", () => {
  it("points + median: each panel's cells carry ORIGINAL rows; the export posts them per panel", async () => {
    const { result } = renderHook(() => useStatStage({ ...params(), yKeys: Y_KEYS }));
    act(() => result.current.setMode("bar"));
    act(() => result.current.setFacetCol(1));
    act(() => result.current.setMarks({ points: "all", jitterWidth: 0.5, summary: "median" }));
    await waitFor(() => {
      const f = result.current.drawFacets;
      expect(f?.length === 2 && f.every((p) => p.draw.mode === "bar" && p.draw.data.groups[0].series[0].raw != null)).toBe(true);
    });
    const panels = (result.current.drawFacets ?? []).map((f) => {
      if (f.draw.mode !== "bar") throw new Error("expected bar panels");
      expect(f.draw.marks).toMatchObject({ points: "all", summary: "median" });
      return f.draw.data;
    });
    expect(panels.map((d) => d.groups.map((g) => g.series[0].raw!.points.map((p) => p.rowIndex)))).toEqual(PANEL_ROWS);
    expect(panels[0].groups[0].series[0].raw!.median).toBe(boxStatsClient(PANEL_ROWS[0][0].map((r) => ROWS[r][2])).median);
    const spec = await exportBar(result);
    expect(spec.facets).toHaveLength(2);
    spec.facets!.forEach((panel, i) => {
      expect(panel).toMatchObject({ points: "all", jitter_width: 0.5, summary: "median" });
      expect(panel.raw_rows).toEqual(panels[i].groups.map((g) => g.series.map((s) => s.raw!.points.map((p) => p.rowIndex))));
      expect(panel.raw).toEqual(panels[i].groups.map((g) => g.series.map((s) => s.raw!.points.map((p) => p.value))));
      expect(panel.groups).toEqual(panels[i].groups.map((g) => g.label)); // the jitter's category key
    });
  });

  it("stacked bar panels draw and post no marks; a mean diamond alone posts no rows", async () => {
    const { result } = renderHook(() => useStatStage({ ...params(), yKeys: Y_KEYS }));
    act(() => result.current.setMode("bar"));
    act(() => result.current.setFacetCol(1));
    act(() => result.current.setMarks({ points: "none", summary: "mean" }));
    await waitFor(() => {
      const f = result.current.drawFacets;
      expect(f?.length === 2 && f[0].draw.mode === "bar" && f[0].draw.marks?.summary).toBe("mean");
    });
    let spec = await exportBar(result);
    for (const panel of spec.facets ?? []) {
      expect(panel).toMatchObject({ points: "none", summary: "mean" });
      expect(panel.raw).toBeUndefined();
    }
    act(() => result.current.setBarStack(true));
    act(() => result.current.setMarks({ points: "all" }));
    await waitFor(() => {
      const f = result.current.drawFacets;
      expect(f?.length === 2 && f[0].draw.mode === "bar" && f[0].draw.stacked && f[0].draw.marks?.points).toBe("all");
    });
    spec = await exportBar(result);
    expect(spec.stacked).toBe(true);
    for (const panel of spec.facets ?? []) {
      for (const k of ["points", "summary", "raw", "raw_rows"] as const) expect(panel[k]).toBeUndefined();
    }
  });
});
