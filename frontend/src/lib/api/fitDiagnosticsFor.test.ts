import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitDiagnosticsFor } from "./fitDiagnosticsFor";
import { fitDiagnostics, type DiagnosticsResult } from "./fitStats";
import { HttpError } from "./http";

vi.mock("./fitStats", () => ({ fitDiagnostics: vi.fn() }));

const RESULT = { compare: {}, residuals: {} } as unknown as DiagnosticsResult;
const arrays = vi.fn(() => ({ y: [1, 2, 3], residuals: [0.1, -0.2, 0.1], weights: [1, 1, 1] }));

beforeEach(() => {
  vi.mocked(fitDiagnostics).mockReset();
  arrays.mockClear();
});

describe("fitDiagnosticsFor (P4: diagnostics by fit result id)", () => {
  it("posts only the id when the fit kept one -- no arrays are built or sent", async () => {
    vi.mocked(fitDiagnostics).mockResolvedValue(RESULT);
    await expect(fitDiagnosticsFor("abc", 2, arrays, { useWeights: true, qqPoints: 512 })).resolves.toBe(RESULT);
    expect(vi.mocked(fitDiagnostics).mock.calls).toEqual([
      [{ n_params: 2, qq_points: 512, result_id: "abc", use_weights: true }, undefined],
    ]);
    expect(arrays).not.toHaveBeenCalled();
  });

  it("resends the arrays once on a 409 (evicted id, or a restarted server)", async () => {
    vi.mocked(fitDiagnostics)
      .mockRejectedValueOnce(new HttpError(409, "unknown_fit_result"))
      .mockResolvedValueOnce(RESULT);
    await expect(fitDiagnosticsFor("old", 2, arrays, { useWeights: false, qqPoints: 1 })).resolves.toBe(RESULT);
    expect(vi.mocked(fitDiagnostics).mock.calls[1]![0]).toEqual({
      n_params: 2, qq_points: 1, y: [1, 2, 3], residuals: [0.1, -0.2, 0.1], weights: [1, 1, 1],
    });
  });

  it("does not mask any other failure, and posts arrays when there is no id", async () => {
    vi.mocked(fitDiagnostics).mockRejectedValueOnce(new HttpError(422, "bad"));
    await expect(fitDiagnosticsFor("abc", 2, arrays, { useWeights: true, qqPoints: 1 })).rejects.toThrow("bad");
    expect(arrays).not.toHaveBeenCalled();
    vi.mocked(fitDiagnostics).mockResolvedValueOnce(RESULT);
    await fitDiagnosticsFor(undefined, 2, arrays, { useWeights: true, qqPoints: 1 });
    expect(vi.mocked(fitDiagnostics).mock.calls[1]![0]).toMatchObject({ y: [1, 2, 3], n_params: 2 });
  });
});
