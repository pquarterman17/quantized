// Plot audit round 3: a map grid value sits AT its axis coordinate
// (`zGrid[j][i]` at `(xAxis[i], yAxis[j])`): the axis ticks, the pointer
// readout, the contour rings and the vector export's `pcolormesh` all place it
// there. The heatmap image was stretched edge to edge instead, so texel i was
// centred at (i + 0.5)/nx of the frame rather than i/(nx - 1) — up to half a
// cell off, which on a coarse grid put a peak's colour beside its readout and
// its contour ring.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import { draw } from "./mapRender";

const p: MapPayload = {
  xAxis: [0, 1, 2],
  yAxis: [10, 20],
  zGrid: [
    [1, 2, 3],
    [4, 5, 6],
  ],
  xLabel: "2Theta", xUnit: "deg", yLabel: "Omega", yUnit: "deg", zLabel: "I", zUnit: "cts",
  zMin: 1, zMax: 6,
};

/** A 2-D context that records drawImage/clip and ignores everything else. */
function recordingContext(calls: { drawImage: number[][]; clip: number[][] }) {
  let lastRect: number[] = [];
  return new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (prop === "drawImage") return (_img: unknown, ...a: number[]) => calls.drawImage.push(a);
      if (prop === "rect") return (...a: number[]) => { lastRect = a; };
      if (prop === "clip") return () => calls.clip.push(lastRect);
      if (prop === "createLinearGradient") return () => ({ addColorStop: () => {} });
      if (prop === "createImageData") return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (prop === "measureText") return () => ({ width: 10 });
      return () => {};
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("the heatmap image", () => {
  it("centres each texel on its axis value and clips the half cells past the frame", () => {
    const calls = { drawImage: [] as number[][], clip: [] as number[][] };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => recordingContext(calls) as never);
    // 600x400 fallback (host clientWidth is 0 in jsdom) -> plot rect {58, 14, 464, 344}.
    draw(document.createElement("canvas"), document.createElement("div"), p, "viridis", false);
    expect(calls.drawImage).toHaveLength(1);
    const [x, y, w, h] = calls.drawImage[0];
    const texelX = (i: number) => x + ((i + 0.5) * w) / 3;
    const texelY = (j: number) => y + ((j + 0.5) * h) / 2; // texel row 0 = max y, at the top
    expect(texelX(0)).toBeCloseTo(58);
    expect(texelX(2)).toBeCloseTo(58 + 464);
    expect(texelY(0)).toBeCloseTo(14);
    expect(texelY(1)).toBeCloseTo(14 + 344);
    expect(calls.clip[0]).toEqual([58, 14, 464, 344]);
  });
});
