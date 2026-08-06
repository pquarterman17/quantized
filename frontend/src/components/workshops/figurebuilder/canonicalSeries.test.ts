import { describe, expect, it } from "vitest";

import type { ErrorBinding } from "../../../lib/errorRoles";
import type { SeriesStyle } from "../../../lib/types";
import { describeSeriesErrors, describeXAxisErrors, seriesModeOf, seriesModePatch } from "./canonicalSeries";

describe("seriesModeOf", () => {
  it("reads a plain style as line", () => {
    expect(seriesModeOf({})).toBe("line");
  });
  it("reads a zero-width marker style as scatter (the Stage's established sentinel)", () => {
    expect(seriesModeOf({ width: 0, marker: true })).toBe("scatter");
  });
  it("reads a connected line with an overlaid marker as lineSymbol", () => {
    expect(seriesModeOf({ width: 2, marker: true })).toBe("lineSymbol");
  });
  it("reads any step alignment as step, even alongside a marker", () => {
    expect(seriesModeOf({ step: "pre" })).toBe("step");
    expect(seriesModeOf({ step: "mid", marker: true })).toBe("step");
  });
});

describe("seriesModePatch", () => {
  it("scatter sets width 0 + marker and clears any step", () => {
    expect(seriesModePatch("scatter", { step: "pre" })).toEqual({ width: 0, marker: true, step: undefined });
  });
  it("step defaults to post alignment and keeps a real width", () => {
    expect(seriesModePatch("step", { width: 3 })).toEqual({ step: "post", width: 3 });
  });
  it("step preserves an already-chosen alignment", () => {
    expect(seriesModePatch("step", { step: "mid", width: 3 })).toEqual({ step: "mid", width: 3 });
  });
  it("lineSymbol turns on the marker and clears step, keeping a real width", () => {
    expect(seriesModePatch("lineSymbol", { width: 2, step: "post" })).toEqual({
      marker: true, step: undefined, width: 2,
    });
  });
  it("line turns the marker off and clears step", () => {
    expect(seriesModePatch("line", { width: 2, marker: true, step: "post" })).toEqual({
      marker: false, step: undefined, width: 2,
    });
  });
  it("leaving scatter drops its width:0 sentinel instead of leaving a zero-width line", () => {
    const scattered: SeriesStyle = { width: 0, marker: true };
    expect(seriesModePatch("line", scattered)).toEqual({ marker: false, step: undefined, width: undefined });
    expect(seriesModePatch("step", scattered)).toEqual({ step: "post", width: undefined });
  });
});

describe("describeSeriesErrors / describeXAxisErrors", () => {
  const labels = ["X", "Y1", "Y1err", "Y2", "Y2hi", "Y2lo", "Xerr"];
  const bindings: ErrorBinding[] = [
    { channel: 2, target: 1, axis: "y", side: "both" },
    { channel: 4, target: 3, axis: "y", side: "+" },
    { channel: 5, target: 3, axis: "y", side: "-" },
    { channel: 6, target: -1, axis: "x", side: "both" },
  ];

  it("reports 'none' for a channel with no error binding", () => {
    expect(describeSeriesErrors(bindings, 0, labels)).toBe("none");
  });
  it("names a symmetric binding without a side suffix", () => {
    expect(describeSeriesErrors(bindings, 1, labels)).toBe("Y1err");
  });
  it("names both halves of an asymmetric pair with their side suffix", () => {
    expect(describeSeriesErrors(bindings, 3, labels)).toBe("Y2hi (+), Y2lo (-)");
  });
  it("falls back to a channel-index label when the dataset has no name for it", () => {
    expect(describeSeriesErrors([{ channel: 9, target: 0, axis: "y", side: "both" }], 0, labels)).toBe("channel 9");
  });
  it("summarizes the shared x-axis error once, independent of any series channel", () => {
    expect(describeXAxisErrors(bindings, labels)).toBe("Xerr");
  });
  it("returns null when there is no x-axis error binding", () => {
    expect(describeXAxisErrors(bindings.slice(0, 2), labels)).toBeNull();
  });
});
