import { afterEach, describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { CLICK_PX } from "./pointGesture";
import type { Shape } from "./types";
import {
  defaultShapeOpacity,
  DEFAULT_SHAPE_WIDTH,
  resolveShapeFill,
  resolveShapeOpacity,
  resolveShapeStroke,
  shapeAnchorConversions,
  shapeDashArray,
  shapeLayout,
  shapesPlugin,
} from "./uplotShapes";

describe("resolveShapeOpacity / resolveShapeStroke / resolveShapeFill", () => {
  it("defaults to full opacity for line/arrow, 0.35 for rect/ellipse", () => {
    expect(defaultShapeOpacity("arrow")).toBe(1);
    expect(defaultShapeOpacity("line")).toBe(1);
    expect(defaultShapeOpacity("rect")).toBe(0.35);
    expect(defaultShapeOpacity("ellipse")).toBe(0.35);
  });

  it("resolveShapeOpacity uses the shape's own override when set", () => {
    expect(resolveShapeOpacity({ kind: "rect", opacity: 0.9 })).toBe(0.9);
    expect(resolveShapeOpacity({ kind: "rect" })).toBe(0.35);
  });

  it("stroke defaults to the plot ink color; fill defaults to the resolved stroke", () => {
    expect(resolveShapeStroke({}, "#eee")).toBe("#eee");
    expect(resolveShapeStroke({ stroke: "#f00" }, "#eee")).toBe("#f00");
    expect(resolveShapeFill({}, "#eee")).toBe("#eee");
    expect(resolveShapeFill({ stroke: "#f00" }, "#eee")).toBe("#f00");
    expect(resolveShapeFill({ stroke: "#f00", fill: "#0f0" }, "#eee")).toBe("#0f0");
  });

  it("shapeDashArray is empty for a solid stroke, a fixed pattern when dashed", () => {
    expect(shapeDashArray({})).toEqual([]);
    expect(shapeDashArray({ dash: false })).toEqual([]);
    expect(shapeDashArray({ dash: true })).toEqual([9, 5]);
  });
});

describe("shapeLayout (data vs page anchor)", () => {
  const u = {
    valToPos: (v: number, scale: string) => (scale === "x" ? v : 100 - v),
    ctx: { canvas: { width: 200, height: 100 } },
    bbox: { left: 0, top: 0, width: 200, height: 100 },
  } as unknown as Pick<uPlot, "valToPos" | "ctx" | "bbox">;

  it("resolves DATA-anchored (default) endpoints through valToPos", () => {
    const l = shapeLayout(u, { x1: 10, y1: 20, x2: 30, y2: 40 });
    expect(l).toEqual({ x1: 10, y1: 80, x2: 30, y2: 60 });
  });

  it("resolves PAGE-anchored endpoints as canvas fractions, bypassing valToPos entirely", () => {
    const l = shapeLayout(u, { x1: 0.25, y1: 0.5, x2: 0.75, y2: 0.9, anchor: "page" });
    expect(l).toEqual({ x1: 50, y1: 50, x2: 150, y2: 90 });
  });

  it("returns null for a non-finite endpoint", () => {
    expect(shapeLayout(u, { x1: Number.NaN, y1: 0, x2: 1, y2: 1 })).toBeNull();
  });
});

describe("shapeAnchorConversions (data<->page toggle round-trip)", () => {
  function makeU() {
    const root = document.createElement("div");
    const over = document.createElement("div");
    root.appendChild(over);
    document.body.appendChild(root);
    const conv = (v: number, scale: string) => (scale === "x" ? v : 100 - v); // self-inverse
    return {
      root,
      over,
      ctx: { canvas: { width: 100, height: 100 } },
      bbox: { left: 0, top: 0, width: 100, height: 100 },
      valToPos: conv,
      posToVal: conv,
    } as unknown as Pick<uPlot, "ctx" | "posToVal" | "valToPos" | "bbox" | "root" | "over">;
  }

  it("data -> page -> data lands within float tolerance of the original DATA coords", () => {
    const u = makeU();
    // A real DATA-anchored shape -> its canvas layout -> the page conversion.
    const dataShape = { x1: 20, y1: 30, x2: 40, y2: 50 };
    const layout1 = shapeLayout(u, dataShape)!;
    const conv1 = shapeAnchorConversions(u, layout1);

    // Adopt conv1.toPage as a fresh PAGE-anchored shape (the same "convert
    // in place" step the object-menu toggle performs) -> its OWN canvas
    // layout (the page branch) -> convert back.
    const pageShape = { ...conv1.toPage, anchor: "page" as const };
    const layout2 = shapeLayout(u, pageShape)!;
    const conv2 = shapeAnchorConversions(u, layout2);

    expect(conv2.toData.x1).toBeCloseTo(dataShape.x1, 9);
    expect(conv2.toData.y1).toBeCloseTo(dataShape.y1, 9);
    expect(conv2.toData.x2).toBeCloseTo(dataShape.x2, 9);
    expect(conv2.toData.y2).toBeCloseTo(dataShape.y2, 9);
  });
});

/** Minimal canvas-recording stub for the draw pass — records the calls each
 *  shape kind makes so a test can assert the RIGHT primitive fired without
 *  needing a real <canvas>. */
function fakeDrawU() {
  const calls: string[] = [];
  const rects: { x: number; y: number; w: number; h: number; kind: string }[] = [];
  const segs: { from: [number, number]; to: [number, number] }[] = [];
  let pen: [number, number] = [0, 0];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    fill() {
      calls.push("fill");
    },
    stroke() {
      calls.push("stroke");
    },
    setLineDash() {},
    moveTo(x: number, y: number) {
      pen = [x, y];
    },
    lineTo(x: number, y: number) {
      segs.push({ from: pen, to: [x, y] });
      pen = [x, y];
    },
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, kind: "fill" });
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, kind: "stroke" });
    },
    ellipse() {
      calls.push("ellipse");
    },
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
  };
  const valToPos = (v: number, scale: string) => (scale === "x" ? v : 100 - v);
  const u = { ctx, bbox: { left: 0, top: 0, width: 100, height: 100 }, valToPos };
  return { u, calls, rects, segs };
}

describe("shapesPlugin — draw pass", () => {
  const draw = (shapes: Shape[]) => {
    const { u, calls, rects, segs } = fakeDrawU();
    const plugin = shapesPlugin(shapes, "#eee");
    // @ts-expect-error — minimal stub stands in for a real uPlot instance
    plugin.hooks.draw?.(u);
    return { calls, rects, segs };
  };

  it("draws a line as a single stroked segment, no fill", () => {
    const { calls, segs } = draw([{ id: "s1", kind: "line", x1: 0, y1: 0, x2: 10, y2: 0 }]);
    expect(segs).toEqual([{ from: [0, 100], to: [10, 100] }]);
    expect(calls).toContain("stroke");
    expect(calls).not.toContain("fill");
  });

  it("draws an arrow as a stroked shaft PLUS a filled arrowhead", () => {
    const { calls } = draw([{ id: "s1", kind: "arrow", x1: 0, y1: 0, x2: 10, y2: 0 }]);
    expect(calls).toContain("stroke");
    expect(calls).toContain("fill"); // the arrowhead triangle
  });

  it("draws a rect as BOTH a fillRect and a strokeRect at the same bounds", () => {
    // valToPos: y -> 100-y, so y1=2 -> py=98, y2=90 -> py=10 -> [10,98], h=88.
    const { rects } = draw([{ id: "s1", kind: "rect", x1: 2, y1: 2, x2: 8, y2: 90 }]);
    expect(rects).toEqual([
      { x: 2, y: 10, w: 6, h: 88, kind: "fill" },
      { x: 2, y: 10, w: 6, h: 88, kind: "stroke" },
    ]);
  });

  it("normalizes a 'backwards' rect (x1>x2, y1>y2) to the min corner + positive extents", () => {
    const { rects } = draw([{ id: "s1", kind: "rect", x1: 8, y1: 90, x2: 2, y2: 2 }]);
    expect(rects[0]).toMatchObject({ x: 2, y: 10, w: 6, h: 88 });
  });

  it("draws an ellipse via ctx.ellipse, filled and stroked", () => {
    const { calls } = draw([{ id: "s1", kind: "ellipse", x1: 0, y1: 0, x2: 10, y2: 10 }]);
    expect(calls).toContain("ellipse");
    expect(calls).toContain("fill");
    expect(calls).toContain("stroke");
  });

  it("skips a shape with a non-finite endpoint", () => {
    const { calls } = draw([{ id: "s1", kind: "line", x1: NaN, y1: 0, x2: 1, y2: 1 }]);
    expect(calls).toEqual([]);
  });
});

// Pointer-mode interactive gesture contract (MAIN #27), driven through jsdom
// mouse events on a stubbed uPlot — the SAME makeU/ready/mouse idiom
// uplotOverlays.test.ts's annotationPlugin pointer-mode block uses.
function makeInteractiveU() {
  const root = document.createElement("div");
  const over = document.createElement("div");
  root.appendChild(over);
  document.body.appendChild(root);
  const ctx = { canvas: { width: 100, height: 100 } };
  const conv = (v: number, scale: string) => (scale === "x" ? v : 100 - v); // self-inverse
  const u = {
    root,
    over,
    ctx,
    bbox: { left: 0, top: 0, width: 100, height: 100 },
    valToPos: conv,
    posToVal: conv,
    redraw: vi.fn(),
  } as unknown as uPlot;
  return { u, root, over };
}

function ready(plugin: uPlot.Plugin, u: uPlot) {
  (plugin.hooks.ready as (u: uPlot) => void)(u);
}

const mouse = (type: string, x: number, y: number) =>
  new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shapesPlugin — DRAW-NEW-SHAPE mode", () => {
  const shape = (): Shape => ({ id: "s1", kind: "rect", x1: 1, y1: 1, x2: 2, y2: 2 });

  it("a non-drawing, non-interactive instance attaches no listeners", () => {
    const plugin = shapesPlugin([shape()], "#eee");
    expect(plugin.hooks.ready).toBeUndefined();
  });

  it("dragging past CLICK_PX commits a new shape at the dragged extent", () => {
    const { u, root } = makeInteractiveU();
    const onDrawCommit = vi.fn();
    const plugin = shapesPlugin([], "#eee", { drawKind: "rect", onDrawCommit });
    ready(plugin, u);
    root.dispatchEvent(mouse("mousedown", 10, 10));
    document.dispatchEvent(mouse("mousemove", 10 + CLICK_PX + 5, 10 + CLICK_PX + 5));
    document.dispatchEvent(mouse("mouseup", 10 + CLICK_PX + 5, 10 + CLICK_PX + 5));
    expect(onDrawCommit).toHaveBeenCalledTimes(1);
    const [kind, x1, y1, x2, y2] = onDrawCommit.mock.calls[0];
    expect(kind).toBe("rect");
    // x: identity -> 10 then 10+CLICK_PX+5; y: 100-value, so a downward drag
    // (larger clientY) DECREASES the data-y.
    expect(x1).toBe(10);
    expect(x2).toBe(10 + CLICK_PX + 5);
    expect(y1).toBe(90);
    expect(y2).toBe(90 - (CLICK_PX + 5));
  });

  it("a plain click (no drag) for a real shape kind commits nothing", () => {
    const { u, root } = makeInteractiveU();
    const onDrawCommit = vi.fn();
    const plugin = shapesPlugin([], "#eee", { drawKind: "arrow", onDrawCommit });
    ready(plugin, u);
    root.dispatchEvent(mouse("mousedown", 10, 10));
    document.dispatchEvent(mouse("mouseup", 11, 10)); // < CLICK_PX travel
    expect(onDrawCommit).not.toHaveBeenCalled();
  });

  it("'textbox' commits on ANY click, even zero movement, as a degenerate point", () => {
    const { u, root } = makeInteractiveU();
    const onDrawCommit = vi.fn();
    const plugin = shapesPlugin([], "#eee", { drawKind: "textbox", onDrawCommit });
    ready(plugin, u);
    root.dispatchEvent(mouse("mousedown", 30, 20));
    document.dispatchEvent(mouse("mouseup", 30, 20)); // zero movement
    expect(onDrawCommit).toHaveBeenCalledTimes(1);
    const [kind, x1, y1, x2, y2] = onDrawCommit.mock.calls[0];
    expect(kind).toBe("textbox");
    expect(x1).toBe(x2);
    expect(y1).toBe(y2);
  });

  it("draw mode takes priority over select/edit even when a shape already exists there", () => {
    const { u, root } = makeInteractiveU();
    const onSelect = vi.fn();
    const onDrawCommit = vi.fn();
    const plugin = shapesPlugin([shape()], "#eee", {
      interactive: true,
      selectedId: null,
      onSelect,
      drawKind: "line",
      onDrawCommit,
    });
    ready(plugin, u);
    // (1,1) in data coords is right where `shape()` sits (px=1, py=99).
    root.dispatchEvent(mouse("mousedown", 1, 99));
    document.dispatchEvent(mouse("mousemove", 1 + CLICK_PX + 2, 99));
    document.dispatchEvent(mouse("mouseup", 1 + CLICK_PX + 2, 99));
    expect(onDrawCommit).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("shapesPlugin — SELECT/EDIT mode", () => {
  const rect = (): Shape => ({ id: "s1", kind: "rect", x1: 10, y1: 10, x2: 30, y2: 30 });

  it("click on empty canvas calls onSelect(null)", () => {
    const { u, root } = makeInteractiveU();
    const onSelect = vi.fn();
    const plugin = shapesPlugin([rect()], "#eee", { interactive: true, selectedId: null, onSelect });
    ready(plugin, u);
    root.dispatchEvent(mouse("mousedown", 90, 90));
    document.dispatchEvent(mouse("mouseup", 91, 90)); // < CLICK_PX travel
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("mousedown on a shape's body selects it without committing a move", () => {
    const { u, root } = makeInteractiveU();
    const onSelect = vi.fn();
    const onMove = vi.fn();
    // px=10,py=90 (edge of the rect: x1=10 maps to px=10, y1=10 -> py=90).
    const plugin = shapesPlugin([rect()], "#eee", { interactive: true, selectedId: null, onSelect, onMove });
    ready(plugin, u);
    root.dispatchEvent(mouse("mousedown", 10, 90));
    document.dispatchEvent(mouse("mouseup", 10, 90)); // no movement -> a plain click
    expect(onSelect).toHaveBeenCalledWith("s1");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("dragging a shape's body commits onMove ONCE with all four endpoints shifted by the same delta", () => {
    const { u, root } = makeInteractiveU();
    const onMove = vi.fn();
    const plugin = shapesPlugin([rect()], "#eee", {
      interactive: true,
      selectedId: null,
      onSelect: vi.fn(),
      onMove,
    });
    ready(plugin, u);
    root.dispatchEvent(mouse("mousedown", 10, 90)); // on the rect's left edge
    document.dispatchEvent(mouse("mousemove", 10 + CLICK_PX + 4, 90));
    document.dispatchEvent(mouse("mouseup", 10 + CLICK_PX + 4, 90));
    expect(onMove).toHaveBeenCalledTimes(1);
    const [id, x1, y1, x2, y2] = onMove.mock.calls[0];
    expect(id).toBe("s1");
    const dx = CLICK_PX + 4;
    expect(x1).toBe(10 + dx);
    expect(x2).toBe(30 + dx);
    expect(y1).toBe(10); // no vertical travel
    expect(y2).toBe(30);
  });

  it("dragging the selected shape's corner handle commits onReshape ONCE, patching only that corner's fields", () => {
    const { u, root } = makeInteractiveU();
    const onReshape = vi.fn();
    const plugin = shapesPlugin([rect()], "#eee", {
      interactive: true,
      selectedId: "s1",
      onSelect: vi.fn(),
      onReshape,
    });
    ready(plugin, u);
    // Corner handle 0 = (x1,y1) -> canvas px (10, 90).
    root.dispatchEvent(mouse("mousedown", 10, 90));
    document.dispatchEvent(mouse("mousemove", 10 + CLICK_PX + 6, 90));
    document.dispatchEvent(mouse("mouseup", 10 + CLICK_PX + 6, 90));
    expect(onReshape).toHaveBeenCalledTimes(1);
    const [id, patch] = onReshape.mock.calls[0];
    expect(id).toBe("s1");
    expect(patch).toMatchObject({ x1: 10 + CLICK_PX + 6, y1: 10 });
    expect(patch).not.toHaveProperty("x2");
    expect(patch).not.toHaveProperty("y2");
  });

  it("a plain click on the handle (no drag) commits nothing", () => {
    const { u, root } = makeInteractiveU();
    const onReshape = vi.fn();
    const plugin = shapesPlugin([rect()], "#eee", {
      interactive: true,
      selectedId: "s1",
      onSelect: vi.fn(),
      onReshape,
    });
    ready(plugin, u);
    root.dispatchEvent(mouse("mousedown", 10, 90));
    document.dispatchEvent(mouse("mouseup", 10, 90));
    expect(onReshape).not.toHaveBeenCalled();
  });

  it("right-click on a shape selects it and opens the object menu with a data<->page conv", () => {
    const { u, root } = makeInteractiveU();
    const onContextMenu = vi.fn();
    const onSelect = vi.fn();
    const plugin = shapesPlugin([rect()], "#eee", {
      interactive: true,
      selectedId: null,
      onSelect,
      onContextMenu,
    });
    ready(plugin, u);
    const notPrevented = root.dispatchEvent(mouse("contextmenu", 10, 90));
    expect(onSelect).toHaveBeenCalledWith("s1");
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const [id, clientX, clientY, conv] = onContextMenu.mock.calls[0];
    expect(id).toBe("s1");
    expect(clientX).toBe(10);
    expect(clientY).toBe(90);
    expect(conv.toPage).toBeDefined();
    expect(conv.toData).toBeDefined();
    expect(notPrevented).toBe(false); // preventDefault() was called
  });

  it("right-click on empty canvas leaves the default menu alone", () => {
    const { u, root } = makeInteractiveU();
    const onContextMenu = vi.fn();
    const plugin = shapesPlugin([rect()], "#eee", {
      interactive: true,
      selectedId: null,
      onSelect: vi.fn(),
      onContextMenu,
    });
    ready(plugin, u);
    const notPrevented = root.dispatchEvent(mouse("contextmenu", 90, 5));
    expect(onContextMenu).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });
});

describe("DEFAULT_SHAPE_WIDTH", () => {
  it("is a positive hairline default", () => {
    expect(DEFAULT_SHAPE_WIDTH).toBeGreaterThan(0);
  });
});
