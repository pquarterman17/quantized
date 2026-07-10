// Library thumbnail-mismatch fix (PNR Book15): the sparkline must (a) prune
// trailing Origin worksheet padding, (b) prefer the first Y-designated
// channel over the density heuristic (which can't tell a real Y column from
// an error column), and (c) trace a monotonic-in-x silhouette even when the
// underlying x isn't sorted.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../lib/types";
import Sparkline from "./Sparkline";

function pathOf(container: HTMLElement): string {
  return container.querySelector("path")?.getAttribute("d") ?? "";
}

/** Parse the "M x,y L x,y L x,y" path back into an ordered list of x pixel
 *  positions, so a test can assert on shape without hardcoding pixel math. */
function xsOf(d: string): number[] {
  return d
    .replace("M", "")
    .split("L")
    .map((seg) => parseFloat(seg.trim().split(",")[0]));
}

describe("Sparkline channel choice (Origin Y-designation over density heuristic)", () => {
  it("plots the first Y-designated channel, not channel 0 (PNR Book15: ch0 is an X-error column)", () => {
    // Shape mirrors Book15: dQ (X-error, ch0) barely varies near 0; R++ (Y,
    // ch1) is the real reflectivity curve with a big dynamic range. The old
    // density heuristic picked ch0 because every channel is equally "dense".
    const n = 20;
    const time = Array.from({ length: n }, (_, i) => i / n);
    const dQ = Array.from({ length: n }, () => 0.001);
    const rpp = Array.from({ length: n }, (_, i) => 1 - i / n);
    const data: DataStruct = {
      time,
      values: dQ.map((v, i) => [v, rpp[i]]),
      labels: ["dQ", "R++"],
      units: ["", ""],
      metadata: {
        origin_column_names: ["B", "C"],
        column_designations: { B: "X-error", C: "Y" },
      },
    };
    const { container } = render(<Sparkline data={data} />);
    const d = pathOf(container);
    expect(d).not.toBe("");
    // A flat dQ trace would produce a nearly-flat path (y barely moves); the
    // real R++ curve spans the full height. Assert the y-range actually used
    // is wide, i.e. NOT the flat dQ channel.
    const ys = d
      .replace("M", "")
      .split("L")
      .map((seg) => parseFloat(seg.trim().split(",")[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(10); // near-full 26px height
  });

  it("falls back to the density heuristic for non-Origin data (no designations at all)", () => {
    const n = 20;
    const time = Array.from({ length: n }, (_, i) => i);
    const sparse = Array.from({ length: n }, (_, i) => (i < 2 ? i : NaN)); // mostly NaN
    const dense = Array.from({ length: n }, (_, i) => i * 2);
    const data: DataStruct = {
      time,
      values: sparse.map((v, i) => [v, dense[i]]),
      labels: ["sparse", "dense"],
      units: ["", ""],
      metadata: {},
    };
    const { container } = render(<Sparkline data={data} />);
    expect(pathOf(container)).not.toBe("");
  });
});

describe("Sparkline trailing-padding pruning", () => {
  it("prunes a trailing all-zero run so the thumbnail doesn't collapse toward the origin", () => {
    // 20 real ascending points (y kept well away from 0, so a padding-caused
    // scale shift would be obvious), then 5 Origin over-allocated-storage
    // rows (x AND y simultaneously exact 0.0). Asserted on vertex COUNT
    // rather than pixel position so the assertion is independent of the
    // separate sort-by-x fix (which would otherwise mask the padding by
    // sorting it to the front instead of the back).
    const realTime = Array.from({ length: 20 }, (_, i) => 0.01 * (i + 1));
    const realY = Array.from({ length: 20 }, (_, i) => 0.5 + i * 0.025);
    const time = [...realTime, 0, 0, 0, 0, 0];
    const values = [...realY, 0, 0, 0, 0, 0].map((v) => [v]);
    const data: DataStruct = { time, values, labels: ["y"], units: [""], metadata: {} };
    const { container } = render(<Sparkline data={data} />);
    const d = pathOf(container);
    // Only the 20 real points should survive into the path -- the 5 padding
    // rows must not appear as extra vertices.
    expect(d.split("L").length).toBe(20);
  });

  it("leaves an interior all-zero point in place — only trims a trailing run", () => {
    const time = [0, 1, 2, 3, 4];
    const values = [[5], [0], [7], [8], [9]].map((v) => v);
    const data: DataStruct = { time, values, labels: ["y"], units: [""], metadata: {} };
    const { container } = render(<Sparkline data={data} />);
    const d = pathOf(container);
    // All 5 points survive (interior zero is real data, not padding), so the
    // path should have 5 vertices ("M" + 4 "L"s).
    expect(d.split("L").length).toBe(5);
  });
});

describe("Sparkline sorts sampled points by x", () => {
  it("produces a monotonically-increasing pixel-x sequence even when the raw x is unsorted", () => {
    // A non-ascending x (e.g. a hysteresis-loop-shaped or unsorted Origin
    // column): thumbnails have no hysteresis-fidelity requirement, so the
    // path should read as a clean silhouette, not a scribble.
    const time = [5, 1, 4, 2, 3];
    const values = [10, 20, 30, 40, 50].map((v) => [v]);
    const data: DataStruct = { time, values, labels: ["y"], units: [""], metadata: {} };
    const { container } = render(<Sparkline data={data} />);
    const xs = xsOf(pathOf(container));
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    }
  });
});

describe("Sparkline empty/short data", () => {
  it("renders an empty path for fewer than 2 usable points", () => {
    const data: DataStruct = {
      time: [0],
      values: [[1]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const { container } = render(<Sparkline data={data} />);
    expect(pathOf(container)).toBe("");
  });

  it("renders an empty path when the whole series is padding", () => {
    const data: DataStruct = {
      time: [0, 0, 0],
      values: [[0], [0], [0]],
      labels: ["y"],
      units: [""],
      metadata: {},
    };
    const { container } = render(<Sparkline data={data} />);
    expect(pathOf(container)).toBe("");
  });
});
