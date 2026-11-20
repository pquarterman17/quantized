// A column can carry X error bars from its dataset's error roles (a dQ column)
// and Y bars from the view's errKeys (an Origin error-bar plot, `OriginCurve.yErr`).
// The rich spans replace the legacy bars only where they draw the same (Y)
// whiskers; an X-only span must not swallow the Y bars (MnN_Diffusion_PNR-style
// reflectometry: Origin draws both).

import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
});

import type { ErrorSpan } from "./errorbars";
import type { PlotPayload } from "./plotdata";
import { buildOpts, type BuildOptsArgs } from "./uplotOpts";

const PAYLOAD: PlotPayload = {
  data: [[0, 1, 2], [10, 11, 12]],
  series: [{ label: "A", unit: "" }],
  xLabel: "x",
  xUnit: "",
};
const BASE: BuildOptsArgs = {
  width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
};
const span = (axis: "x" | "y"): ErrorSpan => ({ axis, plus: [1, 1, 1], minus: [1, 1, 1] });
const plugins = (args: Partial<BuildOptsArgs>) => buildOpts(PAYLOAD, { ...BASE, ...args }).plugins?.length ?? 0;

describe("legacy Y bars beside rich error spans", () => {
  const bars = new Map([[1, [0.5, 0.5, 0.5]]]);

  it("keeps the Y bars when the column's only span is an X span", () => {
    const xOnly = plugins({ errorSpans: new Map([[1, [span("x")]]]) });
    expect(plugins({ errorSpans: new Map([[1, [span("x")]]]), errorBars: bars })).toBe(xOnly + 1);
  });

  it("drops them where a Y span already draws that column", () => {
    const withY = plugins({ errorSpans: new Map([[1, [span("y")]]]) });
    expect(plugins({ errorSpans: new Map([[1, [span("y")]]]), errorBars: bars })).toBe(withY);
  });
});
