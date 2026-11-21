import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../../lib/api/baseline";
import { HttpError, postJSON } from "../../../lib/api/http";
import { callBaselinePreview } from "./baselineCall";
import type { BaselineParams } from "./useBaseline";

vi.mock("../../../lib/api/baseline", () => ({
  baselineEstimate: vi.fn(),
  baselineEstimateLean: vi.fn(),
  baselineModPoly: vi.fn(),
  baselineModPolyLean: vi.fn(),
}));
vi.mock("../../../lib/api/http", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/http")>()),
  postJSON: vi.fn(),
}));

const P = { order: 3 } as BaselineParams;
const big = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const FULL = big(30_000).map((v) => v / 2);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.baselineEstimate).mockResolvedValue({ baseline: FULL });
  vi.mocked(api.baselineEstimateLean).mockResolvedValue({
    resultId: "rid", baselineDisplay: { rows: [0, 5, 29_999], y: [0, 2.5, null] },
  });
});

describe("callBaselinePreview", () => {
  it("keeps the full response for a small estimate", async () => {
    vi.mocked(api.baselineEstimate).mockResolvedValue({ baseline: [1, 2] });
    const r = await callBaselinePreview("snip", [0, 1], [3, 4], P, []);
    expect(r).toEqual({ baseline: [1, 2] });
    expect(api.baselineEstimateLean).not.toHaveBeenCalled();
  });

  it("asks a large SNIP for the lean response and lays the display over n rows", async () => {
    const x = big(30_000);
    const r = await callBaselinePreview("snip", x, x, P, []);
    expect(api.baselineEstimateLean).toHaveBeenCalledWith(
      expect.objectContaining({ return_baseline: false, display_points: 4096 }));
    expect(r.baseline).toHaveLength(30_000);
    expect(r.baseline[5]).toBe(2.5);
    expect(r.baseline[6]).toBeUndefined();
    expect(r.baseline[29_999]).toBeNull();
  });

  it("fetches the full baseline by id on Subtract", async () => {
    vi.mocked(postJSON).mockResolvedValue({ values: FULL });
    const x = big(30_000);
    const r = await callBaselinePreview("snip", x, x, P, []);
    expect(await r.full!()).toBe(FULL);
    expect(postJSON).toHaveBeenCalledWith("/api/results/array", { result_id: "rid", kind: "baseline" }, undefined);
    expect(api.baselineEstimate).not.toHaveBeenCalled();
  });

  it("re-runs the full request on a 409 and rethrows other errors", async () => {
    const x = big(30_000);
    const r = await callBaselinePreview("snip", x, x, P, []);
    vi.mocked(postJSON).mockRejectedValueOnce(new HttpError(409, "unknown_result"));
    expect(await r.full!()).toBe(FULL);
    expect(api.baselineEstimate).toHaveBeenCalledTimes(1);
    vi.mocked(postJSON).mockRejectedValueOnce(new HttpError(500, "boom"));
    await expect(r.full!()).rejects.toThrow("boom");
  });
});
