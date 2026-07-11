import { describe, expect, it } from "vitest";

import { buildExportStyles } from "./exportStyles";
import type { SeriesStyle } from "./types";

describe("buildExportStyles", () => {
  it("carries width / line / marker overrides per channel in plotted order", () => {
    const styles: Record<number, SeriesStyle> = {
      2: { width: 3, line: "dashed", marker: true, markerSize: 6 },
    };
    // plotted channels [2, 0]: index 0 → channel 2 (styled), index 1 → channel 0
    const out = buildExportStyles([2, 0], styles);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ width: 3, line: "dashed", marker: true, marker_size: 6 });
    // channel 0 has no override → only the resolved palette color (or null in jsdom)
    expect(out[1]?.width).toBeUndefined();
  });

  it("omits a marker_size when markers are off", () => {
    const out = buildExportStyles([0], { 0: { marker: false } });
    expect(out[0]?.marker).toBeUndefined();
    expect(out[0]?.marker_size).toBeUndefined();
  });

  // ── MAIN #13: fill under/between ────────────────────────────────────────
  it("carries fill: 'under' through unchanged", () => {
    const out = buildExportStyles([0], { 0: { fill: "under" } });
    expect(out[0]?.fill).toBe("under");
  });

  it("carries fill: {vs: channel} as a dataset channel index (not a display position)", () => {
    const out = buildExportStyles([2, 0], { 2: { fill: { vs: 0 } } });
    expect(out[0]?.fill).toEqual({ vs: 0 });
  });

  it("omits fill when it's 'none' (the default, no wire noise)", () => {
    const out = buildExportStyles([0], { 0: { fill: "none" } });
    expect(out[0]?.fill).toBeUndefined();
  });
});
