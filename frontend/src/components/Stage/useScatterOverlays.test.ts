import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postJSON } from "../../lib/api/http";
import type { PlotPayload } from "../../lib/plotdata";
import type { PlotOverlays } from "../../lib/plotOverlays";
import { useScatterOverlays } from "./useScatterOverlays";

vi.mock("../../lib/api/http", () => ({ postJSON: vi.fn() }));

const payload: PlotPayload = {
  data: [[1, 2, 3, 4], [2, 4, 6, 8]] as unknown as PlotPayload["data"],
  series: [{ label: "A", unit: "" }],
  xLabel: "x",
  xUnit: "",
};
const view = { xScale: "linear", yScale: "linear" };
const line: PlotOverlays = { line: { band: "none", level: 0.95 }, smoother: null, ellipse: null };
const fakePlot = () => ({ hooks: {} as Record<string, unknown[]>, redraw: vi.fn() });

beforeEach(() => vi.mocked(postJSON).mockReset());

describe("useScatterOverlays", () => {
  it("does nothing, and asks for nothing, while every overlay is off", async () => {
    const plot = fakePlot();
    renderHook(() => useScatterOverlays({ current: plot as never }, payload, null, view, undefined, undefined));
    await Promise.resolve();
    expect(postJSON).not.toHaveBeenCalled();
    expect(plot.hooks.draw).toBeUndefined();
  });

  it("requests the enabled overlays and repaints when they arrive", async () => {
    vi.mocked(postJSON).mockResolvedValue({ series: [{ label: "A", refused: {} }] });
    const plot = fakePlot();
    renderHook(() => useScatterOverlays({ current: plot as never }, payload, line, view, undefined, undefined));
    await waitFor(() => expect(plot.redraw.mock.calls.length).toBeGreaterThan(0));
    expect(plot.hooks.draw).toHaveLength(1);
    expect(vi.mocked(postJSON).mock.calls[0]![1]).toMatchObject({ overlays: { line: { band: "none", level: 0.95 } } });
  });

  it("a log axis sends nothing (the key says why)", async () => {
    const plot = fakePlot();
    renderHook(() => useScatterOverlays({ current: plot as never }, payload, line, { ...view, yScale: "log" }, undefined, undefined));
    await waitFor(() => expect(plot.redraw.mock.calls.length).toBeGreaterThan(0));
    expect(postJSON).not.toHaveBeenCalled();
  });
});
