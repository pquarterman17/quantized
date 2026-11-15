// Gap audit 4 lane A review L12: the error-bar drawing rides the region-decor
// startup chunk (lib/uplotErrorDraw.ts). A plot whose ONLY overlay is error
// bars, drawn before that chunk lands, must rebuild once it does -- else its
// bars stay undrawn until some unrelated rebuild. This forces the race
// (docs/testing.md): the chunk is held behind a gate the test opens.

import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { regionDecorReady } from "../../lib/regionDecorLoader";
import { plotDecorNeeds, startupOverlayCount, useLazyPlotParts } from "./useLazyPlotParts";

const gate = vi.hoisted(() => {
  let open = () => {};
  const shut = new Promise<void>((r) => (open = r));
  return { shut, open: () => open() };
});

vi.mock("../../lib/uplotRegionShades", async (importOriginal) => {
  await gate.shut;
  return importOriginal();
});

describe("error bars as the only overlay (forces the race)", () => {
  it("counts error bars, by column or by binding, as startup-chunk overlays", () => {
    expect(startupOverlayCount({ errorBars: new Map([[1, [0.1]]]) })).toBe(1);
    expect(startupOverlayCount({ errorSpans: new Map([[1, []]]) })).toBe(1);
    expect(startupOverlayCount({ errorRoles: [{}], errKeys: { 0: 2 } })).toBe(2);
    expect(startupOverlayCount({ colorByColumns: new Map([[1, {}]]) })).toBe(1); // the colour-mapped scatter too
    expect(startupOverlayCount({})).toBe(0);
  });

  it("a plot drawn before the chunk rebuilds exactly once when it lands", async () => {
    expect(regionDecorReady()).toBe(false);
    const overlays = startupOverlayCount({ errorBars: new Map([[1, [0.1, 0.2]]]) });
    const decor = plotDecorNeeds([], null, null, overlays);
    const { result } = renderHook(() => {
      const [epoch, setEpoch] = useState(0);
      useLazyPlotParts([], "zoom", () => setEpoch((e) => e + 1), decor);
      return epoch;
    });
    expect(result.current).toBe(0);
    await act(async () => {
      gate.open();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current).toBe(1));
    expect(regionDecorReady()).toBe(true);
  });
});
