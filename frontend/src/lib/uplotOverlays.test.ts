import { afterEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import type { ColorScatterSpec } from "./colorscatter";
import type { Annotation, RefLine } from "./types";
import {
  annotationAnchorConversions,
  annotationBox,
  annotationFont,
  annotationLayout,
  annotationPlugin,
  canvasPxToPageXY,
  clampAnnotationLabelX,
  clampAnnotationSize,
  clampPageXY,
  colorScatterPlugin,
  errorBarsPlugin,
  MAX_ANNOTATION_SIZE,
  MIN_ANNOTATION_SIZE,
  pageXYToCanvasPx,
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
  const raw = { ctx, bbox: { left: 10, top: 5, width: 100, height: 80 }, valToPos, scales };
  // Cast once here (not per call site): `annotationLayout` below only needs
  // this Pick<uPlot, ...> subset and type-checks it for real, unlike the
  // plugin.hooks.draw?.(u) calls elsewhere in this file, which stand in for
  // the FULL uPlot type and so still need their own @ts-expect-error.
  const u = raw as unknown as Pick<uPlot, "valToPos" | "ctx" | "bbox" | "scales">;
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
    // Dot at py=6 -> naive py-2=4 < lineHeight, so the clamp pushes the
    // baseline down to the CANVAS-top floor (fontPx("11px mono") * 1.3 =
    // 14.3). Margin placement is legal since 2026-07-11 (labels may live
    // outside the axes bbox), so the floor is the canvas, not bbox top.
    const { texts } = drawAnn([{ id: "a1", x: 50, y: 94, text: "top" }]); // 100-94=6
    expect(texts[0].y).toBeCloseTo(14.3);
  });

  it("clips annotations outside the CANVAS (not the axes bbox)", () => {
    const { dots } = drawAnn([
      { id: "a", x: 999, y: 30, text: "off-x" },
      { id: "b", x: 50, y: -50, text: "off-y" }, // py = 150 > canvas bottom
    ]);
    expect(dots).toHaveLength(0);
  });

  it("REGRESSION 2026-07-11: a margin-placed annotation (outside the bbox, on the canvas) still draws", () => {
    // bbox left=10: px=4 sits in the left axes margin. Dragging a label there
    // used to make it vanish (the old clip tested the bbox, not the canvas).
    const { dots, texts } = drawAnn([{ id: "m", x: 4, y: 30, text: "700 mT" }]);
    expect(dots).toHaveLength(1);
    expect(texts).toHaveLength(1);
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

describe("annotationFont / clampAnnotationSize (MAIN #18)", () => {
  it("substitutes the leading px size, keeping the font family", () => {
    expect(annotationFont("11px monospace", 24)).toBe("24px monospace");
  });

  it("returns the base font unchanged when size is absent or zero", () => {
    expect(annotationFont("11px monospace")).toBe("11px monospace");
    expect(annotationFont("11px monospace", 0)).toBe("11px monospace");
  });

  it("clamps to [MIN_ANNOTATION_SIZE, MAX_ANNOTATION_SIZE] and rounds", () => {
    expect(clampAnnotationSize(3)).toBe(MIN_ANNOTATION_SIZE);
    expect(clampAnnotationSize(999)).toBe(MAX_ANNOTATION_SIZE);
    expect(clampAnnotationSize(24.6)).toBe(25);
  });
});

describe("annotationLayout / annotationBox (MAIN #18 shared draw/hit-test geometry)", () => {
  it("matches the draw loop's own px/py/tx/align math for a plain annotation", () => {
    const { u } = fakeAnnU();
    const layout = annotationLayout(u, { id: "a1", x: 50, y: 30, text: "Tc" }, "11px mono");
    expect(layout).not.toBeNull();
    expect(layout!.px).toBe(50);
    expect(layout!.py).toBe(70); // y valToPos: 100-30
    expect(layout!.align).toBe("left");
    expect(layout!.tx).toBe(56); // px + 6 offset
  });

  it("returns null for a non-finite annotation (same skip the draw loop applies)", () => {
    const { u } = fakeAnnU();
    expect(annotationLayout(u, { id: "a", x: Number.NaN, y: 1, text: "x" }, "11px mono")).toBeNull();
  });

  it("a larger `size` increases the computed line height", () => {
    const { u } = fakeAnnU();
    const small = annotationLayout(u, { id: "a", x: 50, y: 30, text: "Tc" }, "11px mono")!;
    const big = annotationLayout(u, { id: "a", x: 50, y: 30, text: "Tc", size: 40 }, "11px mono")!;
    expect(big.lineHeight).toBeGreaterThan(small.lineHeight);
  });

  it("derives a left-anchored box starting at tx, right-anchored ending at tx", () => {
    const { u } = fakeAnnU();
    const left = annotationLayout(u, { id: "a", x: 50, y: 30, text: "Tc" }, "11px mono")!;
    const leftBox = annotationBox(left);
    expect(leftBox).toEqual({ left: 56, top: left.ty - left.lineHeight, width: 12, height: left.lineHeight });

    const right = annotationLayout(u, { id: "a", x: 105, y: 30, text: "a fourteen chr" }, "11px mono")!;
    const rightBox = annotationBox(right);
    expect(rightBox.left + rightBox.width).toBe(right.tx);
  });
});

describe("canvasPxToPageXY / pageXYToCanvasPx / clampPageXY (MAIN #21 page-anchor geometry)", () => {
  it("round-trips a canvas pixel through the page fraction and back", () => {
    const page = canvasPxToPageXY(37, 88, 200, 100);
    expect(page).toEqual({ x: 0.185, y: 0.88 });
    expect(pageXYToCanvasPx(page, 200, 100)).toEqual({ x: 37, y: 88 });
  });

  it("clamps an out-of-canvas pixel into [0, 1] rather than returning a negative/>1 fraction", () => {
    expect(canvasPxToPageXY(-50, 500, 100, 100)).toEqual({ x: 0, y: 1 });
  });

  it("returns {0, 0} for a degenerate (zero/negative) canvas instead of dividing by zero", () => {
    expect(canvasPxToPageXY(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("clampPageXY keeps the fraction's canvas pixel `pad` px inside the edges", () => {
    // canvas 100x100, pad=6 -> valid fraction range [0.06, 0.94] on both axes.
    expect(clampPageXY(-0.5, 1.5, 100, 100)).toEqual({ x: 0.06, y: 0.94 });
    expect(clampPageXY(0.5, 0.5, 100, 100)).toEqual({ x: 0.5, y: 0.5 }); // untouched mid-canvas
  });

  it("clampPageXY is a no-op (returns the fraction unchanged) on a degenerate canvas", () => {
    expect(clampPageXY(2, -3, 0, 0)).toEqual({ x: 2, y: -3 });
  });
});

describe("annotationLayout — page anchor (MAIN #21)", () => {
  /** A minimal annotationLayout stub with an explicit (or absent) canvas —
   *  same shape as fakeAnnU above, but lets a test control canvas dims
   *  independently of bbox to distinguish the page branch's canvas-fraction
   *  math from the data branch's valToPos math. */
  function fakePageU(canvas?: { width: number; height: number }) {
    const ctx = {
      font: "",
      measureText: (t: string) => ({ width: t.length * 6 }) as TextMetrics,
      ...(canvas ? { canvas } : {}),
    };
    const valToPos = (v: number, scale: string) => (scale === "x" ? v : 100 - v);
    const raw = {
      ctx,
      bbox: { left: 10, top: 5, width: 100, height: 80 },
      valToPos,
      scales: { x: {}, y: {} },
    };
    return raw as unknown as Pick<uPlot, "valToPos" | "ctx" | "bbox" | "scales">;
  }

  it("resolves x/y as CANVAS FRACTIONS, not data coords, when anchor is 'page'", () => {
    const u = fakePageU({ width: 200, height: 100 });
    const layout = annotationLayout(u, { id: "p1", x: 0.25, y: 0.5, text: "pk", anchor: "page" }, "11px mono")!;
    expect(layout.px).toBe(50); // 0.25 * 200
    expect(layout.py).toBe(50); // 0.5 * 100
  });

  it("never calls valToPos for a page annotation (x/y bypass the axis scale entirely)", () => {
    const u = fakePageU({ width: 100, height: 100 });
    // 0.9/0.1 would be off-scale nonsense as DATA coords under this stub's
    // valToPos (100-0.1=99.9), but as PAGE fractions they're a plain *canvas.
    const layout = annotationLayout(u, { id: "p1", x: 0.9, y: 0.1, text: "pk", anchor: "page" }, "11px mono")!;
    expect(layout.px).toBe(90);
    expect(layout.py).toBe(10);
  });

  it("falls back to the bbox-derived extents for a canvas-less stub context", () => {
    const u = fakePageU(); // no ctx.canvas at all
    const layout = annotationLayout(u, { id: "p1", x: 0.5, y: 0.5, text: "pk", anchor: "page" }, "11px mono")!;
    // canvasW fallback = bbox.left + bbox.width = 110; canvasH fallback =
    // bbox.top + bbox.height = 85 (the same fallback idiom the label-clamp
    // and draw-loop visibility bound already use).
    expect(layout.px).toBe(55);
    expect(layout.py).toBe(42.5);
  });

  it("an absent/'data' anchor is untouched — still resolves through valToPos", () => {
    const u = fakePageU({ width: 200, height: 100 });
    const layout = annotationLayout(u, { id: "d1", x: 50, y: 30, text: "Tc" }, "11px mono")!;
    expect(layout.px).toBe(50);
    expect(layout.py).toBe(70); // 100 - 30, unaffected by the 200x100 canvas
  });
});

// MAIN #21: the toggle conversion (annotationAnchorConversions) — round-trip
// through the interactive harness's fake valToPos/posToVal (both driven by
// the SAME `makeInteractiveU` helper the pointer-mode describe block below
// defines; `function` declarations hoist, so this describe block can use it
// even though it's textually declared later in the file).
describe("annotationAnchorConversions — data<->page toggle round-trip (MAIN #21)", () => {
  it("data -> page -> data lands within float tolerance of the original data coords", () => {
    const { u } = makeInteractiveU();
    const dataAnn: Annotation = { id: "a1", x: 37, y: 12, text: "Tc" };
    const layout1 = annotationLayout(u, dataAnn, "11px mono")!;
    const conv1 = annotationAnchorConversions(u, dataAnn, layout1);

    // Adopt conv1.toPage as a fresh page-anchored annotation — the same
    // "convert in place" step the object-menu toggle performs.
    const pageAnn: Annotation = { ...dataAnn, anchor: "page", x: conv1.toPage.x, y: conv1.toPage.y };
    const layout2 = annotationLayout(u, pageAnn, "11px mono")!;
    const conv2 = annotationAnchorConversions(u, pageAnn, layout2);

    expect(conv2.toData.x).toBeCloseTo(dataAnn.x, 9);
    expect(conv2.toData.y).toBeCloseTo(dataAnn.y, 9);
  });

  it("page -> data -> page lands within float tolerance of the original page fraction", () => {
    const { u } = makeInteractiveU();
    const pageAnn: Annotation = { id: "p1", x: 0.2, y: 0.8, text: "field", anchor: "page" };
    const layout1 = annotationLayout(u, pageAnn, "11px mono")!;
    const conv1 = annotationAnchorConversions(u, pageAnn, layout1);

    const dataAnn: Annotation = { ...pageAnn, anchor: "data", x: conv1.toData.x, y: conv1.toData.y };
    const layout2 = annotationLayout(u, dataAnn, "11px mono")!;
    const conv2 = annotationAnchorConversions(u, dataAnn, layout2);

    expect(conv2.toPage.x).toBeCloseTo(pageAnn.x, 9);
    expect(conv2.toPage.y).toBeCloseTo(pageAnn.y, 9);
  });
});

// Pointer-mode interactive gesture contract (MAIN #18), driven through jsdom
// mouse events on a stubbed uPlot — the SAME `makeU`/`ready`/`mouse` idiom
// uplotAnchors.test.ts uses for anchorEditPlugin. `over`'s getBoundingClientRect
// is jsdom's default all-zero rect (no real layout engine), so client coords
// ARE local coords here, same assumption uplotAnchors.test.ts relies on.
function makeInteractiveU() {
  // root wraps over (the real uPlot DOM shape): interaction listeners live on
  // root since 2026-07-11 so margin-placed labels stay reachable; events
  // dispatched on `over` bubble up to it.
  const root = document.createElement("div");
  const over = document.createElement("div");
  root.appendChild(over);
  document.body.appendChild(root);
  const ctx = {
    font: "",
    canvas: { width: 100, height: 100 },
    measureText: (t: string) => ({ width: t.length * 6 }) as TextMetrics,
  };
  // x: identity; y: 100 - value — self-inverse, so posToVal reuses the same
  // formula (valid for this convention only, matching fakeAnnU above).
  const conv = (v: number, scale: string) => (scale === "x" ? v : 100 - v);
  const u = {
    root,
    over,
    ctx,
    bbox: { left: 0, top: 0, width: 100, height: 100 },
    scales: { x: {}, y: {} },
    valToPos: conv,
    posToVal: conv,
    redraw: vi.fn(),
    setData: vi.fn(),
  } as unknown as uPlot;
  return { u, over, root };
}

function readyAnn(plugin: uPlot.Plugin, u: uPlot) {
  (plugin.hooks.ready as (u: uPlot) => void)(u);
}

const annMouse = (type: string, x: number, y: number) =>
  new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("annotationPlugin — pointer-mode interactive (MAIN #18)", () => {
  const ann = (over: Partial<Annotation> = {}): Annotation => ({ id: "a1", x: 50, y: 30, text: "Tc", ...over });

  it("a non-interactive instance (opts.interactive absent, every pre-#18 call site) attaches no listeners", () => {
    const plugin = annotationPlugin([ann()], "#fff", "11px mono");
    expect(plugin.hooks.ready).toBeUndefined();
  });

  it("click on empty canvas calls onSelect(null) — box zoom passes through untouched", () => {
    const { u, over } = makeInteractiveU();
    const onSelect = vi.fn();
    const plugin = annotationPlugin([ann()], "#fff", "11px mono", { interactive: true, selectedId: null, onSelect });
    readyAnn(plugin, u);
    over.dispatchEvent(annMouse("mousedown", 5, 5));
    document.dispatchEvent(annMouse("mouseup", 6, 5)); // < CLICK_PX travel
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("mousedown on an annotation's dot selects it without committing a move", () => {
    const { u, over } = makeInteractiveU();
    const onSelect = vi.fn();
    const onMove = vi.fn();
    const plugin = annotationPlugin([ann()], "#fff", "11px mono", {
      interactive: true,
      selectedId: null,
      onSelect,
      onMove,
    });
    readyAnn(plugin, u);
    over.dispatchEvent(annMouse("mousedown", 50, 70)); // dot: px=50, py=100-30=70
    document.dispatchEvent(annMouse("mouseup", 50, 70)); // no movement — a plain click
    expect(onSelect).toHaveBeenCalledWith("a1");
    expect(onMove).not.toHaveBeenCalled(); // select-only click is not a no-op move commit
  });

  it("dragging an annotation commits onMove ONCE with the delta-based released position", () => {
    const { u, over } = makeInteractiveU();
    const onMove = vi.fn();
    const plugin = annotationPlugin([ann()], "#fff", "11px mono", {
      interactive: true,
      selectedId: null,
      onSelect: vi.fn(),
      onMove,
    });
    readyAnn(plugin, u);
    over.dispatchEvent(annMouse("mousedown", 50, 70));
    document.dispatchEvent(annMouse("mousemove", 58, 70));
    document.dispatchEvent(annMouse("mousemove", 60, 70));
    document.dispatchEvent(annMouse("mouseup", 60, 70));
    expect(onMove).toHaveBeenCalledTimes(1);
    // x: posToVal(60)-posToVal(50) = 10 -> 50+10 = 60; y: no vertical travel -> 30
    expect(onMove).toHaveBeenCalledWith("a1", 60, 30);
  });

  // MAIN #21: a page-anchored annotation has no data scale to drag through —
  // the delta accumulates in CANVAS px (divided by canvas dims) instead of
  // posToVal's data-space delta. makeInteractiveU's canvas is 100x100 and
  // its root/over rects are jsdom's default all-zero (scale 1), so CSS px
  // deltas here equal canvas-px deltas directly (same identity the existing
  // data-anchor drag test above already relies on).
  it("dragging a PAGE-anchored annotation commits FRACTION coords, not data coords", () => {
    const { u, over } = makeInteractiveU();
    const onMove = vi.fn();
    const plugin = annotationPlugin([ann({ x: 0.5, y: 0.5, anchor: "page" })], "#fff", "11px mono", {
      interactive: true,
      selectedId: null,
      onSelect: vi.fn(),
      onMove,
    });
    readyAnn(plugin, u);
    over.dispatchEvent(annMouse("mousedown", 50, 50)); // dot: 0.5 * 100 canvas px
    document.dispatchEvent(annMouse("mousemove", 60, 50));
    document.dispatchEvent(annMouse("mouseup", 60, 50));
    expect(onMove).toHaveBeenCalledTimes(1);
    // dx = (60-50)/canvasWidth(100) = 0.1 -> 0.5+0.1 = 0.6; y untouched.
    expect(onMove).toHaveBeenCalledWith("a1", 0.6, 0.5);
  });

  it("clamps a dragged PAGE annotation's fraction so its canvas pixel stays on-canvas", () => {
    const { u, over } = makeInteractiveU();
    const onMove = vi.fn();
    const plugin = annotationPlugin([ann({ x: 0.5, y: 0.5, anchor: "page" })], "#fff", "11px mono", {
      interactive: true,
      selectedId: null,
      onSelect: vi.fn(),
      onMove,
    });
    readyAnn(plugin, u);
    over.dispatchEvent(annMouse("mousedown", 50, 50));
    document.dispatchEvent(annMouse("mousemove", 500, 50)); // way past the right edge
    document.dispatchEvent(annMouse("mouseup", 500, 50));
    expect(onMove).toHaveBeenCalledTimes(1);
    // clampPageXY's default pad=6 on a 100px canvas -> hi = 1 - 6/100 = 0.94.
    expect(onMove).toHaveBeenCalledWith("a1", 0.94, 0.5);
  });

  it("a second mousedown on the SAME annotation within the double-click window edits text, not a drag", () => {
    const { u, over } = makeInteractiveU();
    const onEditText = vi.fn();
    const onMove = vi.fn();
    const plugin = annotationPlugin([ann()], "#fff", "11px mono", {
      interactive: true,
      selectedId: null,
      onSelect: vi.fn(),
      onMove,
      onEditText,
    });
    readyAnn(plugin, u);
    over.dispatchEvent(annMouse("mousedown", 50, 70));
    document.dispatchEvent(annMouse("mouseup", 50, 70));
    over.dispatchEvent(annMouse("mousedown", 50, 70)); // immediately after — a double-click
    document.dispatchEvent(annMouse("mouseup", 50, 70));
    expect(onEditText).toHaveBeenCalledWith("a1");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("dragging the selected annotation's corner handle commits onResize ONCE, clamped to MAX_ANNOTATION_SIZE", () => {
    const { u, over } = makeInteractiveU();
    const onResize = vi.fn();
    const plugin = annotationPlugin([ann()], "#fff", "11px mono", {
      interactive: true,
      selectedId: "a1",
      onSelect: vi.fn(),
      onResize,
    });
    readyAnn(plugin, u);
    // Handle sits at the label box's bottom-right corner: px=50,py=70,
    // tx=56 (align left, "Tc"=12px wide), lineHeight=fontPx("11px mono")*1.3=14.3,
    // ty=max(py-2,top+lineHeight)=68 -> box {left:56,top:53.7,width:12,height:14.3}
    // -> handle (68, 68).
    over.dispatchEvent(annMouse("mousedown", 68, 68));
    document.dispatchEvent(annMouse("mousemove", 68, 468)); // large downward drag -> clamps
    document.dispatchEvent(annMouse("mouseup", 68, 468));
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith("a1", MAX_ANNOTATION_SIZE);
  });

  it("a plain click on the handle (no drag) commits nothing", () => {
    const { u, over } = makeInteractiveU();
    const onResize = vi.fn();
    const plugin = annotationPlugin([ann()], "#fff", "11px mono", {
      interactive: true,
      selectedId: "a1",
      onSelect: vi.fn(),
      onResize,
    });
    readyAnn(plugin, u);
    over.dispatchEvent(annMouse("mousedown", 68, 68));
    document.dispatchEvent(annMouse("mouseup", 68, 68));
    expect(onResize).not.toHaveBeenCalled();
  });

  it("right-click on an annotation selects it and opens the object menu, suppressing the plot's own menu", () => {
    const { u, over } = makeInteractiveU();
    const onContextMenu = vi.fn();
    const onSelect = vi.fn();
    const plugin = annotationPlugin([ann()], "#fff", "11px mono", {
      interactive: true,
      selectedId: null,
      onSelect,
      onContextMenu,
    });
    readyAnn(plugin, u);
    const ev = annMouse("contextmenu", 50, 70);
    const notPrevented = over.dispatchEvent(ev); // false when preventDefault() was called
    expect(onSelect).toHaveBeenCalledWith("a1");
    // MAIN #21: the 4th arg is the precomputed data<->page conversion for
    // THIS annotation's current position (dot at canvas px 50,70 in a
    // 100x100 canvas, all-zero jsdom rects -> scale 1) — toData recovers the
    // annotation's own (data-anchored) x/y exactly, the same round-trip
    // `annotationAnchorConversions`'s own describe block verifies directly.
    expect(onContextMenu).toHaveBeenCalledWith("a1", 50, 70, {
      toPage: { x: 0.5, y: 0.7 },
      toData: { x: 50, y: 30 },
    });
    expect(notPrevented).toBe(false);
  });

  it("right-click on empty canvas leaves the default menu alone", () => {
    const { u, over } = makeInteractiveU();
    const onContextMenu = vi.fn();
    const plugin = annotationPlugin([ann()], "#fff", "11px mono", {
      interactive: true,
      selectedId: null,
      onSelect: vi.fn(),
      onContextMenu,
    });
    readyAnn(plugin, u);
    const notPrevented = over.dispatchEvent(annMouse("contextmenu", 5, 5));
    expect(onContextMenu).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });
});
