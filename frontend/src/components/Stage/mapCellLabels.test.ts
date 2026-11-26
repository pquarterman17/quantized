// The map canvas's cell labels: which cells print what, in which ink, and which
// are skipped (too small, or a gap).
import { describe, expect, it } from "vitest";

import type { MapPayload } from "../../lib/mapdataFetch";
import { drawCellLabels } from "./mapCellLabels";

function payload(nx: number, ny: number, z: (number | null)[][]): MapPayload {
  return { xAxis: Array.from({ length: nx }, (_, i) => i), yAxis: Array.from({ length: ny }, (_, j) => j), zGrid: z } as unknown as MapPayload;
}

function run(p: MapPayload, w: number, h: number, opts = { format: "fixed", precision: 0 } as const, logZ = false) {
  const calls: { text: string; x: number; y: number; ink: string }[] = [];
  let ink = "";
  const ctx = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    set fillStyle(v: string) { ink = v; },
    set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    fillText(text: string, x: number, y: number) { calls.push({ text, x, y, ink }); },
  } as unknown as CanvasRenderingContext2D;
  drawCellLabels(ctx, p, { x: 0, y: 0, w, h }, opts, 0, 5, logZ, "viridis");
  return calls;
}

describe("drawCellLabels", () => {
  const p = payload(3, 2, [[0, 1, 2], [3, null, 5]]);
  it("prints each finite cell at its axis position, bottom row at the bottom, skipping gaps", () => {
    const calls = run(p, 200, 100);
    expect(calls.map((c) => c.text).sort()).toEqual(["0", "1", "2", "3", "5"]);
    expect(calls.find((c) => c.text === "0")).toMatchObject({ x: 0, y: 100 });
    expect(calls.find((c) => c.text === "5")).toMatchObject({ x: 200, y: 0 });
  });
  it("reads in white on the dark end of the colormap and black on the bright end", () => {
    const calls = run(p, 200, 100);
    expect(calls.find((c) => c.text === "0")?.ink).toBe("#ffffff");
    expect(calls.find((c) => c.text === "5")?.ink).toBe("#000000");
  });
  it("skips every label when the cells are too small to read", () => {
    expect(run(p, 12, 8)).toEqual([]);
  });
  it("skips a cell only when its own text is too wide", () => {
    const wide = payload(3, 2, [[1234.5678, 1, 2], [3, 4, 5]]);
    const calls = run(wide, 90, 100, { format: "fixed", precision: 4 } as never);
    expect(calls.map((c) => c.text)).not.toContain("1234.5678");
    expect(calls.length).toBeGreaterThan(0);
  });
});
