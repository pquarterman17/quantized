import { describe, expect, it, vi } from "vitest";

import type { ErrorSpan } from "../../../lib/errorbars";
import { drawErrorWhiskers } from "./errorBarsCanvas";

/** A minimal canvas-2D-context mock: just the drawing calls
 *  `drawErrorWhiskers` actually uses, each a spy so the test can assert what
 *  got drawn without a real canvas backend (jsdom has none — see
 *  GraphPreview's own module doc). */
function mockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    lineWidth: 0,
  } as unknown as CanvasRenderingContext2D;
}

const sx = (v: number) => v * 10;
const sy = (v: number) => 100 - v * 10;

describe("drawErrorWhiskers", () => {
  it("draws a vertical whisker (stem + two end caps) per finite point for a y-axis span", () => {
    const ctx = mockCtx();
    const span: ErrorSpan = { axis: "y", plus: [1, null], minus: [1, null] };
    drawErrorWhiskers(ctx, [0, 1], [5, 6], sx, sy, [span], "#ff0000");

    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.restore).toHaveBeenCalledOnce();
    expect(ctx.strokeStyle).toBe("#ff0000");
    // One finite point (row 0) -> one beginPath/stroke pass (row 1 has null
    // magnitudes on BOTH sides and is skipped entirely).
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    // stem: (px, top) -> (px, bottom); two caps: 2 moveTo/lineTo pairs each.
    expect(ctx.moveTo).toHaveBeenCalledTimes(3);
    expect(ctx.lineTo).toHaveBeenCalledTimes(3);
  });

  it("draws a horizontal whisker for an x-axis span", () => {
    const ctx = mockCtx();
    const span: ErrorSpan = { axis: "x", plus: [0.5], minus: [0.5] };
    drawErrorWhiskers(ctx, [2], [3], sx, sy, [span], "#00ff00");
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    // left/right stem + two vertical caps.
    expect(ctx.moveTo).toHaveBeenCalledTimes(3);
    expect(ctx.lineTo).toHaveBeenCalledTimes(3);
  });

  it("draws both axes independently when a series carries both spans", () => {
    const ctx = mockCtx();
    const ySpan: ErrorSpan = { axis: "y", plus: [1], minus: [1] };
    const xSpan: ErrorSpan = { axis: "x", plus: [0.5], minus: [0.5] };
    drawErrorWhiskers(ctx, [1], [1], sx, sy, [ySpan, xSpan], "#0000ff");
    expect(ctx.beginPath).toHaveBeenCalledTimes(2);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });

  it("skips a non-finite point entirely (never draws a whisker with no anchor)", () => {
    const ctx = mockCtx();
    const span: ErrorSpan = { axis: "y", plus: [1], minus: [1] };
    drawErrorWhiskers(ctx, [NaN], [5], sx, sy, [span], "#fff");
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("draws only the present side when a span carries one null half", () => {
    const ctx = mockCtx();
    const span: ErrorSpan = { axis: "y", plus: [1], minus: [null] };
    drawErrorWhiskers(ctx, [0], [5], sx, sy, [span], "#fff");
    // Still one whisker drawn (plus side present) -- minus falls back to py.
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for an empty spans list", () => {
    const ctx = mockCtx();
    drawErrorWhiskers(ctx, [0, 1], [1, 2], sx, sy, [], "#fff");
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.beginPath).not.toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalledOnce();
  });
});
