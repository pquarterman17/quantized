// PR #492 review finding 3: Copy Figure's raw-SVG representation costs a
// second server render, so it is skipped when the browser would not take it
// anyway and when the figure is too dense for an outlined SVG to be worth it.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FigureSpec } from "./api/figures";
import type { FigurePageSpec } from "./api/figurePage";
import { clipboardSvgSupported } from "./clipboard";
import { COPY_SVG_MAX_POINTS, copySvgWanted, figurePointCount, pagePointCount } from "./copySvgBudget";
import type { DataStruct } from "./types";

vi.mock("./clipboard", () => ({ clipboardSvgSupported: vi.fn(() => true) }));

function data(rows: number, channels: number): DataStruct {
  return {
    time: Array.from({ length: rows }, (_, i) => i),
    values: Array.from({ length: rows }, () => Array.from({ length: channels }, () => 0)),
    labels: Array.from({ length: channels }, (_, c) => `c${c}`),
    units: Array.from({ length: channels }, () => ""),
    metadata: {},
  };
}

beforeEach(() => vi.mocked(clipboardSvgSupported).mockReturnValue(true));

describe("figurePointCount", () => {
  it("counts rows x plotted channels", () => {
    expect(figurePointCount({ dataset: data(100, 4), y_keys: [0, 2] })).toBe(200);
  });

  it("counts every channel when y_keys is omitted (the backend's default)", () => {
    expect(figurePointCount({ dataset: data(100, 3) })).toBe(300);
  });

  it("counts the facet payload, not the dataset, on the facet branch", () => {
    const spec: FigureSpec = {
      dataset: data(10_000, 5),
      facets: [
        { label: "A", x: [1, 2, 3], series: [{ label: "M", y: [1, 2, 3] }, { label: "N", y: [1, 2, 3] }] },
        { label: "B", x: [1, 2], series: [{ label: "M", y: [1, 2] }] },
      ],
    };
    expect(figurePointCount(spec)).toBe(8);
  });
});

describe("pagePointCount", () => {
  it("sums every panel's figure", () => {
    const page: FigurePageSpec = {
      rows: 1,
      cols: 2,
      panels: [
        { figure: { dataset: data(10, 2) }, row: 0, col: 0 },
        { figure: { dataset: data(5, 3), y_keys: [1] }, row: 0, col: 1 },
      ],
    };
    expect(pagePointCount(page)).toBe(25);
  });
});

describe("copySvgWanted", () => {
  it("is true up to and including the documented threshold", () => {
    expect(COPY_SVG_MAX_POINTS).toBe(20_000);
    expect(copySvgWanted(COPY_SVG_MAX_POINTS)).toBe(true);
    expect(copySvgWanted(COPY_SVG_MAX_POINTS + 1)).toBe(false);
  });

  it("is false whenever the browser does not advertise raw SVG", () => {
    vi.mocked(clipboardSvgSupported).mockReturnValue(false);
    expect(copySvgWanted(10)).toBe(false);
  });
});
