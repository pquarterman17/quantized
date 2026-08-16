import { describe, expect, it } from "vitest";

import { pageThumbnailSvg } from "./thumbnailPage";

const decode = (url: string): string => decodeURIComponent(url.replace("data:image/svg+xml,", ""));

describe("pageThumbnailSvg — E-c1 reference generator", () => {
  it("renders one cell per panel, filled only where a figure is placed", () => {
    const result = pageThumbnailSvg(2, 2, [true, false, false, true]);
    const svg = decode(result.url);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(svg.match(/<rect /g)).toHaveLength(5); // backdrop + 4 cells
    expect(svg.match(/fill="#9a9a9a" fill-opacity="0\.55"/g)).toHaveLength(2); // the 2 filled panels
    expect(svg.match(/stroke="#9a9a9a"/g)).toHaveLength(2); // the 2 empty outlines
  });

  it("clamps degenerate grids to 1×1 instead of dividing by zero", () => {
    const svg = decode(pageThumbnailSvg(0, 0, []).url);
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
  });
});
