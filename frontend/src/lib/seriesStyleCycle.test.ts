// PRIMARY_SOFTWARE_AUDIT_PLAN P3.3 — the auto dash/marker cycle's own unit
// contract. The behaviours the canvas, the legend and the export all lean on:
// OFF is the IDENTITY (not "a copy that happens to look the same"), ON assigns
// by display position, and an explicit style always wins.

import { afterEach, describe, expect, it } from "vitest";

import {
  AUTO_DASH_CYCLE,
  AUTO_MARKER_CYCLE,
  DASH,
  autoSeriesStylesEnabled,
  resolveSeriesStyle,
  setAutoSeriesStyles,
} from "./seriesStyleCycle";
import type { SeriesStyle } from "./types";

afterEach(() => setAutoSeriesStyles(false)); // module-level flag: never leak it

describe("setAutoSeriesStyles / autoSeriesStylesEnabled", () => {
  it("defaults to off", () => {
    expect(autoSeriesStylesEnabled()).toBe(false);
  });

  it("round-trips", () => {
    setAutoSeriesStyles(true);
    expect(autoSeriesStylesEnabled()).toBe(true);
    setAutoSeriesStyles(false);
    expect(autoSeriesStylesEnabled()).toBe(false);
  });
});

describe("resolveSeriesStyle with the cycle OFF", () => {
  it("returns undefined for an unstyled series — no object is invented", () => {
    expect(resolveSeriesStyle(undefined, 0)).toBeUndefined();
    expect(resolveSeriesStyle(undefined, 1)).toBeUndefined();
    expect(resolveSeriesStyle(undefined, 7)).toBeUndefined();
  });

  it("returns the caller's OWN reference, not a shallow copy", () => {
    const style: SeriesStyle = { color: "#ff0000", width: 3 };
    // Reference identity, deliberately: `toBe`, not `toEqual`. A copy would
    // compare equal here and still break every `useMemo`/prop-identity check
    // downstream, which is what "off changes nothing" has to mean.
    expect(resolveSeriesStyle(style, 4)).toBe(style);
  });
});

describe("resolveSeriesStyle with the cycle ON", () => {
  it("assigns a dash + glyph by display position to an unstyled series", () => {
    setAutoSeriesStyles(true);
    expect(resolveSeriesStyle(undefined, 0)).toEqual({ line: "solid", markerShape: "circle" });
    expect(resolveSeriesStyle(undefined, 1)).toEqual({ line: "dashed", markerShape: "square" });
    expect(resolveSeriesStyle(undefined, 2)).toEqual({ line: "dotted", markerShape: "triangle" });
  });

  it("gives three consecutive series three DISTINCT dashes and glyphs", () => {
    setAutoSeriesStyles(true);
    const three = [0, 1, 2].map((i) => resolveSeriesStyle(undefined, i)!);
    expect(new Set(three.map((s) => s.line)).size).toBe(3);
    expect(new Set(three.map((s) => s.markerShape)).size).toBe(3);
    // and the dashes are visually distinct too, not three names for one pattern
    expect(new Set(three.map((s) => JSON.stringify(DASH[s.line!]))).size).toBe(3);
  });

  it("wraps at each cycle's own length, independently", () => {
    setAutoSeriesStyles(true);
    expect(resolveSeriesStyle(undefined, 3)?.line).toBe("solid"); // 3 dashes
    expect(resolveSeriesStyle(undefined, 3)?.markerShape).toBe("diamond"); // 8 glyphs
    expect(resolveSeriesStyle(undefined, 8)?.markerShape).toBe(AUTO_MARKER_CYCLE[0]);
    expect(resolveSeriesStyle(undefined, 9)?.line).toBe(AUTO_DASH_CYCLE[0]);
  });

  it("an explicit line/markerShape WINS over the cycle — including solid/circle", () => {
    setAutoSeriesStyles(true);
    // position 1 would otherwise be dashed/square
    expect(resolveSeriesStyle({ line: "solid" }, 1)).toEqual({ line: "solid", markerShape: "square" });
    expect(resolveSeriesStyle({ markerShape: "circle" }, 1)).toEqual({
      line: "dashed",
      markerShape: "circle",
    });
    const both: SeriesStyle = { line: "dotted", markerShape: "star" };
    expect(resolveSeriesStyle(both, 1)).toBe(both); // fully explicit: untouched
  });

  it("preserves every other field of the caller's style", () => {
    setAutoSeriesStyles(true);
    const style: SeriesStyle = { color: "#123456", width: 2.5, marker: true, markerSize: 9, step: "mid" };
    expect(resolveSeriesStyle(style, 1)).toEqual({ ...style, line: "dashed", markerShape: "square" });
  });

  it("never turns markers ON by itself — the glyph is inert until something does", () => {
    setAutoSeriesStyles(true);
    expect(resolveSeriesStyle(undefined, 1)?.marker).toBeUndefined();
    expect(resolveSeriesStyle({ marker: false }, 1)?.marker).toBe(false);
  });

  it("clamps a nonsense index instead of producing an undefined style value", () => {
    setAutoSeriesStyles(true);
    for (const i of [-1, 1.6, Number.NaN]) {
      const s = resolveSeriesStyle(undefined, i)!;
      expect(AUTO_DASH_CYCLE).toContain(s.line);
      expect(AUTO_MARKER_CYCLE).toContain(s.markerShape);
    }
  });
});

describe("the cycles themselves", () => {
  it("cover the whole LineStyle / MarkerShape vocabularies with no repeats", () => {
    expect(new Set(AUTO_DASH_CYCLE).size).toBe(AUTO_DASH_CYCLE.length);
    expect(new Set(AUTO_MARKER_CYCLE).size).toBe(AUTO_MARKER_CYCLE.length);
    expect([...AUTO_DASH_CYCLE].sort()).toEqual(Object.keys(DASH).sort());
    expect(AUTO_MARKER_CYCLE.length).toBe(8);
  });

  it("starts at the values that reproduce today's default look for series 1", () => {
    expect(AUTO_DASH_CYCLE[0]).toBe("solid");
    expect(AUTO_MARKER_CYCLE[0]).toBe("circle");
  });
});
