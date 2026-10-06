import { describe, expect, it } from "vitest";

import type { Peak } from "../../../lib/types";
import { manualPeakAt, withoutDetectedPeaks } from "./detectedPeakCuration";

const peak = (center: number): Peak => ({
  center, height: 10, fwhm: 1, prominence: 10, localSNR: 5, area: null, bg: 2,
});

describe("detected peak curation", () => {
  it("snaps a manual candidate to the nearby apex and separates its background", () => {
    const added = manualPeakAt({
      x: [0, 1, 2, 3, 4],
      y: [2, 3, 12, 4, 2],
      fullX: [0, 1, 2, 3, 4],
      background: [2, 2, 2, 2, 2],
    }, 1.6);
    expect(added).toEqual(expect.objectContaining({
      center: 2,
      height: 10,
      bg: 2,
      status: "manual",
    }));
  });

  it("removes exactly the selected candidate indices", () => {
    expect(withoutDetectedPeaks([peak(1), peak(2), peak(3)], new Set([0, 2])).map((p) => p.center)).toEqual([2]);
  });

  it("refuses a typed position outside the measured x range", () => {
    const data = { x: [1, 2, 3], y: [1, 4, 1], fullX: [1, 2, 3], background: [0, 0, 0] };
    expect(manualPeakAt(data, 0)).toBeNull();
    expect(manualPeakAt(data, 4)).toBeNull();
  });
});
