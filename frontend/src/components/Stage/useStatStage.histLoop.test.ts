// Regression: with no saved `histCols` the picks hook must hand back a STABLE
// empty list. `histCols` is a dependency of the histogram draw effect, so a
// fresh `[]` per render re-fired it forever (setBusy -> render -> new []),
// which hung the Stat Stage hook tests and aborted CI's vitest workers.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox, statsHistogram } from "../../lib/api";
import type { DataStruct, Dataset } from "../../lib/types";
import { useStatStage, type UseStatStageParams } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
  statsHistogram: vi.fn(),
}));

const DATA: DataStruct = {
  time: Array.from({ length: 8 }, (_, i) => i),
  values: Array.from({ length: 8 }, (_, i) => [i % 2, 10 + i]),
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
};
const DS: Dataset = { id: "d1", name: "run.dat", data: DATA };

const params = (): UseStatStageParams => ({
  active: DS,
  yKeys: null,
  xKey: null,
  seriesOrder: null,
  seed: null,
  onSeedConsumed: vi.fn(),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(statsBox).mockImplementation(() => new Promise(() => {}));
});

describe("useStatStage histogram without histCols", () => {
  it("keeps histCols referentially stable across renders", () => {
    const { result, rerender } = renderHook(() => useStatStage(params()));
    const first = result.current.histCols;
    rerender();
    rerender();
    expect(result.current.histCols).toBe(first);
  });

  it("computes the histogram a bounded number of times", async () => {
    vi.mocked(statsHistogram).mockResolvedValue({
      edges: [10, 14, 17],
      counts: [4, 4],
      density: false,
      fit: null,
    } as unknown as Awaited<ReturnType<typeof statsHistogram>>);
    const { result, rerender } = renderHook(() => useStatStage(params()));
    result.current.setMode("histogram");
    rerender();
    await waitFor(() => expect(vi.mocked(statsHistogram).mock.calls.length).toBeGreaterThan(0));
    rerender();
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(statsHistogram).mock.calls.length).toBeLessThanOrEqual(3);
  });
});
