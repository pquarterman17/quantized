// The lollipop's whisker legend keeps clear of the whiskers on screen (acceptance 14, C2): it used to
// be placed by the dots alone, so a tall right-hand whisker ran through it. Drives the real `draw`.

import { describe, expect, it } from "vitest";

import { lollipopGeometry, lollipopSeries } from "../../lib/statDist3";
import { draw, plotRect, type StatDrawData } from "./statRender";
import { segmentPoints } from "./statLegendSpot";

const GROUPS = [[1, 1.2, 0.8, 1.1], [2, 2.4, 1.6, 2.1], [3, 3.6, 2.4, 3.1], [9, 12, 6, 9.5]];

function legendAt(groups: number[][], horizontal: boolean): { box: { x0: number; x1: number; y0: number; y1: number }; whiskers: [[number, number], [number, number]][] } {
  const series = lollipopSeries(groups, "mean", "none", "sd");
  const d = { mode: "lollipop", series, groups, labels: ["a", "b", "c", "d"], horizontal, valueLabel: "v" } as unknown as StatDrawData;
  const spots: { t: string; x: number; y: number }[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => (k === "fillText" ? (t: string, x: number, y: number) => spots.push({ t, x, y }) : () => ({ width: 40 })),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
  draw(canvas, { clientWidth: 600, clientHeight: 400 } as HTMLElement, d);
  const geo = lollipopGeometry(series, horizontal);
  const rect = plotRect(600, 400, d);
  const sx = (v: number) => rect.x + ((v - geo.x_domain[0]) / (geo.x_domain[1] - geo.x_domain[0])) * rect.w;
  const sy = (v: number) => rect.y + rect.h - ((v - geo.y_domain[0]) / (geo.y_domain[1] - geo.y_domain[0])) * rect.h;
  const label = spots.find((s) => s.t.startsWith("SD") || s.t.includes("SD"));
  expect(label, "the legend text").toBeDefined();
  const swatchX = label!.x - 18;
  return {
    box: { x0: swatchX - 4, x1: swatchX - 4 + 124, y0: label!.y - 9, y1: label!.y + 9 },
    whiskers: geo.whiskers!.map(([a, b]) => [[sx(a[0]), sy(a[1])], [sx(b[0]), sy(b[1])]] as [[number, number], [number, number]]),
  };
}

describe("lollipop whisker legend", () => {
  it.each([false, true])("keeps clear of every whisker (horizontal=%s)", (horizontal) => {
    const { box, whiskers } = legendAt(GROUPS, horizontal);
    const covered = segmentPoints(whiskers, 200).filter(([x, y]) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1);
    expect(covered).toEqual([]);
  });
});

describe("segmentPoints", () => {
  it("samples both ends and the points between", () => {
    expect(segmentPoints([[[0, 0], [10, 20]]], 2)).toEqual([[0, 0], [5, 10], [10, 20]]);
  });
});
