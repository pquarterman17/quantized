// G24: the Stage gate for "Use row states" -- nothing loads or changes unless a
// plotted series asks for them AND the dataset has states.

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ColorScatterSpec } from "../../lib/colorscatter";
import type { Dataset, SeriesStyle } from "../../lib/types";
import { useRowStateColumns } from "./useRowStateColumns";

const ds: Dataset = {
  id: "d",
  name: "d",
  data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: [""], metadata: {} },
  rowStyle: { color: ["s1", "", "s2"], marker: ["", "square", ""] },
};
const base = new Map<number, ColorScatterSpec>();
const on: Record<number, SeriesStyle> = { 0: { rowStates: true } };

describe("useRowStateColumns", () => {
  it("returns the very same Map when no series asks for row states (the default)", () => {
    const { result } = renderHook(() => useRowStateColumns(base, ds, [0], {}, false));
    expect(result.current).toBe(base);
  });

  it("returns the same Map when the dataset has no states, or the plot is split/encoded", () => {
    expect(renderHook(() => useRowStateColumns(base, { ...ds, rowStyle: undefined }, [0], on, false)).result.current).toBe(base);
    expect(renderHook(() => useRowStateColumns(base, ds, [0], on, true)).result.current).toBe(base);
  });

  it("with the option on, lays a flat per-row spec over the series (after its lazy module lands)", async () => {
    const { result } = renderHook(() => useRowStateColumns(base, ds, [0], on, false));
    await waitFor(() => expect(result.current.size).toBe(1));
    const spec = result.current.get(1) as ColorScatterSpec;
    expect(spec.flat).toBe(true);
    expect(spec.shapes).toEqual([null, "square", null]);
    expect(spec.fills?.length).toBe(3);
    expect(base.size).toBe(0); // the input Map is never mutated
  });
});
