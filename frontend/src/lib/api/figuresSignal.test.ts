// P3.4 safe cancel: every figure-export wrapper forwards the caller's abort
// signal to the download transport, so a Cancel control can stop the render
// and a cancelled export saves no file. The corner, ternary and field
// wrappers were the last three in lib/api/figures.ts without one.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { postDownload } from "./http";
import { exportCornerFigure, exportFieldFigure, exportTernaryFigure } from "./figures";

vi.mock("./http", () => ({
  postDownload: vi.fn().mockResolvedValue(undefined),
  postBlob: vi.fn(),
  postJSON: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("figure export wrappers forward the abort signal (P3.4)", () => {
  it("corner passes its signal to postDownload", async () => {
    const signal = new AbortController().signal;
    const body = { samples: [[1]], param_names: ["a"] };
    await exportCornerFigure(body, signal);
    expect(postDownload).toHaveBeenCalledWith("/api/export/corner-figure", body, "corner.pdf", signal);
  });

  it("ternary passes its signal to postDownload", async () => {
    const signal = new AbortController().signal;
    const body = { data: [[1, 0, 0]] };
    await exportTernaryFigure(body, signal);
    expect(postDownload).toHaveBeenCalledWith("/api/export/ternary-figure", body, "ternary.pdf", signal);
  });

  it("field passes its signal to postDownload", async () => {
    const signal = new AbortController().signal;
    const body = { x_axis: [0, 1], y_axis: [0, 1], u_grid: [[1, 2], [3, 4]], v_grid: [[0, 0], [0, 0]] };
    await exportFieldFigure(body, signal);
    expect(postDownload).toHaveBeenCalledWith("/api/export/field-figure", body, "field.pdf", signal);
  });
});
