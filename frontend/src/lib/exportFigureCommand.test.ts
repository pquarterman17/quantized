// lib/exportFigureCommand's liveViewOverrides — the MAIN #18 export-parity
// piece: annotations (with `size`) + legend screen position, mapped into the
// FigureOverrides shape calc.figure_overrides expects.

import { describe, expect, it } from "vitest";

import { liveViewOverrides } from "./exportFigureCommand";
import type { Annotation } from "./types";

function fakeGet(over: {
  showLegend?: boolean;
  legendPos?: "ne" | "nw" | "se" | "sw";
  legendXY?: [number, number] | null;
  annotations?: Annotation[];
}) {
  const state = {
    showLegend: over.showLegend ?? true,
    legendPos: over.legendPos ?? "ne",
    legendXY: over.legendXY ?? null,
    annotations: over.annotations ?? [],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (() => state) as any;
}

describe("liveViewOverrides", () => {
  it("maps a corner legendPos through legendPosToLoc when legendXY is unset", () => {
    const ov = liveViewOverrides(fakeGet({ legendPos: "sw" }));
    expect(ov?.legend).toEqual({ show: true, loc: "lower left" });
  });

  it("maps a free legendXY to loc:custom + anchor (MAIN #18)", () => {
    const ov = liveViewOverrides(fakeGet({ legendXY: [0.25, 0.75] }));
    expect(ov?.legend).toEqual({ show: true, loc: "custom", anchor: [0.25, 0.75] });
  });

  it("sends show:false when the screen legend is hidden, ignoring legendPos/legendXY", () => {
    const ov = liveViewOverrides(fakeGet({ showLegend: false, legendXY: [0.1, 0.1] }));
    expect(ov?.legend).toEqual({ show: false });
  });

  it("carries each annotation's size override through, omitting it when unset", () => {
    const ov = liveViewOverrides(
      fakeGet({
        annotations: [
          { id: "a1", x: 1, y: 2, text: "Tc", size: 24 },
          { id: "a2", x: 3, y: 4, text: "Hc" },
        ],
      }),
    );
    expect(ov?.annotations).toEqual([
      { x: 1, y: 2, text: "Tc", size: 24 },
      { x: 3, y: 4, text: "Hc" },
    ]);
  });

  it("drops a non-finite annotation rather than sending garbage coords", () => {
    const ov = liveViewOverrides(
      fakeGet({ annotations: [{ id: "a1", x: Number.NaN, y: 2, text: "bad" }] }),
    );
    expect(ov?.annotations ?? []).toHaveLength(0);
  });

  it("carries a page-anchored annotation's anchor through, omitting it for a data-anchored one (MAIN #21)", () => {
    const ov = liveViewOverrides(
      fakeGet({
        annotations: [
          { id: "a1", x: 0.2, y: 0.8, text: "field", anchor: "page" },
          { id: "a2", x: 3, y: 4, text: "Hc" },
        ],
      }),
    );
    expect(ov?.annotations).toEqual([
      { x: 0.2, y: 0.8, text: "field", anchor: "page" },
      { x: 3, y: 4, text: "Hc" },
    ]);
  });

  it("omits annotations entirely (not an empty array) when there are none", () => {
    const ov = liveViewOverrides(fakeGet({}));
    expect(ov).not.toHaveProperty("annotations");
  });
});
