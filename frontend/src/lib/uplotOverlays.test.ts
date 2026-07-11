import { describe, expect, it } from "vitest";

import type { ColorScatterSpec } from "./colorscatter";
import type { Annotation, RefLine } from "./types";
import {
  annotationPlugin,
  clampAnnotationLabelX,
  colorScatterPlugin,
  errorBarsPlugin,
  pickRefLine,
  refLinePlugin,
  REGION_SHADE_ALPHA,
  regionShadePlugin,
} from "./uplotOverlays";
import type { RegionShade } from "./types";

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

/** Stub recording fillText + arc calls for the annotation plugin. `hasY2`
 *  seeds `u.scales.y2` (present/absent) so tests can exercise the y2-gate;
 *  its valToPos gives "y2" a DIFFERENT offset than "y" so a test can tell
 *  which scale a mark actually resolved against. `textAlign` starts as
 *  `"right"` — mimicking the state uPlot's own axis-label draw leaves on the
 *  real shared canvas context (its left Y-axis right-aligns tick labels and
 *  never resets before firing draw hooks; see `annotationPlugin`'s
 *  docstring) — so a test can confirm the plugin sets it back explicitly
 *  rather than relying on whatever the canvas already had. `measureText`
 *  returns a fixed 6px/char estimate, just enough for the clamp math to have
 *  a non-zero width to work with. */
function fakeAnnU(hasY2 = false) {
  const texts: { text: string; x: number; y: number; align: CanvasTextAlign }[] = [];
  const dots: { x: number; y: number }[] = [];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    fill() {},
    arc(x: number, y: number) {
      dots.push({ x, y });
    },
    measureText(text: string) {
      return { width: text.length * 6 } as TextMetrics;
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, align: ctx.textAlign });
    },
    fillStyle: "",
    font: "",
    textBaseline: "" as CanvasTextBaseline,
    textAlign: "right" as CanvasTextAlign,
  };
  const valToPos = (v: number, scale: string) =>
    scale === "x" ? v : scale === "y2" ? 200 - v : 100 - v;
  const scales = hasY2 ? { x: {}, y: {}, y2: {} } : { x: {}, y: {} };
  const u = { ctx, bbox: { left: 10, top: 5, width: 100, height: 80 }, valToPos, scales };
  return { u, texts, dots };
}

function drawAnn(anns: Annotation[], hasY2 = false) {
  const { u, texts, dots } = fakeAnnU(hasY2);
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

  // Regression (Origin PNR.opj repro): uPlot's own left-Y-axis label draw
  // leaves `ctx.textAlign = "right"` resident on the shared canvas context
  // (see annotationPlugin's docstring); the plugin must set "left" itself on
  // every draw rather than inherit whatever's already there — the fakeAnnU
  // stub starts `textAlign` at "right" specifically to catch a regression
  // back to "relies on the ambient value".
  it("always sets textAlign explicitly instead of inheriting the canvas's ambient value", () => {
    const { texts } = drawAnn([{ id: "a1", x: 50, y: 30, text: "Tc" }]);
    expect(texts[0].align).toBe("left");
  });

  // Regression: a mark near the LEFT edge of its panel (Origin habitually
  // pins these little curve labels bottom-left — the PNR/Book15 "15 G from
  // 40 G" repro, and every sub-panel of the PNR/Book14 spin-asymmetry
  // multi-panel spread) must still anchor left-of-dot-grows-rightward, not
  // get flipped/clamped just because it's close to the axis.
  it("keeps a near-left-edge label anchored to the right of its dot", () => {
    // bbox left=10; dot at px=12 (2px inside the left edge).
    const { texts } = drawAnn([{ id: "a1", x: 12, y: 30, text: "15 G from 40 G" }]);
    expect(texts[0].align).toBe("left");
    expect(texts[0].x).toBe(18); // px + 6, unclamped — plenty of room to the right
  });

  // Regression: a mark near the RIGHT edge whose label would overflow past
  // `left + width` flips to a right-anchor mirrored to the left of the dot,
  // rather than bleeding off the panel's own edge (invisible on a
  // multi-panel's separately-canvased instance).
  it("flips a near-right-edge label to the left of its dot when it would overflow", () => {
    // bbox left=10,width=100 -> right edge 110. Dot at px=105, a 14-char
    // label (84px at the stub's 6px/char) would run to 105+6+84=195, way
    // past 110, so it must flip.
    const { texts } = drawAnn([{ id: "a1", x: 105, y: 30, text: "a fourteen chr" }]);
    expect(texts[0].align).toBe("right");
    expect(texts[0].x).toBe(99); // px - 6
  });

  // Regression: a mark near the very TOP of the panel must not push its
  // (bottom-anchored) label above the plot area.
  it("clamps a near-top-edge label's baseline so it stays on-panel", () => {
    // bbox top=5; dot at py=6 (1px below the top edge) -> naive py-2=4 < top,
    // so the clamp must push the baseline down to top + lineHeight
    // (fontPx("11px mono") * 1.3 = 14.3) instead.
    const { texts } = drawAnn([{ id: "a1", x: 50, y: 94, text: "top" }]); // 100-94=6
    expect(texts[0].y).toBeCloseTo(19.3);
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

  // Fix #3: an Origin double-Y apply's upper-layer marks are tagged axis:1
  // and must land on the SECONDARY (y2) scale, not the primary one.
  it("routes an axis:1 mark to the y2 scale when the plot has one", () => {
    const { dots } = drawAnn([{ id: "a", x: 50, y: 150, text: "y2 mark", axis: 1 }], true);
    expect(dots).toEqual([{ x: 50, y: 50 }]); // y2 valToPos: 200-150
  });

  it("falls back to the primary y scale for an axis:1 mark when the plot has no y2 scale", () => {
    const { dots } = drawAnn([{ id: "a", x: 50, y: 30, text: "y2 mark", axis: 1 }], false);
    expect(dots).toEqual([{ x: 50, y: 70 }]); // y valToPos: 100-30, never 200-30
  });

  it("keeps an untagged (primary) annotation on y even when the plot HAS a y2 scale", () => {
    const { dots } = drawAnn([{ id: "a", x: 50, y: 30, text: "primary" }], true);
    expect(dots).toEqual([{ x: 50, y: 70 }]);
  });
});

describe("clampAnnotationLabelX", () => {
  // bbox convention matching fakeAnnU above: left=10, width=100 -> right=110.
  const LEFT = 10;
  const WIDTH = 100;

  it("left-anchors to the right of the dot when the label fits", () => {
    expect(clampAnnotationLabelX(50, 20, 6, LEFT, WIDTH)).toEqual({ x: 56, align: "left" });
  });

  it("flips to a right-anchor left of the dot when the right side would overflow", () => {
    // 105 + 6 + 40 = 151 > 110 (overflow right); 105 - 6 - 40 = 59 >= 10 (fits left).
    expect(clampAnnotationLabelX(105, 40, 6, LEFT, WIDTH)).toEqual({ x: 99, align: "right" });
  });

  it("clamps inward when the label overflows BOTH sides (wider than the panel)", () => {
    // A 200px label can't fit fully on either side of a 100px-wide panel from
    // a dot pinned at the very left edge -- clamp so its start stays visible
    // rather than bleeding off entirely.
    const { x, align } = clampAnnotationLabelX(LEFT, 200, 6, LEFT, WIDTH);
    expect(align).toBe("left");
    expect(x).toBe(LEFT); // right - textWidth (110-200=-90) clamps up to `left`
  });

  it("is exact at the boundary — fits exactly flush with the right edge", () => {
    // 50 + 6 + 54 = 110 === right: the <= boundary keeps it a normal left-anchor.
    expect(clampAnnotationLabelX(50, 54, 6, LEFT, WIDTH)).toEqual({ x: 56, align: "left" });
  });
});

describe("errorBarsPlugin (item 3: cap width defaults to zero)", () => {
  // x = [0, 1]; column 1's y = [10, 20], error magnitude = [2, 3]. Same
  // linear valToPos convention as fakeU (x identity, y: 100 - value).
  function draw(capHalfWidth?: number) {
    const segs: { from: [number, number]; to: [number, number] }[] = [];
    let pen: [number, number] = [0, 0];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      stroke() {},
      moveTo(x: number, y: number) {
        pen = [x, y];
      },
      lineTo(x: number, y: number) {
        segs.push({ from: pen, to: [x, y] });
      },
      strokeStyle: "",
      lineWidth: 0,
    };
    const valToPos = (v: number, scale: string) => (scale === "x" ? v : 100 - v);
    const u = {
      ctx,
      bbox: { left: 0, top: 0, width: 200, height: 100 },
      valToPos,
      data: [
        [0, 1],
        [10, 20],
      ],
      series: [{}, {}],
    };
    const errorsByCol = new Map<number, (number | null)[]>([[1, [2, 3]]]);
    const plugin =
      capHalfWidth === undefined
        ? errorBarsPlugin(errorsByCol, "#abc")
        : errorBarsPlugin(errorsByCol, "#abc", capHalfWidth);
    // @ts-expect-error — minimal stub stands in for a real uPlot instance
    plugin.hooks.draw?.(u);
    return segs;
  }

  it("draws only the vertical whisker (no cap cross-strokes) when no cap width is given", () => {
    const segs = draw();
    expect(segs).toHaveLength(2); // one vertical segment per point, no caps
    expect(segs[0]).toEqual({ from: [0, 92], to: [0, 88] }); // y±e = [8,12] -> pos [92,88]
  });

  it("still draws caps when a positive capHalfWidth is passed explicitly", () => {
    const segs = draw(3);
    expect(segs).toHaveLength(6); // vertical + 2 caps, per point, × 2 points
    // point 0's high cap: pHi = 88, spanning px ± 3
    expect(segs).toContainEqual({ from: [-3, 88], to: [3, 88] });
  });

  it("draws no caps when capHalfWidth is explicitly zero (same as the default)", () => {
    expect(draw(0)).toHaveLength(2);
  });
});

/** Stub recording fillRect + clip calls for the region-shade plugin. Same
 *  valToPos convention as fakeAnnU: "x" -> v, "y" -> 100 - v, "y2" -> 200 - v
 *  (a different offset so a test can tell which scale resolved). */
function fakeShadeU(hasY2 = false) {
  const rects: { x: number; y: number; w: number; h: number; fill: string; alpha: number }[] = [];
  let clipped = false;
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {
      clipped = true;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, fill: ctx.fillStyle, alpha: ctx.globalAlpha });
    },
    fillStyle: "",
    globalAlpha: 1,
  };
  const valToPos = (v: number, scale: string) =>
    scale === "x" ? v : scale === "y2" ? 200 - v : 100 - v;
  const scales = hasY2 ? { x: {}, y: {}, y2: {} } : { x: {}, y: {} };
  const u = { ctx, bbox: { left: 10, top: 5, width: 100, height: 80 }, valToPos, scales };
  return { u, rects, isClipped: () => clipped };
}

function drawShades(shades: RegionShade[], hasY2 = false) {
  const { u, rects, isClipped } = fakeShadeU(hasY2);
  const plugin = regionShadePlugin(shades);
  // @ts-expect-error — minimal stub stands in for a real uPlot instance
  plugin.hooks.drawClear?.(u);
  return { rects, isClipped };
}

describe("regionShadePlugin (Origin Rect* bands, decode-plan #41)", () => {
  it("fills each shade's rect at the fixed translucent alpha, clipped to the plot area", () => {
    const { rects, isClipped } = drawShades([
      { id: "s1", x1: 20, x2: 40, y1: 10, y2: 90, fill: "#FF8000" },
    ]);
    expect(isClipped()).toBe(true);
    expect(rects).toHaveLength(1);
    // x: 20..40 px; y: valToPos(90)=10 (top) .. valToPos(10)=90 (bottom).
    expect(rects[0]).toEqual({ x: 20, y: 10, w: 20, h: 80, fill: "#FF8000", alpha: REGION_SHADE_ALPHA });
  });

  it("draws in the drawClear hook (behind grid and data), not draw", () => {
    const plugin = regionShadePlugin([]);
    expect(plugin.hooks.drawClear).toBeDefined();
    expect(plugin.hooks.draw).toBeUndefined();
  });

  it("skips a shade with a non-finite extent", () => {
    const { rects } = drawShades([
      { id: "s1", x1: NaN, x2: 40, y1: 10, y2: 90, fill: "#FF8000" },
      { id: "s2", x1: 20, x2: 40, y1: 10, y2: 90, fill: "#0000FF" },
    ]);
    expect(rects).toHaveLength(1);
    expect(rects[0].fill).toBe("#0000FF");
  });

  it("maps an axis:1 shade through the y2 scale when the plot has one, and falls back otherwise", () => {
    const withY2 = drawShades([{ id: "s", x1: 0, x2: 10, y1: 10, y2: 90, axis: 1, fill: "#FF0000" }], true);
    // y2 scale: valToPos(90)=110 (top), valToPos(10)=190 -> height 80.
    expect(withY2.rects[0].y).toBe(110);
    const noY2 = drawShades([{ id: "s", x1: 0, x2: 10, y1: 10, y2: 90, axis: 1, fill: "#FF0000" }], false);
    expect(noY2.rects[0].y).toBe(10); // primary-scale fallback
  });
});

describe("colorScatterPlugin (MAIN #14)", () => {
  // x = [0, 1, 2]; column 1's y = [10, 20, 30]. Same linear valToPos
  // convention as fakeU (x identity, y: 100 - value).
  function draw(specs: Map<number, ColorScatterSpec>) {
    const dots: { x: number; y: number; fillStyle: string }[] = [];
    let fillStyle = "";
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      fill() {
        dots.push({ x: lastX, y: lastY, fillStyle });
      },
      arc(x: number, y: number) {
        lastX = x;
        lastY = y;
      },
      set fillStyle(v: string) {
        fillStyle = v;
      },
    };
    let lastX = 0;
    let lastY = 0;
    const valToPos = (v: number, scale: string) => (scale === "x" ? v : 100 - v);
    const u = {
      ctx,
      bbox: { left: 0, top: 0, width: 200, height: 100 },
      valToPos,
      data: [
        [0, 1, 2],
        [10, 20, 30],
      ],
      series: [{}, {}],
    };
    const plugin = colorScatterPlugin(specs);
    // @ts-expect-error — minimal stub stands in for a real uPlot instance
    plugin.hooks.draw?.(u);
    return dots;
  }

  it("draws one dot per finite (x,y) pair, coloured by the normalized z value", () => {
    const specs = new Map<number, ColorScatterSpec>([
      [1, { channel: 2, z: [0, 5, 10], colormap: "gray", lo: 0, hi: 10 }],
    ]);
    const dots = draw(specs);
    expect(dots).toHaveLength(3);
    expect(dots[0]).toEqual({ x: 0, y: 90, fillStyle: "rgb(0, 0, 0)" }); // t=0 -> gray[0,0,0]
    expect(dots[2]).toEqual({ x: 2, y: 70, fillStyle: "rgb(255, 255, 255)" }); // t=1 -> gray[255,255,255]
  });

  it("skips a row whose z is null", () => {
    const specs = new Map<number, ColorScatterSpec>([
      [1, { channel: 2, z: [0, null, 10], colormap: "gray", lo: 0, hi: 10 }],
    ]);
    expect(draw(specs)).toHaveLength(2);
  });

  it("draws nothing for an empty specs map", () => {
    expect(draw(new Map())).toHaveLength(0);
  });

  it("draws nothing for a column absent from u.data (out-of-range column index)", () => {
    const specs = new Map<number, ColorScatterSpec>([
      [5, { channel: 2, z: [0, 5, 10], colormap: "gray", lo: 0, hi: 10 }],
    ]);
    expect(draw(specs)).toHaveLength(0);
  });
});
