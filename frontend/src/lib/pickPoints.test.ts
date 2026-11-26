// Item 22: the Pick tool's model. Values are read from the SOURCE rows, a
// masked row is refused through the row-state model, and the worksheet carries
// each point's provenance.

import { describe, expect, it } from "vitest";

import { plotSelectedTogether } from "./plotSelectedTogether";
import { useApp } from "../store/useApp";
import { pickedData, resolvePick, withPick } from "./pickPoints";
import type { Dataset } from "./types";
import type { RebindState } from "./curveRebind";

const sheet = (id: string, excluded?: number[]): Dataset => ({
  id,
  name: `S${id}`,
  data: { time: [10, 20, 30], values: [[1, 2], [3, 4], [5, 6]], labels: ["A", "B"], units: ["V", "mA"], metadata: { x_column_name: "T", x_column_unit: "K" } },
  ...(excluded ? { excludedRows: excluded } : {}),
});
const state = (datasets: Dataset[], activeId: string, yKeys: number[] | null = null): RebindState => ({
  datasets, activeId, xKey: null, yKeys, seriesOrder: [], hiddenChannels: [], seriesLabels: {}, workbooks: [],
});

describe("resolvePick on a plain graph", () => {
  it("reads X and Y from the source row, with labels and units", () => {
    const a = sheet("a");
    const p = resolvePick(state([a], "a"), a, 1, 2);
    expect(p).toMatchObject({ datasetId: "a", row: 2, x: 30, y: 6, xLabel: "T (K)", yLabel: "B (mA)" });
  });
  it("refuses a masked row, naming it", () => {
    const a = sheet("a", [1]);
    const p = resolvePick(state([a], "a"), a, 0, 1);
    expect(p).toMatchObject({ refused: expect.stringContaining("row 2") });
  });
  it("refuses a non-finite value", () => {
    const a = sheet("a");
    a.data.values[0][0] = NaN;
    expect(resolvePick(state([a], "a"), a, 0, 0)).toHaveProperty("refused");
  });
});

describe("resolvePick on a live graph", () => {
  it("names the SOURCE sheet and row of a graph row", async () => {
    const a = sheet("a");
    const b = sheet("b");
    useApp.setState({ datasets: [a, b], activeId: null, selectedIds: [], history: [], future: [], workbooks: [] });
    await plotSelectedTogether(["a", "b"]);
    const g = useApp.getState().datasets.find((d) => d.linkedCurves)!;
    // graph rows: block of a (0..2), block of b (3..5); curve 1 is b's
    const p = resolvePick(state([a, b, g], g.id), g, 1, 4);
    expect(p).toMatchObject({ datasetId: "b", row: 1, x: 20 });
  });
});

describe("the picked worksheet", () => {
  const a = sheet("a");
  const pts = [resolvePick(state([a], "a"), a, 0, 0), resolvePick(state([a], "a"), a, 0, 2)] as ReturnType<typeof withPick>;
  it("does not collect the same point twice", () => {
    const once = withPick([], pts[0]);
    expect(withPick(once, pts[0])).toBe(once);
    expect(withPick(once, pts[1])).toHaveLength(2);
  });
  it("has X, Y, a 1-based source row and per-row provenance", () => {
    const d = pickedData(pts);
    expect(d.time).toEqual([10, 30]);
    expect(d.values).toEqual([[1, 1], [5, 3]]);
    expect(d.labels).toEqual(["A (V)", "Source row"]);
    expect(d.metadata).toMatchObject({ source: "picked", x_column_name: "T (K)" });
    expect((d.metadata as { picked_points: unknown[] }).picked_points[1]).toMatchObject({ dataset_id: "a", row: 2 });
  });
});
