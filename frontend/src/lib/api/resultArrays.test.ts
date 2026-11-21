import { beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError, postJSON } from "./http";
import { arrayByIdOr, displayColumn, leanTransport } from "./resultArrays";

vi.mock("./http", async (orig) => ({ ...(await orig<typeof import("./http")>()), postJSON: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("resultArrays", () => {
  it("asks for the lean response only above the threshold", () => {
    expect(leanTransport(20_000)).toEqual({});
    expect(leanTransport(20_001)).toEqual({ return_baseline: false, display_points: 4096 });
  });

  it("lays a display over n rows, undefined between and null at a gap", () => {
    expect(displayColumn({ rows: [0, 2, 3], y: [1, null, 4] }, 5)).toEqual([1, undefined, null, 4, undefined]);
  });

  it("uses the id, falls back on 409 and without an id, and rethrows the rest", async () => {
    const rerun = vi.fn().mockResolvedValue([9]);
    vi.mocked(postJSON).mockResolvedValueOnce({ values: [1, 2] });
    expect(await arrayByIdOr("rid", "background", rerun)).toEqual([1, 2]);
    expect(rerun).not.toHaveBeenCalled();
    vi.mocked(postJSON).mockRejectedValueOnce(new HttpError(409, "unknown_result"));
    expect(await arrayByIdOr("rid", "baseline", rerun)).toEqual([9]);
    expect(await arrayByIdOr(null, "baseline", rerun)).toEqual([9]);
    vi.mocked(postJSON).mockRejectedValueOnce(new HttpError(500, "boom"));
    await expect(arrayByIdOr("rid", "baseline", rerun)).rejects.toThrow("boom");
  });
});
