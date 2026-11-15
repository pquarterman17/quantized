// The marks chunk is fetched only when a visible series asks for one.
import { describe, expect, it, vi } from "vitest";

import { ensureMarks, marks } from "./marksLoader";
import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";

const payload: PlotPayload = {
  data: [[1, 2, 3], [4, 5, 6]],
  series: [{ label: "M", unit: "" }],
  xLabel: "H",
  xUnit: "",
};

describe("marksLoader", () => {
  it("a plot whose styles use no mark never loads the chunk", async () => {
    buildOpts(payload, {
      width: 300, height: 200, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
      plotted: [0], seriesStyles: [{ color: "#f00", marker: true, fill: "under" }],
    });
    ensureMarks([undefined, { width: 2 }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(marks()).toBeNull();
  });

  it("a style that asks for one does", async () => {
    ensureMarks([{ dropLines: "x" }]);
    await vi.waitFor(() => expect(marks()).not.toBeNull());
  });
});
