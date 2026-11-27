// The analysis workshops' "has a Y error?" map must include a column bound
// only through Inspector > Error columns (roles), which `errKeys` alone misses.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { effectiveErrKeys, effectiveYError } from "../lib/errorRoles";
import type { Dataset } from "../lib/types";
import { useEffectiveErrKeys } from "./useEffectiveErrKeys";
import { useApp } from "./useApp";

const DS: Dataset = {
  id: "d1", name: "ds",
  data: { time: [0, 1], values: [[1, 0.1, 2, 0.2], [2, 0.1, 3, 0.2]], labels: ["A", "dA", "B", "dB"], units: ["", "", "", ""], metadata: {} },
};

beforeEach(() => useApp.setState({ datasets: [DS], activeId: "d1", errKeys: {} }));

describe("effective error keys", () => {
  it("pure rule: a legacy pick wins over a role; roles fill the gaps; asymmetric roles do not project", () => {
    const roles = [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 3, target: 2, axis: "y", side: "+" },
    ] as const;
    expect(effectiveYError({}, roles, 0)).toBe(1);
    expect(effectiveYError({ 0: 3 }, roles, 0)).toBe(3);
    expect(effectiveYError({}, roles, 2)).toBeNull();
    expect(effectiveErrKeys({ 2: 3 }, roles)).toEqual({ 0: 1, 2: 3 });
    expect(effectiveErrKeys({ 2: 3 }, undefined)).toEqual({ 2: 3 });
  });

  it("the hook follows the real store: roles-only binding appears, and removal disappears", () => {
    const { result } = renderHook(() => useEffectiveErrKeys());
    expect(result.current).toEqual({});
    act(() => useApp.getState().setErrorRoles("d1", [{ channel: 1, target: 0, axis: "y", side: "both" }]));
    expect(useApp.getState().errKeys).toEqual({});
    expect(result.current).toEqual({ 0: 1 });
    act(() => useApp.getState().setErrorRoles("d1", []));
    expect(result.current).toEqual({});
  });
});
