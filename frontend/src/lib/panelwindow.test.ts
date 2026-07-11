// Pure-model tests for the panel/overlay composite window (MAIN_PLAN #19 v1):
// grid-shape math, the union-x overlay payload builder (different x grids ->
// nulls, ascending order), and unit-family -> dual-Y axis assignment.

import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import {
  assignUnitFamilies,
  axisForUnit,
  buildOverlayPayload,
  decodePanelCellDrag,
  encodePanelCellDrag,
  panelGridShape,
  panelSyncKey,
  panelWindowTitle,
  PANEL_CELL_DND,
  removePanelDatasetId,
  reorderPanelDatasetIds,
  sanitizePanelDatasetIds,
  sanitizePanelLayout,
} from "./panelwindow";

describe("panelGridShape", () => {
  it("row forces a single row", () => {
    expect(panelGridShape("row", 4)).toEqual({ rows: 1, cols: 4 });
  });
  it("column forces a single column", () => {
    expect(panelGridShape("column", 3)).toEqual({ rows: 3, cols: 1 });
  });
  it("grid is sqrt-balanced (matches facetGridSize)", () => {
    expect(panelGridShape("grid", 4)).toEqual({ rows: 2, cols: 2 });
    expect(panelGridShape("grid", 5)).toEqual({ rows: 2, cols: 3 });
    expect(panelGridShape("grid", 1)).toEqual({ rows: 1, cols: 1 });
  });
  it("overlay is always 1x1 (a single shared viewport)", () => {
    expect(panelGridShape("overlay", 5)).toEqual({ rows: 1, cols: 1 });
  });
  it("n<=0 falls back to 1x1 for every layout", () => {
    expect(panelGridShape("grid", 0)).toEqual({ rows: 1, cols: 1 });
    expect(panelGridShape("row", -1)).toEqual({ rows: 1, cols: 1 });
  });
});

describe("panelWindowTitle", () => {
  it("panel layouts get a 'Panel:' prefix", () => {
    expect(panelWindowTitle("grid", ["A", "B"])).toBe("Panel: A, B");
    expect(panelWindowTitle("row", ["A"])).toBe("Panel: A");
  });
  it("overlay gets an 'Overlay:' prefix", () => {
    expect(panelWindowTitle("overlay", ["A", "B", "C"])).toBe("Overlay: A, B, C");
  });
  it("falls back to a bare prefix with no names", () => {
    expect(panelWindowTitle("grid", [])).toBe("Panel");
    expect(panelWindowTitle("overlay", [])).toBe("Overlay");
  });
});

describe("panelSyncKey", () => {
  it("derives a stable per-window key", () => {
    expect(panelSyncKey("win-abc")).toBe("qz-panel-win-abc");
    expect(panelSyncKey("win-abc")).toBe(panelSyncKey("win-abc"));
    expect(panelSyncKey("win-xyz")).not.toBe(panelSyncKey("win-abc"));
  });
});

describe("sanitizePanelDatasetIds / sanitizePanelLayout", () => {
  const live = new Set(["a", "b"]);
  it("drops non-string and dead ids, preserves order", () => {
    expect(sanitizePanelDatasetIds(["a", 5, "gone", "b"], live)).toEqual(["a", "b"]);
  });
  it("non-array input -> empty", () => {
    expect(sanitizePanelDatasetIds("nope", live)).toEqual([]);
    expect(sanitizePanelDatasetIds(undefined, live)).toEqual([]);
  });
  it("valid layout passes through; malformed falls back to grid", () => {
    expect(sanitizePanelLayout("overlay")).toBe("overlay");
    expect(sanitizePanelLayout("row")).toBe("row");
    expect(sanitizePanelLayout("bogus")).toBe("grid");
    expect(sanitizePanelLayout(undefined)).toBe("grid");
  });
});

describe("assignUnitFamilies / axisForUnit", () => {
  it("a single family stays on the left axis", () => {
    const { families, overflow } = assignUnitFamilies(["emu", "emu", "emu"]);
    expect(families).toEqual(["emu"]);
    expect(overflow).toBe(false);
    expect(axisForUnit(families, "emu")).toBe(0);
  });
  it("a second family goes to the right (y2) axis", () => {
    const { families, overflow } = assignUnitFamilies(["emu", "Oe", "emu"]);
    expect(families).toEqual(["emu", "Oe"]);
    expect(overflow).toBe(false);
    expect(axisForUnit(families, "emu")).toBe(0);
    expect(axisForUnit(families, "Oe")).toBe(1);
  });
  it("a third+ family collapses back onto the left with overflow=true", () => {
    const { families, overflow } = assignUnitFamilies(["emu", "Oe", "K"]);
    expect(families).toEqual(["emu", "Oe", "K"]);
    expect(overflow).toBe(true);
    expect(axisForUnit(families, "K")).toBe(0);
  });
  it("dimensionless ('') is its own family", () => {
    const { families } = assignUnitFamilies(["", "emu"]);
    expect(families).toEqual(["", "emu"]);
  });
});

function ds(id: string, name: string, time: number[], values: number[][], units: string[]): Dataset {
  return {
    id,
    name,
    data: {
      time,
      values,
      labels: units.map((_, i) => `ch${i}`),
      units,
      metadata: {},
    },
  };
}

describe("buildOverlayPayload", () => {
  it("merges disjoint x grids via a sorted union with nulls where a dataset has no point", () => {
    const a = ds("a", "A", [0, 1, 2], [[10], [20], [30]], ["emu"]);
    const b = ds("b", "B", [0.5, 1.5], [[100], [200]], ["emu"]);
    const { payload } = buildOverlayPayload([a, b]);
    expect(payload.data[0]).toEqual([0, 0.5, 1, 1.5, 2]); // ascending union
    expect(payload.data[1]).toEqual([10, null, 20, null, 30]); // A's column
    expect(payload.data[2]).toEqual([null, 100, null, 200, null]); // B's column
    expect(payload.series.map((s) => s.label)).toEqual(["A: ch0", "B: ch0"]);
  });

  it("shared x points align into the same union row", () => {
    const a = ds("a", "A", [0, 1, 2], [[1], [2], [3]], ["emu"]);
    const b = ds("b", "B", [0, 1, 2], [[9], [8], [7]], ["emu"]);
    const { payload } = buildOverlayPayload([a, b]);
    expect(payload.data[0]).toEqual([0, 1, 2]);
    expect(payload.data[1]).toEqual([1, 2, 3]);
    expect(payload.data[2]).toEqual([9, 8, 7]);
  });

  it("assigns dual-Y by unit family and prefixes legend with the dataset name", () => {
    const a = ds("a", "Sample A", [0, 1], [[1], [2]], ["emu"]);
    const b = ds("b", "Sample B", [0, 1], [[10], [20]], ["Oe"]);
    const { payload, families, overflow } = buildOverlayPayload([a, b]);
    expect(families).toEqual(["emu", "Oe"]);
    expect(overflow).toBe(false);
    expect(payload.series[0]).toMatchObject({ label: "Sample A: ch0", unit: "emu", axis: 0 });
    expect(payload.series[1]).toMatchObject({ label: "Sample B: ch0", unit: "Oe", axis: 1 });
  });

  it("a 3rd+ unit family reports overflow so the caller can warn", () => {
    const a = ds("a", "A", [0], [[1]], ["emu"]);
    const b = ds("b", "B", [0], [[1]], ["Oe"]);
    const c = ds("c", "C", [0], [[1]], ["K"]);
    const { overflow, families } = buildOverlayPayload([a, b, c]);
    expect(overflow).toBe(true);
    expect(families).toEqual(["emu", "Oe", "K"]);
  });

  it("honors row exclusion (#50) via lib/rowstate.analysisData", () => {
    const a: Dataset = {
      ...ds("a", "A", [0, 1, 2], [[10], [20], [30]], ["emu"]),
      excludedRows: [1],
    };
    const { payload } = buildOverlayPayload([a]);
    expect(payload.data[0]).toEqual([0, 2]); // row 1 pruned before the union
    expect(payload.data[1]).toEqual([10, 30]);
  });

  it("empty input returns an empty payload without throwing", () => {
    const { payload, families } = buildOverlayPayload([]);
    expect(payload.data[0]).toEqual([]);
    expect(payload.series).toEqual([]);
    expect(families).toEqual([]);
  });
});

describe("reorderPanelDatasetIds (drag-to-rearrange follow-up)", () => {
  it("moves the dragged id from the start to the end", () => {
    expect(reorderPanelDatasetIds(["a", "b", "c", "d"], 0, 3)).toEqual(["b", "c", "d", "a"]);
  });
  it("moves the dragged id from the end to the start", () => {
    expect(reorderPanelDatasetIds(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
  });
  it("moves a middle id forward, splicing it into the target's slot", () => {
    expect(reorderPanelDatasetIds(["a", "b", "c", "d"], 1, 2)).toEqual(["a", "c", "b", "d"]);
  });
  it("moves a middle id backward", () => {
    expect(reorderPanelDatasetIds(["a", "b", "c", "d"], 2, 1)).toEqual(["a", "c", "b", "d"]);
  });
  it("self-drop (fromIndex === toIndex) is a no-op", () => {
    const ids = ["a", "b", "c"];
    expect(reorderPanelDatasetIds(ids, 1, 1)).toEqual(["a", "b", "c"]);
  });
  it("an out-of-range fromIndex or toIndex is a no-op, never throws", () => {
    const ids = ["a", "b", "c"];
    expect(reorderPanelDatasetIds(ids, -1, 1)).toEqual(ids);
    expect(reorderPanelDatasetIds(ids, 1, 99)).toEqual(ids);
    expect(reorderPanelDatasetIds(ids, 99, 0)).toEqual(ids);
  });
  it("never mutates the input array", () => {
    const ids = ["a", "b", "c"];
    reorderPanelDatasetIds(ids, 0, 2);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("removePanelDatasetId", () => {
  it("drops the matching id, keeps the rest in order", () => {
    expect(removePanelDatasetId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
  it("a missing id is a no-op", () => {
    expect(removePanelDatasetId(["a", "b"], "gone")).toEqual(["a", "b"]);
  });
  it("removing down to zero is fine (the render layer's empty state handles it)", () => {
    expect(removePanelDatasetId(["a"], "a")).toEqual([]);
  });
});

describe("encodePanelCellDrag / decodePanelCellDrag", () => {
  it("round-trips a valid payload", () => {
    const payload = { windowId: "pw1", fromIndex: 2 };
    expect(decodePanelCellDrag(encodePanelCellDrag(payload))).toEqual(payload);
  });
  it("rejects malformed JSON, wrong shapes, and empty strings without throwing", () => {
    expect(decodePanelCellDrag("")).toBeNull();
    expect(decodePanelCellDrag("not json")).toBeNull();
    expect(decodePanelCellDrag(JSON.stringify({ windowId: "pw1" }))).toBeNull(); // missing fromIndex
    expect(decodePanelCellDrag(JSON.stringify({ windowId: 5, fromIndex: 1 }))).toBeNull(); // wrong type
    expect(decodePanelCellDrag(JSON.stringify({ windowId: "pw1", fromIndex: 1.5 }))).toBeNull(); // non-integer
  });
  it("PANEL_CELL_DND is distinct from the other internal drag MIME types", () => {
    expect(PANEL_CELL_DND).toBe("application/x-qz-panel-cell");
  });
});
