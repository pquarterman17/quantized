// Reviews #4 / N6: a saved fit is regenerated over the rows it was FITTED on --
// its fit window, its active (not excluded / filtered) rows and only rows with
// a finite X AND Y -- as Curve Fit drew it, never extrapolated across the
// sheet, and a row selection that no longer matches is refused with a reason.
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
const rowsOf = (r: ReturnType<typeof fittedRows>) => (typeof r === "string" ? r : r.rows);

beforeEach(() => {
  mocks.fitBands.mockReset();
  mocks.fitBands.mockImplementation(async ({ x }: { x: number[] }) => ({ yFit: x.map((v) => 0.5 * v) }));
});

describe("fittedRows", () => {
  it("keeps only the rows inside the recorded fit window", () => {
    expect(rowsOf(fittedRows(LOOP, LINE))).toEqual([2, 3, 4]);
  });

  it("drops excluded rows", () => {
    expect(rowsOf(fittedRows({ ...LOOP, excludedRows: [3] }, LINE))).toEqual([2, 4]);
  });

  it("review N6a: skips a row whose Y is blank, as the screen breaks there", () => {
    const gappy: Dataset = { ...LOOP, data: { ...LOOP.data, values: [[-1], [-1], [-0.5], [Number.NaN], [0.5], [1], [1]] } };
    expect(rowsOf(fittedRows(gappy, LINE))).toEqual([2, 4]);
  });

  it("review N6b: a recorded row selection that no longer matches is refused, never widened", () => {
    const picked: FitSpec = { ...LINE, range: undefined, rowIds: [0, 1, 5], sourceRowCount: 9 }; // rows changed since
    const out = fittedRows(LOOP, picked);
    expect(typeof out).toBe("string");
    expect(out).toMatch(/row selection no longer matches the sheet/);
  });
});

describe("evaluateSavedFit", () => {
  it("draws a range-limited fit over its own window only, null elsewhere (no extrapolation)", async () => {
    const y = await evaluateSavedFit(LOOP, LINE, LINE.params!);
    expect(y).toEqual([null, null, -0.5, 0, 0.5, null, null]);
    expect(mocks.fitBands).toHaveBeenCalledWith(expect.objectContaining({ x: [-1, 0, 1] }));
  });

  it("never draws through an excluded point", async () => {
    const y = await evaluateSavedFit({ ...LOOP, excludedRows: [3] }, LINE, LINE.params!);
    expect(y).toEqual([null, null, -0.5, null, 0.5, null, null]);
  });

  it("returns the reason when the selection no longer matches (nothing evaluated)", async () => {
    const out = await evaluateSavedFit(LOOP, { ...LINE, rowIds: [2, 3], sourceRowCount: 4 }, LINE.params!);
    expect(out).toMatch(/row selection no longer matches/);
    expect(mocks.fitBands).not.toHaveBeenCalled();
  });
});
