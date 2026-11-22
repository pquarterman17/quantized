// Curve fit By tables, lane WB5: results of inputs that have since changed are
// reported `stale` (the panel withholds them and Save stays off) until the
// refit for the new inputs lands.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import type { CalcResult, DataStruct, Dataset } from "../../../lib/types";
import { useCurveFitByLevel } from "./useCurveFitByLevel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [1, 6]],
  labels: ["g", "y"], units: ["", ""], metadata: {},
};
const ACTIVE: Dataset = { id: "d", name: "d.csv", data: DATA, channelTypes: { 0: "nominal" } };
const COLUMNS = [{ index: 0, label: "g" }];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCurveFitByLevel stale results", () => {
  it("a settled run is current and not stale; a model change makes the old results stale until the refit lands", async () => {
    const held: ((r: CalcResult) => void)[] = [];
    let hold = false;
    vi.mocked(fitModel).mockImplementation((() =>
      hold ? new Promise<CalcResult>((r) => { held.push(r); }) : Promise.resolve({ params: [1] } as unknown as CalcResult)) as typeof fitModel);
    const { result, rerender } = renderHook(
      ({ model }) => useCurveFitByLevel(ACTIVE, DATA, COLUMNS, model, null, 1, undefined, undefined, 0),
      { initialProps: { model: "Linear" } },
    );
    await waitFor(() => expect(result.current.current).toBe(true));
    expect(result.current.stale).toBe(false);
    expect(result.current.results).toHaveLength(2);

    hold = true;
    rerender({ model: "Quadratic" });
    // Old results are still held, but they are not the answer for these inputs.
    expect(result.current.results).toHaveLength(2);
    expect(result.current.current).toBe(false);
    expect(result.current.stale).toBe(true);

    await act(async () => held.forEach((r) => r({ params: [2] } as unknown as CalcResult)));
    await waitFor(() => expect(result.current.current).toBe(true));
    expect(result.current.stale).toBe(false);
  });
});
