// The canvas side of "the fit must not hide the data" (the export side is in
// figureSpecOverlays.test.ts): the Curve Fit's curve is a thinner dashed line,
// the data gets markers while it is shown, and the user's own styles still win.
// Other tools' fits in the same slot (Quick Fit, the peak envelope, ...) are
// drawn exactly as before.

import { describe, expect, it } from "vitest";

import { FIT_DASH, FIT_MARKER_MAX_POINTS, fitLineWidth, isFitSeries, traceWithFit } from "./fitOverlayStyle";
import { withFitOverlay, type PlotPayload } from "./plotdata";
import { buildSeriesDefs } from "./uplotSeries";
import { SINGLE_X } from "../test/overlayBinding";

const COLORS = { accentColor: "#00f", inkColor: "#fff", inkDimColor: "#888", isDarkBg: true };
const base = (n = 2): PlotPayload => ({
  data: [Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => i + 1)],
  series: [{ label: "y", unit: "" }],
  xLabel: "x",
  xUnit: "",
} as PlotPayload);
/** `base` with a fit overlay the way the stage appends one: the Curve Fit's (flagged) or another tool's. */
const payload = (fit: boolean, curveFit = true, n = 2): PlotPayload => {
  const p = base(n);
  if (!fit) return p;
  const y = Array.from({ length: n }, (_, i) => i + 1);
  return withFitOverlay(p, { datasetId: "d", binding: SINGLE_X, y, ...(curveFit ? { curveFit: true as const } : {}) }, "d");
};
const defs = (p: PlotPayload, styles: PlotPayloadStyles = []) =>
  buildSeriesDefs(p, { seriesStyles: styles, baseLineWidth: 1.5 }, p.series.map((s) => s.label), true, COLORS).series;
type PlotPayloadStyles = NonNullable<Parameters<typeof buildSeriesDefs>[1]["seriesStyles"]>;

describe("fit overlay style", () => {
  it("draws the Curve Fit's unstyled fit as a thinner dashed line", () => {
    const [, , fit] = defs(payload(true));
    expect(fit!.dash).toEqual(FIT_DASH);
    expect(fit!.width).toBe(fitLineWidth(1.5));
    expect(fit!.width!).toBeLessThan(1.5);
  });
  it("shows markers on unstyled data only while the Curve Fit's curve is shown", () => {
    expect(defs(payload(true))[1]!.points?.show).toBe(true);
    expect(defs(payload(false))[1]!.points?.show).toBe(false);
  });
  it("leaves Quick Fit / peak-envelope fits (no curveFit flag) and their data exactly as before", () => {
    const [, data, fit] = defs(payload(true, false));
    const [, plain] = defs(payload(false));
    expect(fit!.dash).toBeUndefined();
    expect(fit!.width).toBe(1.5);
    expect(data!.points?.show).toBe(false);
    expect(data).toEqual(plain);
  });
  it("skips data markers above the density cap", () => {
    expect(defs(payload(true, true, FIT_MARKER_MAX_POINTS))[1]!.points?.show).toBe(true);
    expect(defs(payload(true, true, FIT_MARKER_MAX_POINTS + 1))[1]!.points?.show).toBe(false);
  });
  it("leaves a series the user styled alone", () => {
    const own = [{ explicit: true, width: 3 }] as PlotPayloadStyles;
    expect(defs(payload(true), own)[1]!.points?.show).toBe(false);
    expect(defs(payload(true), [undefined, { width: 4, line: "solid" }] as PlotPayloadStyles)[2]!.dash).toBeUndefined();
  });
  it("helpers: only the flagged fit series, only the default Line trace changes", () => {
    expect(isFitSeries({ fit: true })).toBe(true);
    expect(isFitSeries({ fit: true, band: 1 })).toBe(false);
    expect(isFitSeries({})).toBe(false);
    expect(traceWithFit("Line", true)).toBe("Line + markers");
    expect(traceWithFit("Line", true, FIT_MARKER_MAX_POINTS + 1)).toBe("Line");
    expect(traceWithFit("Scatter", true)).toBe("Scatter");
    expect(traceWithFit("Line", false)).toBe("Line");
  });
});
