// The scheduling half of cell search: small projects answer synchronously
// (tests, and anything under the limit); large ones build and query in
// time-boxed slices and say they are still searching until the answer is
// complete.

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cellIndexBuildCount } from "../../../lib/projectSearchCells";
import type { Dataset } from "../../../lib/types";
import { useCellSearch } from "./useCellSearch";

const ds = (id: string, cols: Record<string, unknown[]>): Dataset => ({
  id,
  name: `${id}.dat`,
  data: { time: [], values: [], labels: [], units: [], metadata: { text_columns: cols } },
});

describe("useCellSearch", () => {
  it("answers synchronously under the limit", () => {
    const datasets = [ds("a", { S: ["x", "hit"] })];
    const { result } = renderHook(() => useCellSearch(datasets, "hit"));
    expect(result.current.searching).toBe(false);
    expect(result.current.hits).toMatchObject([
      { datasetId: "a", column: "S", count: 1, firstRow: 1, firstText: "hit" },
    ]);
  });

  it("over the limit: reports searching, then the COMPLETE answer", async () => {
    const rows = Array.from({ length: 40_000 }, (_, i) => (i % 2 ? `odd ${i}` : `even ${i}`));
    const datasets = [ds("a", { S: rows }), ds("b", { T: rows })];
    const { result } = renderHook(() => useCellSearch(datasets, "odd", { syncCellLimit: 0, sliceMs: 1 }));
    expect(result.current.searching).toBe(true);
    expect(result.current.hits).toEqual([]);
    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(result.current.hits.map((h) => [h.datasetId, h.count, h.firstRow])).toEqual([
      ["a", 20_000, 1],
      ["b", 20_000, 1],
    ]);
  });

  it("each keystroke reuses the index: one build per text_columns object", async () => {
    const rows = Array.from({ length: 30_000 }, (_, i) => `S-${i}`);
    const datasets = [ds("a", { S: rows })];
    const before = cellIndexBuildCount();
    const { result, rerender } = renderHook(
      ({ q }) => useCellSearch(datasets, q, { syncCellLimit: 0, sliceMs: 2 }),
      { initialProps: { q: "s" } },
    );
    for (const q of ["s-", "s-1", "s-12", "s-123"]) rerender({ q });
    await waitFor(() => expect(result.current.searching).toBe(false));
    expect(result.current.hits[0]).toMatchObject({ count: 111, firstRow: 123 });
    expect(cellIndexBuildCount() - before).toBe(1);
  });

  it("is empty for a blank query", () => {
    const { result } = renderHook(() => useCellSearch([ds("a", { S: ["x"] })], "  "));
    expect(result.current).toEqual({ hits: [], searching: false });
  });
});
