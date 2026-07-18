import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox, statsViolin } from "../../lib/api";
import type { DataStruct, Dataset } from "../../lib/types";
import type { StatStageSeed } from "../../store/useApp";
import { useStatStage, type UseStatStageParams } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
  statsViolin: vi.fn(),
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
    expect(result.current.note).toContain("faceted view");
    expect(result.current.error).toBeNull();
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
    expect(result.current.note).toContain("faceted view");
    // Real client-side math on the level-"0" slice's grp=0 group ([10,12,14]).
    const firstDraw = result.current.drawFacets?.[0].draw;
    if (firstDraw?.mode === "box") {
      expect(firstDraw.boxes[0].median).toBe(12);
    } else {
      throw new Error("expected a box draw");
    }
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
    // Force the GROUP column entirely non-finite (grp=NaN dataset-wide) so
    // every facet slice groups to nothing, regardless of the facet column.
    const empty: DataStruct = { ...DATA, values: DATA.values.map((r) => [NaN, r[1], r[2]]) };
    const emptyDs: Dataset = { id: "empty", name: "empty.dat", data: empty };
    const { result } = renderHook(() => useStatStage(baseParams({ active: emptyDs })));
    act(() => result.current.setGroupCol(0));
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
