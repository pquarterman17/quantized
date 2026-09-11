import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import { statsBox, statsViolin } from "../../lib/api";
import type { DataStruct, Dataset } from "../../lib/types";
import type { StatStageSeed } from "../../store/useApp";
import type { StatDrawData } from "./statRender";
import { useStatStage, type UseStatStageParams } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
  statsViolin: vi.fn(),
}));
// exportStatplotFigure/exportCategoricalFigure moved to lib/api/figures.ts
// (R8 bundle-diet pass) — mock them at their real import path.
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

// Same fixture shape verified in lib/plotspec.test.ts's "box/bar faceting"
// block: channel 0 a 2-level nominal GROUP column, channel 1 the continuous
// VALUE column, channel 2 a 3-level nominal FACET column whose level "2" is
// entirely non-finite in both grp and y — the level every mode must drop.
// ≥12 finite samples per categorical column so lib/modeling infers nominal.
const DATA: DataStruct = {
  time: Array.from({ length: 16 }, (_, i) => i),
  values: [
    [0, 10, 0],
    [0, 12, 0],
    [0, 14, 0],
    [1, 30, 0],
    [1, 32, 0],
    [1, 34, 0],
    [0, 110, 1],
    [0, 112, 1],
    [0, 114, 1],
    [1, 130, 1],
    [1, 132, 1],
    [1, 134, 1],
    [NaN, NaN, 2],
    [NaN, NaN, 2],
    [NaN, NaN, 2],
    [NaN, NaN, 2],
  ],
  labels: ["grp", "y", "fac"],
  units: ["", "", ""],
  metadata: {},
};
const DS: Dataset = { id: "d1", name: "run.dat", data: DATA };

function baseParams(overrides: Partial<UseStatStageParams> = {}): UseStatStageParams {
  return {
    active: DS,
    yKeys: null,
    xKey: null,
    seriesOrder: null,
    seed: null,
    onSeedConsumed: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  // Full reset (not just clearAllMocks) so no test's mockImplementation
  // leaks into the next. Default: a promise that never settles — the hook
  // ALWAYS mounts in the default "box" mode with a real (finite) group, so
  // every test's initial render synchronously calls statsBox once whether
  // or not that particular test cares about box data; a never-settling
  // default lets that call happen harmlessly (no throw, no stray state
  // update after the test ends) without needing bespoke setup everywhere.
  // Tests that care about box/violin resolution override before rendering.
  vi.resetAllMocks();
  vi.mocked(statsBox).mockImplementation(() => new Promise(() => {}));
  vi.mocked(statsViolin).mockImplementation(() => new Promise(() => {}));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

describe("useStatStage — box/strip marks (JMP_GAP J5 #1/#2/#3)", () => {
  const BOX_RESPONSE = {
    n_groups: 2,
    boxes: [
      { label: "grp = 0", q1: 10, median: 12, q3: 14, iqr: 4, whislo: 10, whishi: 114, mean: 62, sem: 20, ci_lo: 10, ci_hi: 114, n: 6, fliers: [], whis: 1.5 },
      { label: "grp = 1", q1: 30, median: 32, q3: 34, iqr: 4, whislo: 30, whishi: 134, mean: 82, sem: 20, ci_lo: 30, ci_hi: 134, n: 6, fliers: [], whis: 1.5 },
    ],
  };

  it("box mode with showPoints=false: points is null (default off)", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    await waitFor(() => expect(result.current.draw).not.toBeNull());
    expect(result.current.draw?.mode).toBe("box");
    if (result.current.draw?.mode === "box") {
      expect(result.current.draw.points).toBeNull();
      expect(result.current.draw.showMeanCI).toBe(false);
    }
  });

  it("box mode with showPoints=true: points carries each group's ORIGINAL row indices", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setShowPoints(true));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "box" && d.points).toBeTruthy();
    });
    const d = result.current.draw;
    if (d?.mode === "box") {
      expect(d.points).toHaveLength(2);
      // level 0 = rows 0,1,2 (fac=0) + 6,7,8 (fac=1); level 1 = rows 3,4,5,9,10,11.
      expect(d.points?.[0].points.map((p) => p.rowIndex)).toEqual([0, 1, 2, 6, 7, 8]);
      expect(d.points?.[1].points.map((p) => p.rowIndex)).toEqual([3, 4, 5, 9, 10, 11]);
    } else {
      throw new Error("expected a box draw");
    }
  });

  it("box mode with showMeanCI=true carries the flag through to the draw", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setShowMeanCI(true));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "box" && d.showMeanCI).toBe(true);
    });
  });

  it("strip mode: always resolves points (no toggle needed) and reuses statsBox for mean/CI", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setMode("strip"));
    await waitFor(() => expect(result.current.draw?.mode).toBe("strip"));
    const d = result.current.draw;
    if (d?.mode === "strip") {
      expect(d.points).toHaveLength(2);
      expect(d.points[0].points.map((p) => p.rowIndex)).toEqual([0, 1, 2, 6, 7, 8]);
      expect(d.boxes).toEqual(BOX_RESPONSE.boxes);
    } else {
      throw new Error("expected a strip draw");
    }
  });

  it("strip mode degrades to the client-side box-stats fallback on a backend failure", async () => {
    vi.mocked(statsBox).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setMode("strip"));
    await waitFor(() => expect(result.current.draw?.mode).toBe("strip"));
    expect(result.current.note).toBe("backend unavailable — computed locally");
    const d = result.current.draw;
    if (d?.mode === "strip") {
      expect(d.boxes[0].median).toBe(62); // real client math on [10,12,14,110,112,114]
    } else {
      throw new Error("expected a strip draw");
    }
  });

  it("exportFigure (box, showPoints+showMeanCI on) sends show_points/point_row_indices/show_mean_ci", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setShowPoints(true));
    act(() => result.current.setShowMeanCI(true));
    await waitFor(() => expect(result.current.draw).not.toBeNull());

    await act(async () => {
      await result.current.exportFigure("pdf");
    });

    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.kind).toBe("box");
    expect(spec.show_points).toBe(true);
    expect(spec.show_mean_ci).toBe(true);
    expect(spec.point_row_indices).toEqual([
      [0, 1, 2, 6, 7, 8],
      [3, 4, 5, 9, 10, 11],
    ]);
  });

  it("exportFigure (box, marks off) sends show_points=false and point_row_indices=null", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    await waitFor(() => expect(result.current.draw).not.toBeNull());

    await act(async () => {
      await result.current.exportFigure("pdf");
    });

    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.show_points).toBe(false);
    expect(spec.show_mean_ci).toBe(false);
    expect(spec.point_row_indices).toBeNull();
  });

  it("exportFigure (strip) always sends show_points=true, regardless of the box-only toggle state", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setMode("strip"));
    await waitFor(() => expect(result.current.draw?.mode).toBe("strip"));

    await act(async () => {
      await result.current.exportFigure("svg");
    });

    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.kind).toBe("strip");
    expect(spec.show_points).toBe(true);
    expect(spec.point_row_indices).toEqual([
      [0, 1, 2, 6, 7, 8],
      [3, 4, 5, 9, 10, 11],
    ]);
  });
});

describe("useStatStage — connect-means line (JMP_GAP J5 residual)", () => {
  const BOX_RESPONSE = {
    n_groups: 2,
    boxes: [
      { label: "grp = 0", q1: 10, median: 12, q3: 14, iqr: 4, whislo: 10, whishi: 114, mean: 62, sem: 20, ci_lo: 10, ci_hi: 114, n: 6, fliers: [], whis: 1.5 },
      { label: "grp = 1", q1: 30, median: 32, q3: 34, iqr: 4, whislo: 30, whishi: 134, mean: 82, sem: 20, ci_lo: 30, ci_hi: 134, n: 6, fliers: [], whis: 1.5 },
    ],
  };

  it("box mode with showConnectMeans=false: connectMeans is false on the draw (default off)", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    await waitFor(() => expect(result.current.draw).not.toBeNull());
    const d = result.current.draw;
    expect(d?.mode === "box" && d.connectMeans).toBe(false);
  });

  it("box mode with a group column active + showConnectMeans=true carries the flag through", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    expect(result.current.groupCol).toBe(0); // default categorical column auto-picked
    act(() => result.current.setShowConnectMeans(true));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "box" && d.connectMeans).toBe(true);
    });
  });

  it("forces connectMeans off under the per-plotted-channel fallback (groupCol null), even if toggled on", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setShowConnectMeans(true));
    act(() => result.current.setGroupCol(null));
    await waitFor(() => expect(result.current.draw).not.toBeNull());
    const d = result.current.draw;
    expect(d?.mode === "box" && d.connectMeans).toBe(false);
  });

  it("strip mode with a group column active + showConnectMeans=true carries the flag through", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setMode("strip"));
    act(() => result.current.setShowConnectMeans(true));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "strip" && d.connectMeans).toBe(true);
    });
  });

  it("exportFigure sends show_connect_means only when a group column is active", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setShowConnectMeans(true));
    await waitFor(() => expect(result.current.draw).not.toBeNull());

    await act(async () => {
      await result.current.exportFigure("pdf");
    });

    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.show_connect_means).toBe(true);
  });

  it("exportFigure omits show_connect_means (false) under the per-plotted-channel fallback", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setShowConnectMeans(true));
    act(() => result.current.setGroupCol(null));
    await waitFor(() => expect(result.current.draw).not.toBeNull());

    await act(async () => {
      await result.current.exportFigure("pdf");
    });

    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.show_connect_means).toBe(false);
  });
});

describe("useStatStage — faceting (GUI_INTERACTION #11)", () => {
  it("faceted box: drawFacets has one draw per finite facet level; the flat draw stays null", async () => {
    vi.mocked(statsBox).mockImplementation(async (groups, labels) => ({
      n_groups: groups.length,
      boxes: groups.map((g, i) => ({
        label: labels?.[i] ?? "",
        q1: 1,
        median: 2,
        q3: 3,
        iqr: 2,
        whislo: 0,
        whishi: 4,
        mean: 2,
        n: g.length,
        fliers: [],
        whis: 1.5,
      })),
    }));
    const { result } = renderHook(() => useStatStage(baseParams()));
    // Defaults: mode="box", groupCol=0 (grp), valueCol=1 (y) — auto-derived
    // on mount by the active-dataset-change effect.
    act(() => result.current.setFacetCol(2));
    await waitFor(() => expect(result.current.drawFacets).not.toBeNull());
    expect(result.current.draw).toBeNull();
    expect(result.current.drawFacets).toHaveLength(2); // levels "0"/"1"; "2" dropped
    expect(result.current.drawFacets?.map((f) => f.label)).toEqual(["0", "1"]);
    expect(result.current.drawFacets?.every((f) => f.draw.mode === "box")).toBe(true);
    expect(result.current.error).toBeNull();
    // GUI_INTERACTION #12 slice 4b: each box facet carries its raw finite
    // groups alongside the computed draw — exportFigure rebuilds a faithful
    // per-facet request from these (matplotlib recomputes its own stats, so
    // export can't reuse `draw.boxes` the way bar facets reuse `draw.data`).
    expect(result.current.drawFacets?.[0].rawGroups?.map((g) => g.label)).toEqual(["grp = 0", "grp = 1"]);
    // A null flat `draw` while `drawFacets` holds the small multiples is
    // still the "no flat panel to export" signal — StatStage.tsx's Export
    // button now ALSO checks `drawFacets` (slice 4b), so this no longer
    // disables Export outright, just routes it to the faceted path.
    expect(result.current.draw).toBeNull();
  });

  it("faceted violin: a per-slice backend failure degrades that slice to real client box stats", async () => {
    vi.mocked(statsViolin).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setMode("violin"));
    act(() => result.current.setFacetCol(2));
    await waitFor(() => expect(result.current.drawFacets).not.toBeNull());
    expect(result.current.drawFacets).toHaveLength(2);
    // Never fabricate a KDE offline — every slice degrades to box.
    expect(result.current.drawFacets?.every((f) => f.draw.mode === "box")).toBe(true);
    // Real client-side math on the level-"0" slice's grp=0 group ([10,12,14]).
    const firstDraw = result.current.drawFacets?.[0].draw;
    if (firstDraw?.mode === "box") {
      expect(firstDraw.boxes[0].median).toBe(12);
    } else {
      throw new Error("expected a box draw");
    }
    // GUI_INTERACTION #12 slice 4b: this IS the per-slice mode-fidelity case
    // exportFigure must honor — every facet's `draw.mode` reads "box" (the
    // degrade), so a faceted export sends `kind: "box"` per facet, never a
    // fresh violin recompute for a slice that failed on screen.
    expect(result.current.drawFacets?.every((f) => f.rawGroups && f.rawGroups.length > 0)).toBe(true);
  });

  it("bar facets synchronously (no backend round-trip) and drops the empty level", async () => {
    const { result } = renderHook(() => useStatStage(baseParams()));
    // Discard the mount's OWN flat box-mode call (default mode="box" always
    // fires one on mount, unrelated to this test) — everything asserted below
    // is about the bar+facet switch specifically.
    vi.mocked(statsBox).mockClear();
    act(() => result.current.setMode("bar"));
    act(() => result.current.setFacetCol(2));
    await waitFor(() => expect(result.current.drawFacets).not.toBeNull());
    expect(result.current.drawFacets).toHaveLength(2);
    expect(result.current.drawFacets?.every((f) => f.draw.mode === "bar")).toBe(true);
    expect(statsBox).not.toHaveBeenCalled();
  });

  it("all facet levels dropping → drawFacets null with the empty-groups error", async () => {
    // Force the VALUE column entirely non-finite (y=NaN dataset-wide) so
    // every facet slice groups to nothing, regardless of the facet column.
    // (Not the GROUP column: since BUG-004's fix, an all-NaN group column no
    // longer classifies as categorical, so it would just get masked to the
    // per-plotted-channel fallback instead of forcing a "no data" edge case —
    // that fallback still has finite y values here, so it would no longer
    // error. Emptying the VALUE column instead forces the same zero-groups
    // outcome without relying on a groupCol the real picker could never
    // offer in the first place.)
    const empty: DataStruct = { ...DATA, values: DATA.values.map((r) => [r[0], NaN, r[2]]) };
    const emptyDs: Dataset = { id: "empty", name: "empty.dat", data: empty };
    const { result } = renderHook(() => useStatStage(baseParams({ active: emptyDs })));
    expect(result.current.groupCol).toBe(0); // "grp" — still genuinely categorical
    act(() => result.current.setFacetCol(2));
    await waitFor(() => expect(result.current.error).toBe("no finite values to group"));
    expect(result.current.drawFacets).toBeNull();
    expect(result.current.draw).toBeNull();
  });

  it("facetCol resets to null when the active dataset changes", () => {
    const { result, rerender } = renderHook((p: UseStatStageParams) => useStatStage(p), {
      initialProps: baseParams(),
    });
    act(() => result.current.setFacetCol(2));
    expect(result.current.facetCol).toBe(2);
    const DS2: Dataset = { id: "d2", name: "other.dat", data: DATA };
    rerender(baseParams({ active: DS2 }));
    expect(result.current.facetCol).toBeNull();
  });

  it("a Graph Builder seed with facetCol seeds the picker and is consumed once", () => {
    const seed: StatStageSeed = { mode: "box", groupCol: 0, valueCol: 1, facetCol: 2 };
    const onSeedConsumed = vi.fn();
    const { result } = renderHook(() => useStatStage(baseParams({ seed, onSeedConsumed })));
    expect(result.current.facetCol).toBe(2);
    expect(result.current.mode).toBe("box");
    expect(onSeedConsumed).toHaveBeenCalledTimes(1);
  });

  it("a seed with no facetCol leaves the picker unfaceted", () => {
    const seed: StatStageSeed = { mode: "box", groupCol: 0, valueCol: 1 };
    const { result } = renderHook(() => useStatStage(baseParams({ seed })));
    expect(result.current.facetCol).toBeNull();
    expect(result.current.drawFacets).toBeNull();
  });

  it("switching facetCol back to null returns to the flat single-panel draw", async () => {
    vi.mocked(statsBox).mockResolvedValue({
      n_groups: 2,
      boxes: [
        { label: "grp = 0", q1: 1, median: 2, q3: 3, iqr: 2, whislo: 0, whishi: 4, mean: 2, n: 6, fliers: [], whis: 1.5 },
        { label: "grp = 1", q1: 1, median: 2, q3: 3, iqr: 2, whislo: 0, whishi: 4, mean: 2, n: 6, fliers: [], whis: 1.5 },
      ],
    });
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setFacetCol(2));
    await waitFor(() => expect(result.current.drawFacets).not.toBeNull());
    act(() => result.current.setFacetCol(null));
    await waitFor(() => expect(result.current.draw).not.toBeNull());
    expect(result.current.drawFacets).toBeNull();
  });
});

describe("useStatStage — stale channelTypes override on groupCol/facetCol (BUG-004)", () => {
  const BOX_RESPONSE = {
    n_groups: 2,
    boxes: [
      { label: "grp = 0", q1: 10, median: 12, q3: 14, iqr: 4, whislo: 10, whishi: 114, mean: 62, n: 6, fliers: [], whis: 1.5 },
      { label: "grp = 1", q1: 30, median: 32, q3: 34, iqr: 4, whislo: 30, whishi: 134, mean: 82, n: 6, fliers: [], whis: 1.5 },
    ],
  };

  it("de-categorizing the picked groupCol masks the picker AND stops the grouping math from using it", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result, rerender } = renderHook((p: UseStatStageParams) => useStatStage(p), {
      initialProps: baseParams(),
    });

    // Default pick: "grp" (channel 0) auto-selected as groupCol since it
    // reads as categorical (2 levels, 12 finite samples).
    expect(result.current.groupCol).toBe(0);
    expect(result.current.categoricalCols.map((c) => c.index)).toContain(0);
    await waitFor(() => expect(result.current.draw).not.toBeNull());
    const callsBefore = vi.mocked(statsBox).mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);
    expect(vi.mocked(statsBox).mock.calls.at(-1)?.[1]).toEqual(["grp = 0", "grp = 1"]);

    // setChannelType(id, 0, "continuous") in store/useApp.ts spreads the
    // dataset with a new channelTypes map — same object-identity-changing
    // shape reproduced here directly against the params-based hook. The
    // dataset's own id is unchanged, so the active-id reset effect does
    // NOT fire; groupCol's raw state is never touched by setChannelType.
    const overridden: Dataset = { ...DS, channelTypes: { 0: "continuous" } };
    rerender(baseParams({ active: overridden }));

    // The column no longer classifies as categorical...
    expect(result.current.categoricalCols.map((c) => c.index)).not.toContain(0);
    // ...and the picker's exposed value is masked to null (matches the
    // "(per channel)" option actually rendered), not left as a stale "0"
    // with no corresponding <option> in the <select> — the analogue of
    // BUG-003's Data Filter finding, applied to Stat Stage's groupCol.
    expect(result.current.groupCol).toBeNull();

    // The actual box-grouping math also stopped partitioning by column 0 —
    // it now uses the per-plotted-channel fallback, not a silent continued
    // group-by on a column the toolbar shows as unselected (unlike Data
    // Filter's row-filtering, Stat Stage's groupCol has exactly one
    // consumer — this hook — so display and computation can't disagree).
    await waitFor(() => expect(vi.mocked(statsBox).mock.calls.length).toBeGreaterThan(callsBefore));
    const lastLabels = vi.mocked(statsBox).mock.calls.at(-1)?.[1];
    expect(lastLabels).not.toEqual(["grp = 0", "grp = 1"]);
  });

  it("reverting the override brings the exact same groupCol pick back (raw state was never cleared)", async () => {
    vi.mocked(statsBox).mockResolvedValue(BOX_RESPONSE);
    const { result, rerender } = renderHook((p: UseStatStageParams) => useStatStage(p), {
      initialProps: baseParams(),
    });
    expect(result.current.groupCol).toBe(0);

    const overridden: Dataset = { ...DS, channelTypes: { 0: "continuous" } };
    rerender(baseParams({ active: overridden }));
    expect(result.current.groupCol).toBeNull();

    // Same dataset id, override cleared — this is NOT a fresh dataset, so
    // the active-id reset effect still doesn't fire; the pick must come
    // back from the raw state the mask hid, not from a re-derived default.
    rerender(baseParams({ active: DS }));
    expect(result.current.groupCol).toBe(0);
  });

  // REVIEW ROUND — this test asserted the OPPOSITE, and the behaviour it pinned
  // was a regression I introduced. facetCol must NOT be masked: unlike groupCol,
  // `useGraphBuilder` seeds it from `spec.zones.facet?.channel` with no
  // categorical gate, and `facetSlices` has no categorical gate either, so a
  // non-categorical facet is a SUPPORTED configuration Graph Builder produces
  // deliberately and announces as "faceted by <label>". Masking it turned a
  // working faceted plot into a single unfaceted panel while the status line
  // still claimed otherwise.
  it("a non-categorical facetCol SURVIVES — faceting is not restricted to categorical columns", () => {
    const { result, rerender } = renderHook((p: UseStatStageParams) => useStatStage(p), {
      initialProps: baseParams(),
    });
    act(() => result.current.setFacetCol(2));
    expect(result.current.facetCol).toBe(2);

    const overridden: Dataset = { ...DS, channelTypes: { 2: "continuous" } };
    rerender(baseParams({ active: overridden }));

    expect(result.current.categoricalCols.map((c) => c.index)).not.toContain(2);
    expect(result.current.facetCol).toBe(2); // kept, not masked
  });

  it("a Graph Builder seed faceting on a NON-categorical column still facets", () => {
    const nonCategorical: Dataset = { ...DS, channelTypes: { 2: "continuous" } };
    const seed: StatStageSeed = { mode: "box", groupCol: 0, valueCol: 1, facetCol: 2 };
    const { result } = renderHook((p: UseStatStageParams) => useStatStage(p), {
      initialProps: baseParams({ active: nonCategorical, seed }),
    });
    // Graph Builder's status line promises "faceted by <label>"; the stage must
    // deliver it rather than silently rendering one unfaceted panel.
    expect(result.current.facetCol).toBe(2);
  });
});

describe("useStatStage — faceted export (GUI_INTERACTION #12 slice 4b)", () => {
  it("box: exportFigure sends one facets[] entry per level, each with its raw finite groups + labels", async () => {
    vi.mocked(statsBox).mockResolvedValue({
      n_groups: 2,
      boxes: [
        { label: "grp = 0", q1: 1, median: 2, q3: 3, iqr: 2, whislo: 0, whishi: 4, mean: 2, n: 6, fliers: [], whis: 1.5 },
        { label: "grp = 1", q1: 1, median: 2, q3: 3, iqr: 2, whislo: 0, whishi: 4, mean: 2, n: 6, fliers: [], whis: 1.5 },
      ],
    });
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setFacetCol(2));
    await waitFor(() => expect(result.current.drawFacets).not.toBeNull());

    await act(async () => {
      await result.current.exportFigure("pdf");
    });

    expect(exportStatplotFigure).toHaveBeenCalledTimes(1);
    expect(exportCategoricalFigure).not.toHaveBeenCalled();
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.kind).toBe("box");
    expect(spec.fmt).toBe("pdf");
    expect(spec.facets).toHaveLength(2);
    expect(spec.facets?.[0]).toMatchObject({
      label: "0",
      kind: "box",
      data: [[10, 12, 14], [30, 32, 34]],
      labels: ["grp = 0", "grp = 1"],
    });
    expect(spec.facets?.[1].label).toBe("1");
  });

  it("violin: a per-facet kind carries each slice's OWN resolved mode, not a uniform re-request (per-slice degrade fidelity)", async () => {
    // grp=0's slice degrades (statsViolin throws); grp=1's slice succeeds —
    // a mixed grid, exactly the case exportFigure must reproduce faithfully.
    vi.mocked(statsViolin).mockImplementation(async (values) => {
      if (values.includes(10)) throw new Error("boom"); // the grp=0 slice's first group
      return { x: [0, 1], density: [0.1, 0.2], bandwidth: 0.5, quartiles: [1, 2, 3], n: values.length };
    });
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setMode("violin"));
    act(() => result.current.setFacetCol(2));
    await waitFor(() => expect(result.current.drawFacets).not.toBeNull());
    expect(result.current.drawFacets?.[0].draw.mode).toBe("box"); // degraded
    expect(result.current.drawFacets?.[1].draw.mode).toBe("violin"); // succeeded

    await act(async () => {
      await result.current.exportFigure("svg");
    });

    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.kind).toBe("violin"); // the top-level requested mode
    expect(spec.facets?.[0].kind).toBe("box"); // per-facet override: this slice degraded
    expect(spec.facets?.[1].kind).toBe("violin"); // this slice succeeded
  });

  it("bar: exportFigure reuses each facet's already-computed matrix (no re-derivation)", async () => {
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setMode("bar"));
    act(() => result.current.setFacetCol(2));
    await waitFor(() => expect(result.current.drawFacets).not.toBeNull());

    await act(async () => {
      await result.current.exportFigure("png");
    });

    expect(exportCategoricalFigure).toHaveBeenCalledTimes(1);
    expect(exportStatplotFigure).not.toHaveBeenCalled();
    const spec = vi.mocked(exportCategoricalFigure).mock.calls[0][0];
    expect(spec.fmt).toBe("png");
    expect(spec.facets).toHaveLength(2);
    expect(spec.facets?.map((f) => f.label)).toEqual(["0", "1"]);
    expect(spec.facets?.[0].series).toEqual(spec.series); // consistent series across facets
  });

  it("qq/histogram never facet, so exportFigure always takes the flat path even with a facetCol set on a prior mode", async () => {
    vi.mocked(statsBox).mockResolvedValue({
      n_groups: 2,
      boxes: [
        { label: "grp = 0", q1: 1, median: 2, q3: 3, iqr: 2, whislo: 0, whishi: 4, mean: 2, n: 6, fliers: [], whis: 1.5 },
        { label: "grp = 1", q1: 1, median: 2, q3: 3, iqr: 2, whislo: 0, whishi: 4, mean: 2, n: 6, fliers: [], whis: 1.5 },
      ],
    });
    const { result } = renderHook(() => useStatStage(baseParams()));
    act(() => result.current.setFacetCol(2)); // box mode facets
    await waitFor(() => expect(result.current.drawFacets).not.toBeNull());
    act(() => result.current.setMode("qq")); // qq never facets — drawFacets clears
    await waitFor(() => expect(result.current.drawFacets).toBeNull());

    await act(async () => {
      await result.current.exportFigure("pdf");
    });

    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.kind).toBe("qq");
    expect(spec.facets).toBeUndefined();
  });
});

// ── Nested (two-factor) grouping, Group R ──────────────────────────────────
// PRIMARY_SOFTWARE_AUDIT_PLAN.md:1143, "lot/wafer/type can form nested
// grouping for a box plot". The level STRUCTURE and its order are pinned in
// lib/nestedLevels.test.ts and lib/statschooser.test.ts, and the mask/resolver
// rules in lib/statstage.test.ts; what is asserted HERE is only what those
// cannot see — that the hook actually reaches them, in the right modes, with
// the right column, and says so on its axis.

// lot (ch0) x wafer (ch2), faceted by site (ch3), thickness (ch1) the value.
// Full 2x2x2 crossing with 16 finite rows per categorical column, which is
// what lib/modeling needs to infer nominal.
const NEST_DATA: DataStruct = {
  time: Array.from({ length: 16 }, (_, i) => i),
  values: [
    [0, 10, 0, 0], [0, 11, 0, 1], [0, 12, 1, 0], [0, 13, 1, 1],
    [0, 14, 0, 0], [0, 15, 0, 1], [0, 16, 1, 0], [0, 17, 1, 1],
    [1, 20, 0, 0], [1, 21, 0, 1], [1, 22, 1, 0], [1, 23, 1, 1],
    [1, 24, 0, 0], [1, 25, 0, 1], [1, 26, 1, 0], [1, 27, 1, 1],
  ],
  labels: ["lot", "thickness", "wafer", "site"],
  units: ["", "nm", "", ""],
  metadata: {},
};
const NEST_DS: Dataset = { id: "n1", name: "wafers.dat", data: NEST_DATA };

/** The group-axis label of the current draw, or null. `StatDrawData` is a
 *  discriminated union and `groupLabel` is only on the grouped variants
 *  (box/violin/strip/bar), so the narrowing is done once here rather than
 *  reaching through `draw?.groupLabel`, which does not typecheck. */
const axisLabel = (d: StatDrawData | null): string | null =>
  d && (d.mode === "box" || d.mode === "violin" || d.mode === "strip" || d.mode === "bar")
    ? d.groupLabel
    : null;

/** The `(values, labels)` of the most recent `statsBox` call. */
const lastBoxCall = () => {
  const calls = vi.mocked(statsBox).mock.calls;
  const [values, labels] = calls[calls.length - 1] as [number[][], string[]];
  return { values, labels };
};

describe("useStatStage — nested second factor (Group R)", () => {
  const nestParams = () => baseParams({ active: NEST_DS });

  it("box: a picked second factor splits each level into (A, B) cells", async () => {
    vi.mocked(statsBox).mockResolvedValue({ n_groups: 4, boxes: [] });
    const { result } = renderHook(() => useStatStage(nestParams()));
    // Defaults: group by lot (the first categorical channel), value thickness.
    await waitFor(() => expect(result.current.groupCol).toBe(0));
    expect(lastBoxCall().labels).toEqual(["lot = 0", "lot = 1"]);

    act(() => result.current.setGroup2Col(2));

    await waitFor(() => expect(lastBoxCall().labels).toHaveLength(4));
    const { values, labels } = lastBoxCall();
    expect(labels).toEqual([
      "lot = 0 / wafer = 0",
      "lot = 0 / wafer = 1",
      "lot = 1 / wafer = 0",
      "lot = 1 / wafer = 1",
    ]);
    // lot 0 / wafer 0 is rows 0,1,4,5 — the SITE column plays no part in a
    // nest by lot x wafer, which is why the raw values are listed here.
    expect(values).toEqual([
      [10, 11, 14, 15], [12, 13, 16, 17], [20, 21, 24, 25], [22, 23, 26, 27],
    ]);
  });

  it("names BOTH factors on the group axis, in the tick labels' own order", async () => {
    // `statschooser.nestedLabel` writes ticks as `lot = 0 / wafer = 1`, so an
    // axis reading anything but "lot / wafer" contradicts the ticks under it.
    vi.mocked(statsBox).mockResolvedValue({ n_groups: 4, boxes: [] });
    const { result } = renderHook(() => useStatStage(nestParams()));
    await waitFor(() => expect(axisLabel(result.current.draw)).toBe("lot"));

    act(() => result.current.setGroup2Col(2));

    await waitFor(() => expect(axisLabel(result.current.draw)).toBe("lot / wafer"));
  });

  it("strip nests too, and its POINTS keep their original row indices", async () => {
    // The jitter overlay is drawn into the slots the box stats produced, so
    // the indexed resolve has to nest identically or points land on the wrong
    // box.
    vi.mocked(statsBox).mockResolvedValue({ n_groups: 4, boxes: [] });
    const { result } = renderHook(() => useStatStage(nestParams()));
    act(() => result.current.setMode("strip"));
    act(() => result.current.setGroup2Col(2));

    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "strip" && d.points).toHaveLength(4);
    });
    const d = result.current.draw;
    if (d?.mode !== "strip") throw new Error("expected a strip draw");
    expect(d.points.map((g) => g.points.map((pt) => pt.rowIndex))).toEqual([
      [0, 1, 4, 5], [2, 3, 6, 7], [8, 9, 12, 13], [10, 11, 14, 15],
    ]);
  });

  it("BAR ignores it — the pick survives, but nothing about the plot nests", async () => {
    // Bar builds a category x series MATRIX whose slots come from one column,
    // so a second factor is inert there. Both halves matter: the axis must not
    // claim a nesting the plot does not have, and the pick must not be lost
    // (the toolbar hides the picker in Bar rather than emptying it).
    const { result } = renderHook(() => useStatStage(nestParams()));
    act(() => result.current.setGroup2Col(2));
    act(() => result.current.setMode("bar"));

    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    const d = result.current.draw;
    if (d?.mode !== "bar") throw new Error("expected a bar draw");
    expect(d.groupLabel).toBe("lot");
    // Bar's category labels are bare levels (`lib/barlayout.buildBarMatrix`
    // names the column on the axis instead), unlike box's `lot = 0` ticks —
    // a pre-existing convention difference, not something nesting introduced.
    expect(d.data.groups.map((g) => g.label)).toEqual(["0", "1"]);
    expect(result.current.group2Col).toBe(2);

    // ...and switching back to box nests again, from the same held pick.
    vi.mocked(statsBox).mockResolvedValue({ n_groups: 4, boxes: [] });
    act(() => result.current.setMode("box"));
    await waitFor(() => expect(axisLabel(result.current.draw)).toBe("lot / wafer"));
  });

  it("each FACET panel nests too, not just the flat one", async () => {
    // A facet that silently collapsed the nesting would contradict its own
    // axis label, which names both factors — `computeFacetGroupDraws` takes
    // the second factor for exactly this reason.
    vi.mocked(statsBox).mockResolvedValue({ n_groups: 4, boxes: [] });
    const { result } = renderHook(() => useStatStage(nestParams()));
    act(() => result.current.setFacetCol(3));
    act(() => result.current.setGroup2Col(2));

    await waitFor(() => expect(result.current.drawFacets).toHaveLength(2));
    const facets = result.current.drawFacets ?? [];
    // `lib/facet.facetSlices` names a slice by its bare level, same as bar.
    expect(facets.map((f) => f.label)).toEqual(["0", "1"]);
    // site = 0 is the even rows: lot 0 gives 10,14 / 12,16; lot 1 gives 20,24 / 22,26.
    expect(facets[0].rawGroups?.map((g) => g.label)).toEqual([
      "lot = 0 / wafer = 0",
      "lot = 0 / wafer = 1",
      "lot = 1 / wafer = 0",
      "lot = 1 / wafer = 1",
    ]);
    expect(facets[0].rawGroups?.map((g) => g.values)).toEqual([
      [10, 14], [12, 16], [20, 24], [22, 26],
    ]);
    // and the odd rows in the other panel, so the slice really did bite.
    expect(facets[1].rawGroups?.map((g) => g.values)).toEqual([
      [11, 15], [13, 17], [21, 25], [23, 27],
    ]);
  });

  it("EXPORT sends the nested boxes, pre-aggregated with their composite labels", async () => {
    // routes/export_statplots takes `data: number[][]` + `labels`, so nesting
    // needs no wire change — but only if the spec is built from the nested
    // groups. Asserted because "no backend change needed" is a claim.
    vi.mocked(statsBox).mockResolvedValue({ n_groups: 4, boxes: [] });
    const { result } = renderHook(() => useStatStage(nestParams()));
    act(() => result.current.setGroup2Col(2));
    await waitFor(() => expect(axisLabel(result.current.draw)).toBe("lot / wafer"));

    await act(async () => {
      await result.current.exportFigure("pdf");
    });

    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0] as {
      labels: string[]; data: number[][]; x_label: string;
    };
    expect(spec.labels).toEqual([
      "lot = 0 / wafer = 0",
      "lot = 0 / wafer = 1",
      "lot = 1 / wafer = 0",
      "lot = 1 / wafer = 1",
    ]);
    expect(spec.data).toEqual([
      [10, 11, 14, 15], [12, 13, 16, 17], [20, 21, 24, 25], [22, 23, 26, 27],
    ]);
    expect(spec.x_label).toBe("lot / wafer");
  });

  it("a Graph Builder seed CLEARS a previously picked nest", async () => {
    // A StatStageSeed fully specifies its grouping and carries no second
    // factor. Leaving one in place would split the sent plot by a column the
    // sender never mentioned — and the sender's own status line would not
    // mention it either.
    vi.mocked(statsBox).mockResolvedValue({ n_groups: 4, boxes: [] });
    const seed: StatStageSeed = { mode: "box", groupCol: 0, valueCol: 1 };
    const { result, rerender } = renderHook((p: UseStatStageParams) => useStatStage(p), {
      initialProps: nestParams(),
    });
    act(() => result.current.setGroup2Col(2));
    await waitFor(() => expect(result.current.group2Col).toBe(2));

    rerender(baseParams({ active: NEST_DS, seed }));

    await waitFor(() => expect(result.current.group2Col).toBeNull());
    await waitFor(() => expect(lastBoxCall().labels).toEqual(["lot = 0", "lot = 1"]));
  });

  it("resets to null when the active dataset changes", () => {
    // Same reason groupCol/facetCol reset: a channel index from the PREVIOUS
    // dataset names a different column here, so it would silently mis-group.
    const { result, rerender } = renderHook((p: UseStatStageParams) => useStatStage(p), {
      initialProps: nestParams(),
    });
    act(() => result.current.setGroup2Col(2));
    expect(result.current.group2Col).toBe(2);

    rerender(baseParams({ active: { ...NEST_DS, id: "n2" } }));

    expect(result.current.group2Col).toBeNull();
  });
});
