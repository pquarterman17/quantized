// The Inspector says which grid the Cell values labels describe, as the Map
// stage publishes it (lib/cellLabelGridKind.ts), through the real hook.

import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CELL_LABELS } from "../../lib/cellLabels";
import type { DataStruct } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { useMapCellNative } from "../Stage/useMapCellNative";
import MapCellLabels from "./MapCellLabels";

const grid = (n: number): DataStruct => {
  const values: number[][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values.push([i, j, i + j]);
  return { time: values.map((_, k) => k), values, labels: ["x", "y", "z"], units: ["", "", ""], metadata: {} } as unknown as DataStruct;
};

beforeEach(() => useApp.getState().setMapCellLabels("d1", DEFAULT_CELL_LABELS));

describe("the Inspector note on the Cell values grid", () => {
  it("says nothing until the map has read the rows", () => {
    render(<MapCellLabels datasetId="d1" />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("measured cells for a scan, display grid for scattered points, nothing when the option is off", () => {
    render(<MapCellLabels datasetId="d1" />);
    const scattered = { ...grid(5), values: Array.from({ length: 60 }, (_, k) => [Math.sin(k * 12.9) * 7, Math.cos(k * 7.3) * 5, k]) } as DataStruct;
    const hook = renderHook((p: { data: DataStruct; on: boolean }) => useMapCellNative(p.data, [0, 1, 2], p.on, "d1"), { initialProps: { data: grid(5), on: true } });
    expect(screen.getByRole("note").textContent).toBe("Labels describe the measured cells.");
    act(() => hook.rerender({ data: scattered, on: true }));
    expect(screen.getByRole("note").textContent).toMatch(/display grid/);
    act(() => hook.rerender({ data: scattered, on: false }));
    expect(screen.queryByRole("note")).toBeNull();
    act(() => hook.rerender({ data: grid(5), on: true }));
    hook.unmount();
    expect(screen.queryByRole("note")).toBeNull();
  });
});
