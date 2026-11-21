// Graph Builder polish (audit F8): the Facet well refuses a continuous column,
// and an error-well commit tells the user the bars are dataset-level.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useToasts } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { useGraphBuilder } from "./useGraphBuilder";

const N = 60;
const DATA: DataStruct = {
  time: Array.from({ length: N }, (_, i) => i),
  values: Array.from({ length: N }, (_, i) => [i, 100 + i * 0.5, i % 3, 0.1]),
  labels: ["x", "Temp_K", "lot", "dy"],
  units: ["", "K", "", ""],
  metadata: {},
};

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({ datasets: [{ id: "d1", name: "gb.csv", data: DATA }], activeId: "d1", history: [], future: [] });
});

describe("Graph Builder Facet well", () => {
  it("refuses a 60-level continuous column with a message, and leaves the well empty", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 0));
    act(() => result.current.assign("facet", 1)); // Temp_K: 60 distinct values
    expect(result.current.chips("facet")).toEqual([]);
    expect(useToasts.getState().toasts.some((t) => t.msg.includes("60 distinct values"))).toBe(true);
  });

  it("still accepts a 3-level column", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 0));
    act(() => result.current.assign("facet", 2));
    expect(result.current.chips("facet")).toEqual([{ channel: 2, label: "lot" }]);
  });
});

describe("Graph Builder Y error commit", () => {
  it("writes dataset-level roles and names the other plot windows that now show them", () => {
    useApp.getState().createWindow("d1"); // an existing plot window on the dataset
    const id2 = useApp.getState().createWindow("d1");
    useApp.getState().focusWindow(id2);
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("yErr", 3));
    act(() => result.current.applyToCurrent());
    const roles = useApp.getState().datasets[0].errorRoles;
    expect(roles).toContainEqual({ channel: 3, target: 1, axis: "y", side: "both" });
    expect(useToasts.getState().toasts.some((t) => t.msg.includes("other plot window"))).toBe(true);
  });
});
