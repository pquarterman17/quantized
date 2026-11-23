// #929: the Graph Builder / Quick Figure preview canvas follows the Stage's
// grouped-split contract: another level's row (`undefined`) is skipped and the
// line continues; the level's own non-finite row (`null`) breaks the line.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlotPayload } from "../../../lib/plotdata";
import { drawXY } from "./previewCanvas";

function mockCanvas() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === "measureText") return () => ({ width: 10 });
      return (..._args: unknown[]) => {
        if (key === "moveTo" || key === "lineTo") calls.push(key);
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  const host = document.createElement("div");
  return { canvas, host, calls };
}

function payload(y: (number | null | undefined)[]): PlotPayload {
  return {
    data: [[1, 2, 3, 4, 5], y],
    series: [{ label: "R (g=A)", unit: "" }],
    xLabel: "x",
    xUnit: "",
  } as unknown as PlotPayload;
}

afterEach(() => vi.restoreAllMocks());

describe("preview canvas — grouped level mask", () => {
  it("draws across another level's rows (undefined): one moveTo, then lineTo", () => {
    const { canvas, host, calls } = mockCanvas();
    drawXY(canvas, host, payload([1, undefined, 3, undefined, 5]), "line", false, "post");
    expect(calls).toEqual(["moveTo", "lineTo", "lineTo"]);
  });

  it("breaks at the level's own non-finite row (null): a second moveTo", () => {
    const { canvas, host, calls } = mockCanvas();
    drawXY(canvas, host, payload([1, 2, null, 4, 5]), "line", false, "post");
    expect(calls).toEqual(["moveTo", "lineTo", "moveTo", "lineTo"]);
  });
});
