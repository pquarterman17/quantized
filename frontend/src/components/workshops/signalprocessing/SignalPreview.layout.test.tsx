// SignalPreview layout (UX9-E): a processed curve whose span differs a lot from
// the original gets its OWN Y scale (stacked pane) so it fills the height; a
// comparable span keeps the one-scale overlay.

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import SignalPreview from "./SignalPreview";

const make = (ys: number[]): DataStruct => ({
  time: ys.map((_, i) => i),
  values: ys.map((y) => [y]),
  labels: ["I"],
  units: [""],
  metadata: {},
});

function pointYs(poly: Element): number[] {
  return (poly.getAttribute("points") ?? "").split(" ").map((p) => Number(p.split(",")[1]));
}

describe("SignalPreview Y scales", () => {
  it("normalised output (tiny span) is stacked on its own scale and fills its pane", () => {
    const original = make([0, 50000, 100000, 50000, 0]);
    const processed = make([0, 0.5, 1, 0.5, 0]);
    const { container } = render(<SignalPreview source={original} result={processed} channel={0} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("data-layout")).toBe("stacked");
    const polys = container.querySelectorAll("polyline");
    const ys = pointYs(polys[1]);
    // Pane is 110 tall below a 116 offset, 8px padding: the curve spans the full pane height.
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(110 - 16, 0);
  });

  it("comparable spans keep the shared-scale overlay", () => {
    const { container } = render(<SignalPreview source={make([0, 10, 20])} result={make([1, 9, 18])} channel={0} />);
    expect(container.querySelector("svg")!.getAttribute("data-layout")).toBe("overlay");
  });
});
