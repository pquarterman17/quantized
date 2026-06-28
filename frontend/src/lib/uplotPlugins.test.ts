import { describe, expect, it } from "vitest";

import type { Annotation, RefLine } from "./types";
import {
  annotationPlugin,
  pickRefLine,
  readoutPlugin,
  refLinePlugin,
  type Readout,
} from "./uplotPlugins";

/** Minimal uPlot stub: a recording 2D context + a linear valToPos. */
function fakeU() {
  const segs: { from: [number, number]; to: [number, number] }[] = [];
  let pen: [number, number] = [0, 0];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    stroke() {},
    setLineDash() {},
    moveTo(x: number, y: number) {
      pen = [x, y];
    },
    lineTo(x: number, y: number) {
      segs.push({ from: pen, to: [x, y] });
    },
    strokeStyle: "",
    lineWidth: 0,
  };
  // x: identity; y: 100 - value (so y grows downward like a real plot)
  const valToPos = (v: number, scale: string) => (scale === "x" ? v : 100 - v);
  const u = { ctx, bbox: { left: 10, top: 5, width: 100, height: 80 }, valToPos };
  return { u, segs };
}

function draw(lines: RefLine[]) {
  const { u, segs } = fakeU();
  const plugin = refLinePlugin(lines, "#abc");
  // @ts-expect-error — minimal stub stands in for a real uPlot instance
  plugin.hooks.draw?.(u);
  return segs;
}

describe("refLinePlugin", () => {
  it("draws a vertical line for an in-range X reference", () => {
    const segs = draw([{ id: "r1", axis: "x", value: 50 }]);
    expect(segs).toHaveLength(1);
    // vertical: same x, spanning the plot height [top, top+height]
    expect(segs[0]).toEqual({ from: [50, 5], to: [50, 85] });
  });

  it("draws a horizontal line for an in-range Y reference", () => {
    const segs = draw([{ id: "r1", axis: "y", value: 30 }]); // py = 100-30 = 70
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ from: [10, 70], to: [110, 70] });
  });

  it("clips lines outside the plot area", () => {
    const segs = draw([
      { id: "a", axis: "x", value: 999 }, // px 999 > left+width
      { id: "b", axis: "x", value: -5 }, // px -5 < left
    ]);
    expect(segs).toHaveLength(0);
  });

  it("skips non-finite values", () => {
    expect(draw([{ id: "a", axis: "x", value: Number.NaN }])).toHaveLength(0);
  });
});

describe("pickRefLine (drag hit-test)", () => {
  const cands = [
    { id: "vx", axis: "x" as const, px: 100 }, // vertical line at x px 100
    { id: "hy", axis: "y" as const, px: 50 }, // horizontal line at y px 50
  ];

  it("hits a vertical (x) line by pointer x within tolerance", () => {
    expect(pickRefLine(cands, { x: 103, y: 0 })).toEqual({ id: "vx", axis: "x" });
  });

  it("hits a horizontal (y) line by pointer y within tolerance", () => {
    expect(pickRefLine(cands, { x: 0, y: 47 })).toEqual({ id: "hy", axis: "y" });
  });

  it("returns null when the pointer is beyond the tolerance", () => {
    expect(pickRefLine(cands, { x: 120, y: 200 })).toBeNull();
  });

  it("picks the closest when two lines are near", () => {
    const near = [
      { id: "a", axis: "x" as const, px: 100 },
      { id: "b", axis: "x" as const, px: 104 },
    ];
    expect(pickRefLine(near, { x: 103, y: 0 })?.id).toBe("b");
  });

  it("ignores non-finite candidate pixels (off-scale lines)", () => {
    expect(pickRefLine([{ id: "z", axis: "x", px: Number.NaN }], { x: 0, y: 0 })).toBeNull();
  });
});

/** Stub recording fillText + arc calls for the annotation plugin. */
function fakeAnnU() {
  const texts: { text: string; x: number; y: number }[] = [];
  const dots: { x: number; y: number }[] = [];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    fill() {},
    arc(x: number, y: number) {
      dots.push({ x, y });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y });
    },
    fillStyle: "",
    font: "",
    textBaseline: "" as CanvasTextBaseline,
  };
  const valToPos = (v: number, scale: string) => (scale === "x" ? v : 100 - v);
  const u = { ctx, bbox: { left: 10, top: 5, width: 100, height: 80 }, valToPos };
  return { u, texts, dots };
}

function drawAnn(anns: Annotation[]) {
  const { u, texts, dots } = fakeAnnU();
  const plugin = annotationPlugin(anns, "#fff", "11px mono");
  // @ts-expect-error — minimal stub stands in for a real uPlot instance
  plugin.hooks.draw?.(u);
  return { texts, dots };
}

describe("annotationPlugin", () => {
  it("draws a dot + label for an in-range annotation", () => {
    const { texts, dots } = drawAnn([{ id: "a1", x: 50, y: 30, text: "Tc" }]);
    expect(dots).toEqual([{ x: 50, y: 70 }]); // y px = 100-30
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe("Tc");
    expect(texts[0].x).toBeGreaterThan(50); // label offset to the right of the dot
  });

  it("clips annotations outside the plot area", () => {
    const { dots } = drawAnn([
      { id: "a", x: 999, y: 30, text: "off-x" },
      { id: "b", x: 50, y: -50, text: "off-y" }, // py = 150 > bottom
    ]);
    expect(dots).toHaveLength(0);
  });

  it("skips non-finite coordinates and draws no text when empty", () => {
    const { texts, dots } = drawAnn([
      { id: "a", x: Number.NaN, y: 1, text: "x" },
      { id: "b", x: 50, y: 30, text: "" }, // dot but no label
    ]);
    expect(dots).toHaveLength(1); // only the finite one
    expect(texts).toHaveLength(0); // empty text → no fillText
  });
});

/** Drive the readout plugin's setCursor hook with a stubbed uPlot. */
function readoutAt(
  idx: number | null,
  data: (number | null)[][],
  series: { label?: string; show?: boolean }[],
): Readout | null {
  let captured: Readout | null = null;
  const plugin = readoutPlugin((r) => {
    captured = r;
  });
  const u = { cursor: { idx }, data, series };
  // @ts-expect-error — minimal stub stands in for a real uPlot instance
  plugin.hooks.setCursor?.(u);
  return captured;
}

describe("readoutPlugin", () => {
  const data = [
    [10, 20, 30], // x
    [1, 2, 3], // series 1
    [4, 5, 6], // series 2
  ];
  const series = [{}, { label: "M" }, { label: "dM" }];

  it("reports every visible series' value at the cursor index", () => {
    const r = readoutAt(1, data, series);
    expect(r).toEqual({
      x: 20,
      rows: [
        { label: "M", y: 2 },
        { label: "dM", y: 5 },
      ],
    });
  });

  it("returns null when the cursor is off-data", () => {
    expect(readoutAt(null, data, series)).toBeNull();
  });

  it("skips hidden series (show:false) and null gaps", () => {
    const gapped = [
      [10, 20, 30],
      [1, null, 3],
      [4, 5, 6],
    ];
    const r = readoutAt(1, gapped, [{}, { label: "M" }, { label: "dM", show: false }]);
    // series 1 is null at idx 1, series 2 is hidden → no rows → null
    expect(r).toBeNull();
  });

  it("labels an unlabeled series as empty (chip falls back to 'y')", () => {
    const r = readoutAt(0, [[5], [9]], [{}, {}]);
    expect(r).toEqual({ x: 5, rows: [{ label: "", y: 9 }] });
  });
});
