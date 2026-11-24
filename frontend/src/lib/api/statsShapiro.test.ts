import { afterEach, describe, expect, it, vi } from "vitest";

import { SHAPIRO_MAX_N, statsShapiro } from "./stats";

describe("statsShapiro range guard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects n > 5000 locally, with no request (the backend would answer 422)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(statsShapiro(new Array(SHAPIRO_MAX_N + 1).fill(1))).rejects.toThrow(/3 to 5000 values \(got 5001\)/);
    await expect(statsShapiro([1, 2])).rejects.toThrow(/got 2/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
