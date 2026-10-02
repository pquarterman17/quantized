// "Plot selected together" x-axis title (plot-correctness audit 2026-10-02):
// overlaying two XRD scans titled the x axis "A (deg)" -- the overlay core
// hard-codes Origin's first-column name "A", and a non-Origin dataset has no
// x_column_long to override it. A Library selection must keep the sources'
// own x name.
import { describe, expect, it } from "vitest";

import { buildSelectionOverlay } from "./originOverlay";
import type { Dataset } from "./types";

const scan = (id: string, xName: string, unit: string): Dataset => ({
  id,
  name: id,
  data: {
    time: [10, 11],
    values: [[1], [2]],
    labels: ["Intensity"],
    units: [unit],
    metadata: { x_column_name: xName, x_column_unit: "deg" },
  },
});

describe("buildSelectionOverlay x name", () => {
  it("keeps the source x name instead of Origin's column letter", () => {
    const out = buildSelectionOverlay([scan("a.raw", "2-Theta", "counts"), scan("b.xrdml", "2-Theta", "cps")]);
    expect(out?.metadata.x_column_name).toBe("2-Theta");
    expect(out?.metadata.x_column_unit).toBe("deg");
  });

  it("falls back to x when the sources carry no x name", () => {
    const bare = (id: string): Dataset => ({ ...scan(id, "", "V"), data: { ...scan(id, "", "V").data, metadata: {} } });
    expect(buildSelectionOverlay([bare("a"), bare("b")])?.metadata.x_column_name).toBe("x");
  });
});
