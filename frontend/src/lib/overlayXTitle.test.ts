import { describe, expect, it } from "vitest";

import { buildSelectionOverlay } from "./originOverlay";
import { withSelectionXTitle } from "./overlayXTitle";
import type { Dataset } from "./types";

// A "Plot selected together" overlay of two 2-Theta scans read "A (deg)": the
// Origin column letter assembleOverlay stores, because a plain dataset names
// its x in x_column_name, not x_column_long.
const scan = (id: string, name: string, unit: string): Dataset => ({
  id,
  name: id,
  data: {
    time: [1, 2],
    values: [[1], [2]],
    labels: ["Y"],
    units: ["V"],
    metadata: name ? { x_column_name: name, x_column_unit: unit } : {},
  },
});

const titleOf = (sources: Dataset[]) => {
  const meta = withSelectionXTitle(buildSelectionOverlay(sources)!, sources).metadata;
  return [meta.x_column_long, meta.x_column_unit];
};

describe("withSelectionXTitle", () => {
  it("titles the x axis with the selection's own x name and unit", () => {
    expect(titleOf([scan("a", "2-Theta", "deg"), scan("b", "2-Theta", "deg")])).toEqual(["2-Theta", "deg"]);
  });

  it("names every distinct x quantity when the selection mixes them, never just the first", () => {
    expect(titleOf([scan("a", "Temperature", "K"), scan("b", "Magnetic Field", "Oe")])).toEqual([
      "Temperature (K) / Magnetic Field (Oe)",
      "",
    ]);
  });

  it("leaves the assembled title alone when no source names its x", () => {
    const sources = [scan("a", "", ""), scan("b", "", "")];
    const data = buildSelectionOverlay(sources)!;
    expect(withSelectionXTitle(data, sources)).toBe(data);
  });
});
