// P2.5 review finding #5: a dense sweep must be DECIMATED before it is drawn
// (a 200k-row preview would otherwise stringify a 300k-coordinate SVG
// `points` attribute on every render) without losing the true axis extent.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import ResamplePreviewPlot from "./ResamplePreviewPlot";

function ramp(n: number): DataStruct {
  const time = Array.from({ length: n }, (_, i) => i);
  return { time, values: time.map((x) => [x]), labels: ["Y"], units: [""], metadata: {} };
}

function pointCount(points: string | null): number {
  return (points ?? "").trim().split(/\s+/).filter(Boolean).length;
}

describe("ResamplePreviewPlot — decimation (finding #5)", () => {
  it("draws a dense sweep with far fewer than one coordinate per row", () => {
    const n = 50_000;
    render(<ResamplePreviewPlot source={ramp(n)} result={ramp(n)} channel={0} />);
    const plot = screen.getByTestId("resample-preview-plot");
    for (const line of plot.querySelectorAll("polyline")) {
      expect(pointCount(line.getAttribute("points"))).toBeLessThan(1000);
    }
  });

  it("still stretches the axis to the true extent after decimation (a single spike mid-sweep)", () => {
    const n = 5000;
    const time = Array.from({ length: n }, (_, i) => i);
    const values = time.map((_, i) => [i === 2500 ? 999 : 0]);
    const source: DataStruct = { time, values, labels: ["Y"], units: [""], metadata: {} };
    const result: DataStruct = { time: [0], values: [[0]], labels: ["Y"], units: [""], metadata: {} };
    render(<ResamplePreviewPlot source={source} result={result} channel={0} />);
    const plot = screen.getByTestId("resample-preview-plot");
    const line = plot.querySelector("polyline");
    const ys = (line?.getAttribute("points") ?? "")
      .trim()
      .split(/\s+/)
      .map((p) => Number(p.split(",")[1]));
    // PAD (6) is the top of the plot area; the spike's y (999, the max) must
    // scale to exactly there -- lost if the spike's row got decimated away
    // AND the axis extent were computed only from the decimated points.
    expect(Math.min(...ys)).toBeCloseTo(6, 1);
  });

  it("leaves a small dataset (well under the bucket count) exactly as before", () => {
    const source: DataStruct = { time: [0, 1, 2, 3], values: [[0], [10], [20], [30]], labels: ["M"], units: [""], metadata: {} };
    const result: DataStruct = { time: [0, 1, 2, 3, 4, 5, 6], values: [[0], [5], [10], [15], [20], [25], [30]], labels: ["M"], units: [""], metadata: {} };
    render(<ResamplePreviewPlot source={source} result={result} channel={0} />);
    const plot = screen.getByTestId("resample-preview-plot");
    expect(plot.querySelectorAll("[data-resampled-point]")).toHaveLength(7);
  });

  it("reports nothing to plot when neither series has a finite pair", () => {
    const blank: DataStruct = { time: [NaN, NaN], values: [[NaN], [NaN]], labels: ["M"], units: [""], metadata: {} };
    render(<ResamplePreviewPlot source={blank} result={blank} channel={0} />);
    expect(screen.getByText("Nothing to plot in this column.")).toBeTruthy();
  });
});
