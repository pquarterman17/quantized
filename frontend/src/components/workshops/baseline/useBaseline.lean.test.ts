// Audit finding 1: a lean baseline preview is published as such, with its
// full-baseline fetch remembered, so exports can swap in the real curve.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { upgradeBaselineOverlay } from "../../../store/fitOverlayUpgrade";
import { useApp } from "../../../store/useApp";
import { callBaselinePreview } from "./baselineCall";
import { useBaseline } from "./useBaseline";

vi.mock("./baselineCall", async (orig) => ({ ...(await orig<typeof import("./baselineCall")>()), callBaselinePreview: vi.fn() }));

const raw: DataStruct = { time: [1, 2, 3, 4], values: [[10], [12], [11], [13]], labels: ["I"], units: ["cps"], metadata: {} };

beforeEach(() => {
  vi.mocked(callBaselinePreview).mockReset();
  useApp.setState({
    datasets: [{ id: "d1", name: "scan.dat", data: raw }], activeId: "d1", baselineOverlay: null,
    xKey: null, yKeys: null, seriesOrder: null,
  });
});

describe("useBaseline lean preview", () => {
  it("marks the overlay lean and lets an export fetch the full baseline", async () => {
    vi.mocked(callBaselinePreview).mockResolvedValue({
      baseline: [1, undefined, undefined, 4] as never,
      full: () => Promise.resolve([1, 2, 3, 4]),
    });
    const { result } = renderHook(() => useBaseline());
    await act(async () => { result.current.setMethod("snip"); await result.current.compute(); });
    expect(useApp.getState().baselineOverlay?.lean).toBe(true);
    await expect(upgradeBaselineOverlay()).resolves.toBe(true);
    const now = useApp.getState().baselineOverlay!;
    expect(now.y).toEqual([1, 2, 3, 4]);
    expect(now.lean).toBeUndefined();
  });

  it("leaves a small, full estimate unmarked", async () => {
    vi.mocked(callBaselinePreview).mockResolvedValue({ baseline: [1, 2, 3, 4] });
    const { result } = renderHook(() => useBaseline());
    await act(async () => { await result.current.compute(); });
    expect(useApp.getState().baselineOverlay).not.toHaveProperty("lean");
  });
});
