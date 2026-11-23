// useLoadColumns fails closed (ROADMAP "Product contract": missing inputs and
// non-finite data fail with a message). It used to resolve null for a worksheet
// that was gone, so Surface fit / Ellipse fit / Optical gap did nothing and
// said nothing, and it let an all-blank pick reach the backend as empty series.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useLoadColumns } from "./columnPicks";

const sheet = (values: number[][], time = [0, 1, 2]): Dataset => ({
  id: "d1", name: "d1", data: { time, values, labels: ["a", "b"], units: ["", ""], metadata: {} },
});

beforeEach(() => useApp.setState({ datasets: [sheet([[1, 2], [3, 4], [5, 6]])], activeId: "d1" }));

describe("useLoadColumns", () => {
  it("returns the finite rows of the picked columns", async () => {
    useApp.setState({ datasets: [sheet([[1, 2], [Number.NaN, 4], [5, 6]])] });
    const { result } = renderHook(() => useLoadColumns());
    const got = await result.current("d1", [0, 1]);
    expect(got.columns).toEqual([[1, 5], [2, 6]]);
  });

  it("rejects with a reason when the worksheet is gone, instead of resolving null", async () => {
    const { result } = renderHook(() => useLoadColumns());
    await expect(result.current("missing", [0, 1])).rejects.toThrow(/no longer available/);
  });

  it("rejects when no row is finite in every picked column, instead of sending empty series", async () => {
    useApp.setState({ datasets: [sheet([[Number.NaN, 2], [3, Number.NaN], [Number.NaN, Number.NaN]])] });
    const { result } = renderHook(() => useLoadColumns());
    await expect(result.current("d1", [0, 1])).rejects.toThrow(/no row has a finite value/i);
  });
});
