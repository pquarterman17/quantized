// The canvas side of "the fit must not hide the data" (the export side is in
// figureSpecOverlays.test.ts): a fit curve is a thinner dashed line, the data
// gets markers while a fit is shown, and the user's own styles still win.

import { describe, expect, it } from "vitest";

import { FIT_DASH, fitLineWidth, isFitSeries, traceWithFit } from "./fitOverlayStyle";
import type { PlotPayload } from "./plotdata";
import { buildSeriesDefs } from "./uplotSeries";

const COLORS = { accentColor: "#00f", inkColor: "#fff", inkDimColor: "#888", isDarkBg: true };
const payload = (fit: boolean): PlotPayload => ({
  data: fit ? [[0, 1], [1, 2], [1, 2]] : [[0, 1], [1, 2]],
  series: [{ label: "y", unit: "" }, ...(fit ? [{ label: "fit", unit: "", overlay: true }] : [])],
  xLabel: "x",
  xUnit: "",
} as PlotPayload);
const defs = (p: PlotPayload, styles: PlotPayloadStyles = []) =>
  buildSeriesDefs(p, { seriesStyles: styles, baseLineWidth: 1.5 }, p.series.map((s) => s.label), true, COLORS).series;
type PlotPayloadStyles = NonNullable<Parameters<typeof buildSeriesDefs>[1]["seriesStyles"]>;

describe("fit overlay style", () => {
  it("draws an unstyled fit as a thinner dashed line", () => {
    const [, , fit] = defs(payload(true));
    expect(fit!.dash).toEqual(FIT_DASH);
    expect(fit!.width).toBe(fitLineWidth(1.5));
    expect(fit!.width!).toBeLessThan(1.5);
  });
  it("shows markers on unstyled data only while a fit is shown", () => {
    expect(defs(payload(true))[1]!.points?.show).toBe(true);
    expect(defs(payload(false))[1]!.points?.show).toBe(false);
  });
  it("leaves a series the user styled alone", () => {
    const own = [{ explicit: true, width: 3 }] as PlotPayloadStyles;
    expect(defs(payload(true), own)[1]!.points?.show).toBe(false);
    expect(defs(payload(true), [undefined, { width: 4, line: "solid" }] as PlotPayloadStyles)[2]!.dash).toBeUndefined();
  });
  it("helpers: only the fit series, only the default Line trace changes", () => {
    expect(isFitSeries({ label: "fit", overlay: true })).toBe(true);
    expect(isFitSeries({ label: "fit", overlay: true, band: 1 })).toBe(false);
    expect(isFitSeries({ label: "fit" })).toBe(false);
    expect(traceWithFit("Line", true)).toBe("Line + markers");
    expect(traceWithFit("Scatter", true)).toBe("Scatter");
    expect(traceWithFit("Line", false)).toBe("Line");
  });
});
