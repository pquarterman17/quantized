// Review #4: a saved fit is regenerated over the rows it was FITTED on -- its
// row selection, its fit window and the active (not excluded / filtered) rows
// -- as Curve Fit drew it, never extrapolated across the whole sheet.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateSavedFit, fittedRows } from "./savedFitCurve";
import type { Dataset, FitSpec } from "./types";

const mocks = vi.hoisted(() => ({ fitBands: vi.fn() }));
vi.mock("./api/fitStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/fitStats")>()), fitBands: mocks.fitBands,
}));

// An M(H) loop: H = -3..3; only the linear branch (|H| <= 1) was fitted.
const LOOP: Dataset = {
  id: "mh", name: "mh.csv",
  data: { time: [-3, -2, -1, 0, 1, 2, 3], values: [[-1], [-1], [-0.5], [0], [0.5], [1], [1]], labels: ["M"], units: ["emu"], metadata: {} },
};
const LINE: FitSpec = { model: "Linear", xKey: null, yKey: 0, params: [0, 0.5], range: [-1, 1] };

beforeEach(() => {
  mocks.fitBands.mockReset();
  mocks.fitBands.mockImplementation(async ({ x }: { x: number[] }) => ({ yFit: x.map((v) => 0.5 * v) }));
});

describe("fittedRows", () => {
  it("keeps only the rows inside the recorded fit window", () => {
    expect(fittedRows(LOOP, LINE, null)).toEqual([2, 3, 4]);
  });

  it("drops excluded rows, and honours an explicit row selection while the row count holds", () => {
    expect(fittedRows({ ...LOOP, excludedRows: [3] }, LINE, null)).toEqual([2, 4]);
    const picked = { ...LINE, range: undefined, rowIds: [0, 1, 5], sourceRowCount: 7 };
    expect(fittedRows(LOOP, picked, null)).toEqual([0, 1, 5]);
    // A structural edit since (row count changed): the selection no longer applies.
    expect(fittedRows(LOOP, { ...picked, sourceRowCount: 9 }, null)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("evaluateSavedFit", () => {
  it("draws a range-limited fit over its own window only, null elsewhere (no extrapolation)", async () => {
    const y = await evaluateSavedFit(LOOP, LINE, LINE.params!, null);
    expect(y).toEqual([null, null, -0.5, 0, 0.5, null, null]);
    expect(mocks.fitBands).toHaveBeenCalledWith(expect.objectContaining({ x: [-1, 0, 1] }));
  });

  it("never draws through an excluded point", async () => {
    const y = await evaluateSavedFit({ ...LOOP, excludedRows: [3] }, LINE, LINE.params!, null);
    expect(y).toEqual([null, null, -0.5, null, 0.5, null, null]);
  });
});
