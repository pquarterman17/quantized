// useLivePaint loads the live-patch code lazily. If that chunk fails to load
// (a stale deploy, a dropped connection), the edit must still reach the
// screen: the hook falls back to a rebuild, the pre-patch behaviour.

import { renderHook, waitFor } from "@testing-library/react";
import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import { useLivePaint } from "./useLivePaint";

vi.mock("../../lib/uplotLivePaint", () => {
  throw new Error("chunk failed to load");
});

const PAYLOAD: PlotPayload = { data: [[0, 1], [2, 3]], series: [{ label: "M", unit: "" }], xLabel: "x", xUnit: "" };

describe("useLivePaint", () => {
  it("rebuilds when the patch code fails to load", async () => {
    let rebuilds = 0;
    const plotRef = { current: {} as uPlot };
    renderHook(() =>
      useLivePaint(plotRef, { current: null }, PAYLOAD, {}, true, { current: { y: null, y2: null } }, () => {
        rebuilds += 1;
      }),
    );
    await waitFor(() => expect(rebuilds).toBe(1));
  });
});
