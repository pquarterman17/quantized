// A zoomed 3-D plot is cropped at its own area: every plot mark is painted
// inside a clip to `Frame.plot`, and the colour bar and title sit outside that
// area, painted after the clip is lifted -- nothing is drawn under the bar
// (the export's crop is pinned by tests/test_export_map3d_view.py).

import { describe, expect, it } from "vitest";

import { drawScene, inPlot } from "./render3d";
import { frameFor } from "./render3dAxes";
import { sceneFromBody, type Scene3d } from "./scene3d";

const INK = { text: "#000", dim: "#555", grid: "#ccc", pane: "#eee", border: "#999", ui: "sans-serif", mesh: "#111", drop: "#555" };

/** A 2-D context that records every call (and how deep in save() it was). */
function recorder() {
  const calls: { name: string; args: unknown[]; depth: number; clipped: boolean }[] = [];
  let depth = 0;
  const clips: boolean[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "measureText") return () => ({ width: 20 });
      if (prop === "createLinearGradient") return () => ({ addColorStop() {} });
      return (...args: unknown[]) => {
        if (prop === "save") clips.push(clips.at(-1) ?? false);
        if (prop === "restore") clips.pop();
        if (prop === "clip") clips[clips.length - 1] = true;
        depth = clips.length;
        calls.push({ name: prop, args, depth, clipped: clips.at(-1) ?? false });
      };
    },
    set(target, prop: string, v) {
      target[prop] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const SURFACE = sceneFromBody({
  kind: "surface", x_axis: [0, 1, 2, 3], y_axis: [0, 1, 2, 3], title: "T", z_label: "M",
  z_grid: [[0, 1, 2, 3], [1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]],
}) as Scene3d;

describe("drawScene", () => {
  it("clips the plot to its area; the colour bar has its own column outside it, painted unclipped", () => {
    const f = frameFor(SURFACE, { elev: 30, azim: -60, zoom: 3 }, 900, 600);
    expect(f.bar).not.toBeNull();
    expect(f.plot.x + f.plot.w).toBeLessThan(f.bar!.x); // a gutter, then the bar
    expect(f.plot.y).toBeGreaterThan(6); // the title strip is above the plot
    const { ctx, calls } = recorder();
    drawScene(ctx, f, SURFACE, INK, false, 1);
    const clip = calls.findIndex((c) => c.name === "clip");
    const rect = calls[clip - 1];
    expect(rect.name).toBe("rect");
    expect(rect.args).toEqual([f.plot.x, f.plot.y, f.plot.w, f.plot.h]);
    const fills = calls.filter((c) => c.name === "fill");
    expect(fills.length).toBeGreaterThan(9); // panes + 9 quads
    expect(fills.every((c) => c.clipped)).toBe(true); // every pane and quad
    // The bar (fillRect) and the title come after the clip is lifted.
    const bar = calls.filter((c) => c.name === "fillRect");
    expect(bar.length).toBeGreaterThan(0);
    expect(bar.every((c) => !c.clipped)).toBe(true);
    const title = calls.find((c) => c.name === "fillText" && c.args[0] === "T")!;
    expect(title.clipped).toBe(false);
    expect(title.args[2]).toBeLessThan(f.plot.y);
  });

  it("hover reads only over the plot, not over the bar column", () => {
    const f = frameFor(SURFACE, { elev: 30, azim: -60, zoom: 1 }, 900, 600);
    expect(inPlot(f, f.plot.x + 10, f.plot.y + 10)).toBe(true);
    expect(inPlot(f, f.bar!.x + 2, f.bar!.y + 2)).toBe(false);
  });
});
