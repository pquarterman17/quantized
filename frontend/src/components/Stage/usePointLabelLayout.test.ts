import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type uPlot from "uplot";

import { NO_LABELS, type LabelLayout } from "../../lib/pointLabelLayout";
import { useCanvasPointLabels } from "./usePointLabelLayout";

const fake = () => ({ hooks: {} as Record<string, unknown[]>, redraw: vi.fn() });
const on: LabelLayout = { points: [{ x: 1, y: 1, text: "a", row: 0, ch: 0, s: 0 }], note: null, refusal: null };

describe("useCanvasPointLabels", () => {
  it("with labels off it never touches the plot instance", () => {
    const u = fake();
    renderHook(() => useCanvasPointLabels({ current: u as unknown as uPlot }, NO_LABELS, [0]));
    expect(u.hooks.draw).toBeUndefined();
    expect(u.redraw).not.toHaveBeenCalled();
  });

  it("turning labels on attaches one draw hook (loading the drawing code on demand) and redraws", async () => {
    const u = fake();
    const ref = { current: u as unknown as uPlot };
    const { rerender } = renderHook(({ l }) => useCanvasPointLabels(ref, l, [0]), { initialProps: { l: NO_LABELS } });
    rerender({ l: on });
    rerender({ l: { ...on } });
    expect(u.hooks.draw).toHaveLength(1);
    await waitFor(() => expect(u.redraw).toHaveBeenCalled());
  });

  it("a rebuilt instance gets its own draw hook; turning labels off redraws once to clear", async () => {
    const a = fake(), b = fake();
    const ref = { current: a as unknown as uPlot };
    const { rerender } = renderHook(({ l }) => useCanvasPointLabels(ref, l, [0]), { initialProps: { l: on } });
    expect(a.hooks.draw).toHaveLength(1);
    ref.current = b as unknown as uPlot;
    rerender({ l: on });
    expect(b.hooks.draw).toHaveLength(1);
    b.redraw.mockClear();
    rerender({ l: NO_LABELS });
    await waitFor(() => expect(b.redraw).toHaveBeenCalledTimes(1));
  });
});
