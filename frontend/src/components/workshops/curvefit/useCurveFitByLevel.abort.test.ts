// Curve fit By aborts the fits still in flight when its inputs change or it
// unmounts (lane BY3), and a late result of the old run never lands.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import type { CalcResult, DataStruct, Dataset } from "../../../lib/types";
import { useCurveFitByLevel } from "./useCurveFitByLevel";
import { partitionByColumn } from "../../../lib/byPartition";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [1, 6]],
  labels: ["g", "y"],
  units: ["", ""],
  metadata: {},
};
const ACTIVE: Dataset = { id: "d", name: "d.csv", data: DATA, channelTypes: { 0: "nominal" } };
const COLUMNS = [{ index: 0, label: "g" }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCurveFitByLevel abort", () => {
  it("aborts in-flight level fits when the model changes, and ignores their late results", async () => {
    const signals: AbortSignal[] = [];
    const resolvers: ((r: CalcResult) => void)[] = [];
    vi.mocked(fitModel).mockImplementation(((_req: unknown, signal?: AbortSignal) => {
      signals.push(signal!);
      return new Promise<CalcResult>((resolve) => { resolvers.push(resolve); });
    }) as typeof fitModel);
    const { result, rerender } = renderHook(
      ({ model }) => useCurveFitByLevel(ACTIVE, DATA, COLUMNS, model, null, 1, undefined, undefined, 0),
      { initialProps: { model: "Linear" } },
    );
    await waitFor(() => expect(signals.length).toBe(partitionByColumn(DATA, 0).levels.length));
    expect(signals.every((s) => !s.aborted)).toBe(true);
    rerender({ model: "Quadratic" });
    expect(signals.slice(0, 2).every((s) => s.aborted)).toBe(true);
    // The old run finishing late changes nothing: results come from the new run only.
    resolvers.slice(0, 2).forEach((resolve) => resolve({ params: [999] } as unknown as CalcResult));
    await waitFor(() => expect(signals.length).toBe(4));
    expect(result.current.results).toEqual([]);
    expect(result.current.busy).toBe(true);
  });
});
