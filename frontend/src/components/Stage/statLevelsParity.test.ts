// P2.6 box 2 — interactive <-> export PARITY for missing levels and unbalanced
// groups, the A8 pattern (`lib/figureSpec.a8.test.ts` +
// `tests/test_export_vector_structure.py`) applied to the Stat Stage.
//
// This is the FRONTEND half. It drives the real hook on a fixture with every
// kind of missing level — a declared level no row uses, a level whose values
// are all NaN, a level whose rows are all excluded — plus a small, unbalanced
// group, and asserts two things:
//   1. what the SCREEN draws (the decorated draw's slots, their n, the notice)
//      and what the EXPORT sends (labels, per-slot data, show_n, caveat)
//      describe the same axis, slot for slot;
//   2. the export spec is byte-for-byte the committed wire fixture
//      `tests/fixtures/wire/statplot_levels_export.json`.
// The BACKEND half (`tests/test_statplot_levels_parity.py`) posts that same
// fixture to the real route and reads the SVG back: the same tick labels in
// the same order, an `n=0` marker per empty slot, `n=K` per slot, and the
// caveat footnote. A drift on either side breaks one of the two.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import { exportCategoricalFigure, exportStatplotFigure } from "../../lib/api/figures";
import type { DataStruct, Dataset } from "../../lib/types";
import { useStatStage } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
}));
vi.mock("../../lib/api/figures", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api/figures")>()),
  exportStatplotFigure: vi.fn(),
  exportCategoricalFigure: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "../../../../tests/fixtures/wire/statplot_levels_export.json");

// grp declares A..E. A: 12 rows. B: 2 rows (small, and 2/12 < 0.2 unbalanced).
// C: declared, no rows. D: 2 rows, value NaN. E: 2 rows, both EXCLUDED.
const A = Array.from({ length: 12 }, (_, i) => [0, i + 1]);
const DATA: DataStruct = {
  time: Array.from({ length: 18 }, (_, i) => i),
  values: [...A, [1, 10], [1, 12], [3, Number.NaN], [3, Number.NaN], [4, 20], [4, 21]],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C", "D", "E"] },
};
const DS: Dataset = { id: "parity", name: "parity.csv", data: DATA, excludedRows: [16, 17] };
// Hoisted: a fresh array per render would re-trigger the hook's compute effect forever.
const Y_KEYS = [1];

beforeEach(() => {
  vi.resetAllMocks();
  // Offline: the client box-stats fallback, so no backend is needed.
  vi.mocked(statsBox).mockRejectedValue(new Error("offline"));
  vi.mocked(exportStatplotFigure).mockResolvedValue(undefined);
  vi.mocked(exportCategoricalFigure).mockResolvedValue(undefined);
});

describe("Stat Stage missing levels — screen and export describe the same axis", () => {
  it("box + points + mean-CI: slots, n, empties and caveat agree, and match the wire fixture", async () => {
    const { result } = renderHook(() =>
      useStatStage({ active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} }),
    );
    act(() => result.current.setShowPoints(true));
    act(() => result.current.setShowMeanCI(true));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "box" && d.points != null && d.slots != null).toBe(true);
    });
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    const draw = result.current.draw;
    if (draw?.mode !== "box" || !draw.slots) throw new Error("expected a slotted box draw");

    // (1) Screen <-> export, slot for slot.
    expect(spec.labels).toEqual(draw.slots.map((s) => s.label));
    const data = spec.data as number[][];
    expect(data.map((g) => g.length)).toEqual(
      draw.slots.map((s) => (s.group === null ? 0 : draw.boxes[s.group].n)),
    );
    expect(draw.slots.map((s) => s.group === null)).toEqual(data.map((g) => g.length === 0));
    expect(spec.show_n).toBe(draw.showN);
    expect(spec.caveat).toBe(result.current.groupNotice?.caveat);
    expect(spec.caveat).not.toBeNull();

    // (2) The committed wire fixture the backend half renders.
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf-8")) as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify(spec))).toEqual(fixture);
  });

  it("the notice explains every missing level per level, in its tooltip", async () => {
    const { result } = renderHook(() =>
      useStatStage({ active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} }),
    );
    await waitFor(() => expect(result.current.groupNotice).not.toBeNull());
    expect(result.current.groupNotice?.line).toBe(
      "Caveat: n < 3 in 1 group; unbalanced groups (n 2-12) · 3 empty levels (n=0) · " +
        "4 rows dropped (2 non-finite, 2 excluded/filtered)",
    );
    expect(result.current.groupNotice?.detail.split("\n")).toEqual([
      "small groups: grp = B: n=2",
      "grp = C: n=0 (never occurs)",
      "grp = D: n=0, 2 non-finite",
      "grp = E: n=0, 2 excluded/filtered",
    ]);
  });

  it("hideEmptyLevels removes the empty slots from BOTH the screen and the export", async () => {
    const { result } = renderHook(() =>
      useStatStage({
        active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {},
        hideEmptyLevels: true, showGroupN: false,
      }),
    );
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "box" && d.slots != null).toBe(true);
    });
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    const draw = result.current.draw;
    if (draw?.mode !== "box") throw new Error("expected a box draw");
    expect(draw.slots?.map((s) => s.label)).toEqual(["grp = A", "grp = B"]);
    expect(spec.labels).toEqual(["grp = A", "grp = B"]);
    expect(spec.show_n).toBe(false);
    // The caveat is about the plotted groups, so it survives hiding the empties.
    expect(spec.caveat).toContain("unbalanced groups (n 2-12)");
    expect(result.current.groupNotice?.line).toContain("3 empty levels hidden");
  });

  it("bar: the screen's empty categories export as null means with n=0 counts (no longer a 422)", async () => {
    const { result } = renderHook(() =>
      useStatStage({ active: DS, yKeys: Y_KEYS, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} }),
    );
    act(() => result.current.setMode("bar"));
    await waitFor(() => expect(result.current.draw?.mode).toBe("bar"));
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportCategoricalFigure).mock.calls[0][0];
    const draw = result.current.draw;
    if (draw?.mode !== "bar") throw new Error("expected a bar draw");
    expect(spec.groups).toEqual(draw.data.groups.map((g) => g.label));
    expect(spec.groups).toEqual(["A", "B", "C", "D", "E"]);
    expect(spec.values.map((row) => row[0] === null)).toEqual([false, false, true, true, true]);
    expect(spec.counts).toEqual([[12], [2], [0], [0], [0]]);
    expect(spec.caveat).toBe(result.current.groupNotice?.caveat);
  });

  it("faceted box: each panel exports the SAME slots it draws", async () => {
    // fac splits A's rows; B lives only in panel f1, so panel f0 shows B empty.
    const faceted: Dataset = {
      ...DS,
      data: {
        ...DATA,
        values: DATA.values.map((row, r) => [...row, r < 6 ? 0 : 1]),
        labels: ["grp", "y", "fac"],
        units: ["", "", ""],
        cat_levels: { 0: ["A", "B", "C", "D", "E"], 2: ["f0", "f1"] },
      },
    };
    const { result } = renderHook(() =>
      useStatStage({ active: faceted, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {} }),
    );
    act(() => result.current.setFacetCol(2));
    await waitFor(() => expect(result.current.drawFacets?.length).toBe(2));
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    const panels = result.current.drawFacets!;
    spec.facets!.forEach((f, i) => {
      const d = panels[i].draw;
      if (d.mode !== "box" || !d.slots) throw new Error("expected slotted box panels");
      expect(f.labels).toEqual(d.slots.map((s) => s.label));
      expect(f.data.map((g) => g.length)).toEqual(d.slots.map((s) => (s.group === null ? 0 : d.boxes[s.group].n)));
    });
    expect(spec.facets![0].data.map((g) => g.length)).toEqual([6, 0, 0, 0, 0]);
    expect(spec.show_n).toBe(true);
  });
});

describe("Stat Stage missing levels — review round 2", () => {
  const params = (active: Dataset, over: Record<string, unknown> = {}) => ({
    active, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: () => {}, ...over,
  });

  it("HIDDEN empty levels still break the connect-means line, on screen and in the export alike", async () => {
    // Level order A, C, B, D, E: C (declared, no rows) sits BETWEEN A and B.
    const ordered: Dataset = { ...DS, data: { ...DATA, level_order: { 0: [0, 2, 1, 3, 4] } } };
    const { result } = renderHook(() => useStatStage(params(ordered, { hideEmptyLevels: true })));
    act(() => result.current.setShowConnectMeans(true));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "box" && d.connectMeans && d.slots != null).toBe(true);
    });
    const draw = result.current.draw;
    if (draw?.mode !== "box" || !draw.slots) throw new Error("expected a slotted box draw");
    // Screen: C is hidden, and B carries the gap it left.
    expect(draw.slots.map((s) => [s.label, s.gapBefore === true])).toEqual([["grp = A", false], ["grp = B", true]]);
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.labels).toEqual(["grp = A", "grp = B"]);
    // Export: the same break, where the backend's connect_segments reads it.
    expect(spec.connect_breaks).toEqual(draw.slots.map((s) => s.gapBefore === true));
  });

  it("a stale draw (the compute still holding the previous grouping) is never threaded onto the new axis", async () => {
    // Two categorical factors; the second has a different level count.
    const two: Dataset = {
      ...DS,
      data: {
        ...DATA,
        values: DATA.values.map((r, i) => [r[0], r[1], i % 2]),
        labels: ["grp", "y", "half"],
        units: ["", "", ""],
        cat_levels: { 0: ["A", "B", "C", "D", "E"], 2: ["odd", "even"] },
      },
    };
    const { result } = renderHook(() => useStatStage(params(two)));
    await waitFor(() => expect(result.current.groupNotice).not.toBeNull());
    // Freeze the compute: the next box request never settles.
    vi.mocked(statsBox).mockImplementation(() => new Promise(() => {}));
    act(() => result.current.setGroupCol(2));
    // The previous grouping's draw is still on screen — undecorated, with no
    // notice claiming anything about the new column's levels.
    const d = result.current.draw;
    expect(d?.mode === "box" && d.boxes.map((b) => b.label)).toEqual(["grp = A", "grp = B"]);
    expect(d?.mode === "box" && d.slots).toBeFalsy();
    expect(result.current.groupNotice).toBeNull();
  });

  it("Origin text sidecar with an INCONSISTENT excluded row: one label resolution, axis still threads", async () => {
    // Codes 0/1 labelled by a text column. The excluded row 3 names code 0
    // "Other", which disqualifies the sidecar over the WHOLE column but not
    // over the analysis view — the two resolutions disagree.
    const sidecar: Dataset = {
      id: "s", name: "s.opj",
      data: {
        time: [0, 1, 2, 3, 4, 5],
        values: [[0, 1], [0, 2], [0, 3], [0, 99], [1, 4], [1, 5]],
        labels: ["batch", "y"],
        units: ["", ""],
        metadata: { text_columns: { B: ["Ref", "Ref", "Ref", "Other", "Test", "Test"] } },
      },
      excludedRows: [3],
      channelTypes: { 0: "nominal" },
    };
    const { result } = renderHook(() => useStatStage(params(sidecar)));
    await waitFor(() => {
      const d = result.current.draw;
      expect(d?.mode === "box" && d.slots != null).toBe(true);
    });
    const draw = result.current.draw;
    if (draw?.mode !== "box" || !draw.slots) throw new Error("expected a slotted box draw");
    // The box labels ARE the slot labels (one resolution, over the universe).
    expect(draw.boxes.map((b) => b.label)).toEqual(draw.slots.map((s) => s.label));
    await act(async () => {
      await result.current.exportFigure("svg");
    });
    const spec = vi.mocked(exportStatplotFigure).mock.calls[0][0];
    expect(spec.labels).toEqual(draw.slots.map((s) => s.label));
  });
});
