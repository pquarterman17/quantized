import { describe, expect, it, vi } from "vitest";

import { leanFit, withResiduals } from "./fitResiduals";

describe("withResiduals (P4 lean fit transport)", () => {
  it("rebuilds y - yFit exactly, null where the server would send null", () => {
    // Values whose difference is not representable "nicely": the rebuilt
    // residual must be the very double the server's numpy subtraction makes,
    // which for one IEEE-754 subtraction of the same operands it is.
    const y = [0.1, 1e16, 3, 5, -0.3, Number.MAX_VALUE];
    const yFit = [0.2, 1, null, 5, 0.7, -Number.MAX_VALUE];
    const out = withResiduals({ yFit, params: [1] }, y);
    expect(out.residuals).toEqual([0.1 - 0.2, 1e16 - 1, null, 0, -0.3 - 0.7, null]);
    expect(Object.is((out.residuals as number[])[0], 0.1 - 0.2)).toBe(true);
    expect(out.params).toEqual([1]);
  });

  it("leaves a full result, or a misaligned one, as it came", () => {
    const full = { yFit: [1, 2], residuals: [9, 9] };
    expect(withResiduals(full, [1, 2])).toBe(full);
    const short = { yFit: [1] };
    expect(withResiduals(short, [1, 2])).toBe(short);
    const guess = { params: [1, 2] };
    expect(withResiduals(guess, [1, 2])).toBe(guess);
  });

  it("leanFit asks for the lean response and restores the residuals", async () => {
    const fit = vi.fn().mockResolvedValue({ params: [2, 0], yFit: [0, 2, 4], resultId: "r1" });
    const out = await leanFit(fit, { model: "Linear", x: [0, 1, 2], y: [0.5, 2, 3.5] });
    expect(fit).toHaveBeenCalledWith({ model: "Linear", x: [0, 1, 2], y: [0.5, 2, 3.5], return_residuals: false });
    expect(out).toEqual({ params: [2, 0], yFit: [0, 2, 4], resultId: "r1", residuals: [0.5, 0, -0.5] });
  });
});
