// Unit tests for the region tool's 2-D y-box helpers, split out of
// uplotOpts.test.ts's integration-level `buildOpts` coverage (Group AB fix
// round 2): `regionYScale` in isolation (finding 1 — the axis rule must not
// key off `series[0]` alone), `regionSelectPick`'s drag-end pick + sliver-hide
// (finding 2), and the exact-threshold boundary for both `MIN_BOX_HEIGHT_PX`
// checks (finding 3 — they must never desync).

import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import { MIN_BOX_HEIGHT_PX, regionLiveBoxHook, regionSelectPick, regionYScale } from "./uplotRegionBox";

function payloadWith(axes: (0 | 1 | undefined)[]): PlotPayload {
  return {
    data: axes.map(() => [0, 1]) as PlotPayload["data"],
    series: axes.map((axis, i) => ({ label: `s${i}`, unit: "", ...(axis === undefined ? {} : { axis }) })),
    xLabel: "x",
    xUnit: "",
  };
}

describe("regionYScale (round-2 finding 1)", () => {
  it("resolves \"y\" when the plot has no Y2 axis at all", () => {
    expect(regionYScale(payloadWith([0]), false)).toBe("y");
  });

  it("resolves \"y\" when the FIRST series is the Y2 one but a later series is primary", () => {
    // The exact adversarial case: a dual-Y toggle put series[0] on Y2 while
    // the actual (primary) data being boxed is series[1]. The old
    // `series[0]`-only rule returned "y2" here — wrong.
    expect(regionYScale(payloadWith([1, 0]), true)).toBe("y");
  });

  it("still resolves \"y\" for the ordinary overlay-after-fit shape (fit primary, overlay on Y2)", () => {
    expect(regionYScale(payloadWith([0, 1]), true)).toBe("y");
  });

  it("resolves \"y2\" only when EVERY plotted series is on the secondary axis", () => {
    expect(regionYScale(payloadWith([1, 1]), true)).toBe("y2");
  });

  it("treats a lone series with no explicit axis as primary", () => {
    expect(regionYScale(payloadWith([undefined]), false)).toBe("y");
  });
});

describe("regionLiveBoxHook exact-threshold boundary (round-2 finding 3)", () => {
  function fakeU(selectHeight: number) {
    const band = { style: {} as Record<string, string> };
    const querySelector = vi.fn(() => band);
    return { select: { left: 10, width: 50, top: 40, height: selectHeight }, over: { clientHeight: 200, querySelector } };
  }

  it("does NOT override at exactly MIN_BOX_HEIGHT_PX (the >= boundary)", () => {
    const u = fakeU(MIN_BOX_HEIGHT_PX);
    regionLiveBoxHook("region")(u as never);
    expect(u.over.querySelector).not.toHaveBeenCalled();
  });

  it("DOES override one pixel under MIN_BOX_HEIGHT_PX", () => {
    const u = fakeU(MIN_BOX_HEIGHT_PX - 1);
    regionLiveBoxHook("region")(u as never);
    expect(u.over.querySelector).toHaveBeenCalledWith(".u-select");
  });
});

describe("regionSelectPick (round-2 finding 2 + finding 3 boundary)", () => {
  const payload = payloadWith([0]);
  const posToVal = (px: number, scale?: string) => (scale === "y2" ? px / 7 : px / 10);

  function fakeU(height: number) {
    return { select: { left: 100, width: 50, top: 20, height }, posToVal, setSelect: vi.fn() };
  }

  it("stays x-only exactly one pixel under MIN_BOX_HEIGHT_PX", () => {
    const onRegionSelect = vi.fn();
    const u = fakeU(MIN_BOX_HEIGHT_PX - 1);
    regionSelectPick(u as never, payload, false, onRegionSelect);
    expect(onRegionSelect).toHaveBeenCalledWith(10, 15);
  });

  it("reads back y0/y1 at exactly MIN_BOX_HEIGHT_PX (the < boundary)", () => {
    const onRegionSelect = vi.fn();
    const u = fakeU(MIN_BOX_HEIGHT_PX);
    regionSelectPick(u as never, payload, false, onRegionSelect);
    expect(onRegionSelect).toHaveBeenCalledWith(10, 15, 2, 2.6);
  });

  it("hides the just-painted selection synchronously, without re-firing this hook", () => {
    const onRegionSelect = vi.fn();
    const u = fakeU(30);
    regionSelectPick(u as never, payload, false, onRegionSelect);
    expect(u.setSelect).toHaveBeenCalledTimes(1);
    expect(u.setSelect).toHaveBeenCalledWith({ left: 0, top: 0, width: 0, height: 0 }, false);
    // Only one pick, even though setSelect was called — proves the `false`
    // _fire arg (which this test's own fake can't literally re-enter, but
    // documents the exact call uPlot's real hideSelect() makes internally).
    expect(onRegionSelect).toHaveBeenCalledTimes(1);
  });

  it("also hides the selection on the x-only (sub-threshold) path", () => {
    const onRegionSelect = vi.fn();
    const u = fakeU(2);
    regionSelectPick(u as never, payload, false, onRegionSelect);
    expect(u.setSelect).toHaveBeenCalledWith({ left: 0, top: 0, width: 0, height: 0 }, false);
  });

  it("reads back on the resolved regionYScale, not hardcoded \"y\"", () => {
    const onRegionSelect = vi.fn();
    const allY2 = payloadWith([1]);
    const u = fakeU(30);
    regionSelectPick(u as never, allY2, true, onRegionSelect);
    // top=20,h=30 on "y2" (posToVal /7): 20/7, 50/7
    expect(onRegionSelect).toHaveBeenCalledWith(10, 15, 20 / 7, 50 / 7);
  });
});
