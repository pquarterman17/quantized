// previewDrag — direct unit tests for dragPreviewElement's panel-aware
// resolution (FU-facet-hitmap fix round 2, G2). Constructs a two-panel
// facet hitmap by hand so the cross-panel shape-drag guard is exercised
// WITHOUT waiting for the backend to ever emit a real `shape:N` facet
// element (it doesn't today — see previewmap.ts's own FigureHitmap doc).

import { describe, expect, it, vi } from "vitest";

import { dragPreviewElement, type PreviewDragDeps } from "./previewDrag";
import type { FigureOverrides } from "../../../lib/figureOverrides";
import type { FigureHitmap, PanelAxesInfo } from "../../../lib/previewmap";
import type { RefLine, Shape } from "../../../lib/types";

// Deliberately DIFFERENT data ranges (mirrors previewmap.test.ts's own
// two-panel fixture) so a cross-panel delta is not just wrong but wildly,
// unmistakably wrong if the guard is missing.
const PANEL_0: PanelAxesInfo = {
  panel: 0,
  label: "level 0",
  x0: 0, y0: 0, x1: 300, y1: 400,
  xlim: [0, 10], ylim: [0, 10],
  xlog: false, ylog: false,
};
const PANEL_1: PanelAxesInfo = {
  panel: 1,
  label: "level 1",
  x0: 300, y0: 0, x1: 600, y1: 400,
  xlim: [100, 200], ylim: [100, 200],
  xlog: false, ylog: false,
};
const FACET_HITMAP: FigureHitmap = {
  image: "",
  width: 600,
  height: 400,
  elements: [],
  panels: [PANEL_0, PANEL_1],
};

const SHAPE: Shape = { id: "s1", kind: "rect", x1: 1, y1: 1, x2: 2, y2: 2 };

const makeDeps = (overrides: Partial<PreviewDragDeps> = {}) => ({
  hitmap: FACET_HITMAP,
  activeOverrides: {} as FigureOverrides,
  setActiveOverrides: vi.fn<(next: FigureOverrides) => void>(),
  refLines: [] as readonly RefLine[],
  setRefLineValue: vi.fn<(id: string, value: number) => void>(),
  shapes: [SHAPE] as readonly Shape[],
  setShapeStyle: vi.fn<(id: string, patch: Partial<Omit<Shape, "id">>) => void>(),
  ...overrides,
});

describe("dragPreviewElement — shape branch, cross-panel guard (G2)", () => {
  it("drops a data-anchored shape drag whose press origin and drop point resolve to DIFFERENT panels", () => {
    const deps = makeDeps();
    // Press origin inside panel 0 (xlim [0,10]), drop point inside panel 1
    // (xlim [100,200]) — the exact case the comment already promised was
    // "dropped rather than guessed".
    dragPreviewElement(deps, "shape:0", 450, 200, 150, 200);
    expect(deps.setShapeStyle).not.toHaveBeenCalled();
  });

  it("commits a normal translate when both endpoints resolve to the SAME panel", () => {
    const deps = makeDeps();
    // Both points inside panel 0 (xlim/ylim both [0,10]): px=150 -> data
    // x=5, startPx=75 -> data x=2.5, dx=2.5; py===startPy=200 -> dy=0.
    // Shape starts at (1,1)-(2,2) -> translated to (3.5,1)-(4.5,2).
    dragPreviewElement(deps, "shape:0", 150, 200, 75, 200);
    expect(deps.setShapeStyle).toHaveBeenCalledExactlyOnceWith("s1", {
      x1: expect.closeTo(3.5, 6),
      y1: expect.closeTo(1, 6),
      x2: expect.closeTo(4.5, 6),
      y2: expect.closeTo(2, 6),
    });
  });

  it("still drops when the drop point lands outside every panel (no target either)", () => {
    const deps = makeDeps();
    dragPreviewElement(deps, "shape:0", 900, 200, 150, 200);
    expect(deps.setShapeStyle).not.toHaveBeenCalled();
  });

  it("page-anchored shapes are unaffected by the panel guard (no data-axes resolution at all)", () => {
    const pageShape: Shape = { ...SHAPE, anchor: "page" };
    const deps = makeDeps({ shapes: [pageShape] });
    // Press in panel 0, drop in panel 1 — fine for a page-anchor drag,
    // which translates by CANVAS fraction, never resolves a data axes.
    dragPreviewElement(deps, "shape:0", 450, 200, 150, 200);
    expect(deps.setShapeStyle).toHaveBeenCalledOnce();
  });

  it("the flat (non-facet) path is unaffected: a single shared `axes` always equals itself", () => {
    const flatHitmap: FigureHitmap = {
      image: "", width: 600, height: 400, elements: [],
      axes: { x0: 0, y0: 0, x1: 600, y1: 400, xlim: [0, 10], ylim: [0, 10], xlog: false, ylog: false },
    };
    const deps = makeDeps({ hitmap: flatHitmap });
    dragPreviewElement(deps, "shape:0", 150, 200, 75, 200);
    expect(deps.setShapeStyle).toHaveBeenCalledOnce();
  });
});

describe("dragPreviewElement — single-point branches need no cross-panel guard", () => {
  it("a reference-line drag resolves the ONE point it's given, no start/end pair to mismatch", () => {
    const deps = makeDeps({
      refLines: [{ id: "r1", axis: "x", value: 0 } as RefLine],
    });
    dragPreviewElement(deps, "refline:0", 450, 200);
    expect(deps.setRefLineValue).toHaveBeenCalledExactlyOnceWith("r1", expect.closeTo(150, 0));
  });
});
