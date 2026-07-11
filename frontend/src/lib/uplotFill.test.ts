import { describe, expect, it } from "vitest";

import { resolveFillBands, seriesFillProps, translucent } from "./uplotFill";

describe("translucent", () => {
  it("wraps a colour in color-mix() at the given percent", () => {
    expect(translucent("#8b5cf6", 25)).toBe("color-mix(in oklab, #8b5cf6 25%, transparent)");
  });

  it("defaults to FILL_ALPHA_PCT (25%) when no percent is given", () => {
    expect(translucent("red")).toBe("color-mix(in oklab, red 25%, transparent)");
  });
});

describe("seriesFillProps", () => {
  it("returns fill/fillTo=0 for 'under'", () => {
    expect(seriesFillProps("under", "#ff0000")).toEqual({
      fill: "color-mix(in oklab, #ff0000 25%, transparent)",
      fillTo: 0,
    });
  });

  it("returns an empty object for 'none'/undefined", () => {
    expect(seriesFillProps("none", "#ff0000")).toEqual({});
    expect(seriesFillProps(undefined, "#ff0000")).toEqual({});
  });

  it("returns an empty object for a {vs} band (resolved separately)", () => {
    expect(seriesFillProps({ vs: 2 }, "#ff0000")).toEqual({});
  });
});

describe("resolveFillBands", () => {
  const strokeOf = (i: number) => `stroke-${i}`;

  it("builds a band for a series with fill: {vs: channel}", () => {
    // plotted = [0, 2]: display series 0 = channel 0, display series 1 = channel 2.
    const bands = resolveFillBands([0, 2], [{ fill: { vs: 2 } }, undefined], strokeOf);
    expect(bands).toEqual([
      { series: [1, 2], fill: "color-mix(in oklab, stroke-0 25%, transparent)" },
    ]);
  });

  it("skips a vs channel that isn't currently plotted", () => {
    const bands = resolveFillBands([0, 2], [{ fill: { vs: 5 } }], strokeOf);
    expect(bands).toEqual([]);
  });

  it("skips a self-referencing vs (vs === its own channel)", () => {
    const bands = resolveFillBands([0, 2], [{ fill: { vs: 0 } }], strokeOf);
    expect(bands).toEqual([]);
  });

  it("ignores 'under'/'none'/undefined fills", () => {
    const bands = resolveFillBands(
      [0, 1, 2],
      [{ fill: "under" }, { fill: "none" }, undefined],
      strokeOf,
    );
    expect(bands).toEqual([]);
  });

  it("builds one band per requesting series", () => {
    const bands = resolveFillBands(
      [0, 1, 2],
      [{ fill: { vs: 1 } }, undefined, { fill: { vs: 0 } }],
      strokeOf,
    );
    expect(bands).toEqual([
      { series: [1, 2], fill: "color-mix(in oklab, stroke-0 25%, transparent)" },
      { series: [3, 1], fill: "color-mix(in oklab, stroke-2 25%, transparent)" },
    ]);
  });
});
