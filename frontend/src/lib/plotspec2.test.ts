import { describe, expect, it } from "vitest";

import {
  axesBlockHasContent,
  buildAxesBlock,
  buildDisplayBlock,
  displayBlockHasContent,
  validateAxesBlock,
  validateDisplayBlock,
  type AxesBlock,
  type DisplayBlock,
} from "./plotspec2";

// ── validateDisplayBlock ─────────────────────────────────────────────────────
describe("validateDisplayBlock", () => {
  it("returns null only when the input isn't an object", () => {
    expect(validateDisplayBlock(null)).toBeNull();
    expect(validateDisplayBlock(undefined)).toBeNull();
    expect(validateDisplayBlock("nope")).toBeNull();
    expect(validateDisplayBlock(5)).toBeNull();
  });

  it("returns an empty (but non-null) block for an empty object", () => {
    expect(validateDisplayBlock({})).toEqual({});
  });

  it("captures a well-formed series entry + order", () => {
    const v = {
      series: { 0: { color: "#ff8800", width: 2, marker: true, markerShape: "square", line: "dashed" } },
      order: [2, 0, 1],
    };
    expect(validateDisplayBlock(v)).toEqual({
      series: { 0: { color: "#ff8800", width: 2, marker: true, markerShape: "square", line: "dashed" } },
      order: [2, 0, 1],
    });
  });

  it("captures hidden + axis fields", () => {
    const v = { series: { 3: { hidden: true, axis: 1 } } };
    expect(validateDisplayBlock(v)).toEqual({ series: { 3: { hidden: true, axis: 1 } } });
  });

  it("drops a non-integer channel key without nulling the block", () => {
    const v = { series: { "1.5": { color: "#fff" }, notanumber: { color: "#000" }, 2: { color: "#abc" } } };
    expect(validateDisplayBlock(v)).toEqual({ series: { 2: { color: "#abc" } } });
  });

  it("drops an unknown markerShape/line value, keeping the rest of the entry", () => {
    const v = { series: { 0: { color: "#fff", markerShape: "hexagon", line: "wavy" } } };
    expect(validateDisplayBlock(v)).toEqual({ series: { 0: { color: "#fff" } } });
  });

  it("drops a negative or absurd width, keeping other fields", () => {
    const v = { series: { 0: { width: -1 }, 1: { width: 500 }, 2: { width: 0 }, 3: { width: NaN } } };
    // width 0 is a real value (marker-only preset); -1/500/NaN all drop.
    expect(validateDisplayBlock(v)).toEqual({ series: { 2: { width: 0 } } });
  });

  it("drops a series entry that validates to nothing (all fields malformed)", () => {
    const v = { series: { 0: { width: -5, markerShape: "nope" }, 1: { color: "#abc" } } };
    expect(validateDisplayBlock(v)).toEqual({ series: { 1: { color: "#abc" } } });
  });

  it("drops non-array order and non-integer/non-number order entries", () => {
    expect(validateDisplayBlock({ order: "not an array" })).toEqual({});
    expect(validateDisplayBlock({ order: [0, 1.5, "x", 2] })).toEqual({ order: [0, 2] });
  });

  it("drops a malformed series entry entirely (not an object)", () => {
    expect(validateDisplayBlock({ series: { 0: "not an object", 1: { color: "#abc" } } })).toEqual({
      series: { 1: { color: "#abc" } },
    });
  });
});

// ── validateAxesBlock ────────────────────────────────────────────────────────
describe("validateAxesBlock", () => {
  it("returns null only when the input isn't an object", () => {
    expect(validateAxesBlock(null)).toBeNull();
    expect(validateAxesBlock("nope")).toBeNull();
  });

  it("returns an empty (but non-null) block for an empty object", () => {
    expect(validateAxesBlock({})).toEqual({});
  });

  it("captures a well-formed x/y/y2 + title", () => {
    const v = {
      x: { label: "Field", lim: [0, 10], scale: "linear", step: 2, fmt: { mode: "fixed", digits: 2 } },
      y: { label: "Moment", scale: "log" },
      y2: { label: "Temp", lim: [-5, 5] },
      title: "My graph",
    };
    expect(validateAxesBlock(v)).toEqual({
      x: { label: "Field", lim: [0, 10], scale: "linear", step: 2, fmt: { mode: "fixed", digits: 2 } },
      y: { label: "Moment", scale: "log" },
      y2: { label: "Temp", lim: [-5, 5] },
      title: "My graph",
    });
  });

  it("drops a NaN/non-finite lim, keeping the other fields", () => {
    const v = { x: { label: "Field", lim: [0, NaN] } };
    expect(validateAxesBlock(v)).toEqual({ x: { label: "Field" } });
  });

  it("drops an unknown scale value", () => {
    const v = { y: { scale: "polar-ish" } };
    expect(validateAxesBlock(v)).toEqual({});
  });

  it("drops a malformed AxisFormat (bad mode / non-finite digits)", () => {
    expect(validateAxesBlock({ x: { fmt: { mode: "bogus", digits: 2 } } })).toEqual({});
    expect(validateAxesBlock({ x: { fmt: { mode: "sci", digits: NaN } } })).toEqual({});
    expect(validateAxesBlock({ x: { label: "ok", fmt: { mode: "sci", digits: NaN } } })).toEqual({
      x: { label: "ok" },
    });
  });

  it("drops an axis entry that isn't an object, keeps the others", () => {
    expect(validateAxesBlock({ x: "not an object", y: { label: "y" } })).toEqual({ y: { label: "y" } });
  });

  it("ignores unknown extra keys", () => {
    expect(validateAxesBlock({ x: { label: "Field", bogus: 5 } })).toEqual({ x: { label: "Field" } });
  });
});

// ── has-content gates ────────────────────────────────────────────────────────
describe("displayBlockHasContent / axesBlockHasContent", () => {
  it("displayBlockHasContent is false for null/undefined/empty, true with series or order", () => {
    expect(displayBlockHasContent(null)).toBe(false);
    expect(displayBlockHasContent(undefined)).toBe(false);
    expect(displayBlockHasContent({})).toBe(false);
    expect(displayBlockHasContent({ series: {} })).toBe(false);
    expect(displayBlockHasContent({ order: [] })).toBe(false);
    const withSeries: DisplayBlock = { series: { 0: { color: "#fff" } } };
    expect(displayBlockHasContent(withSeries)).toBe(true);
    const withOrder: DisplayBlock = { order: [1, 0] };
    expect(displayBlockHasContent(withOrder)).toBe(true);
  });

  it("axesBlockHasContent is false for null/undefined/empty, true with any axis or a title", () => {
    expect(axesBlockHasContent(null)).toBe(false);
    expect(axesBlockHasContent(undefined)).toBe(false);
    expect(axesBlockHasContent({})).toBe(false);
    const withX: AxesBlock = { x: { label: "Field" } };
    expect(axesBlockHasContent(withX)).toBe(true);
    const withTitle: AxesBlock = { title: "My graph" };
    expect(axesBlockHasContent(withTitle)).toBe(true);
  });
});

// ── buildDisplayBlock ────────────────────────────────────────────────────────
describe("buildDisplayBlock", () => {
  it("returns undefined when every plotted channel is fully default and order is ascending", () => {
    expect(buildDisplayBlock({}, [0, 1, 2], null, [], null)).toBeUndefined();
    expect(buildDisplayBlock({}, [0, 1, 2], null, [], [0, 1, 2])).toBeUndefined();
  });

  it("captures each real style field", () => {
    const styles = { 0: { color: "#ff8800", width: 2, marker: true, markerShape: "square" as const, line: "dashed" as const } };
    expect(buildDisplayBlock(styles, [0], null, [], null)).toEqual({
      series: { 0: { color: "#ff8800", width: 2, marker: true, markerShape: "square", line: "dashed" } },
    });
  });

  it("maps y2Keys membership to axis: 1 on the matching channel only", () => {
    expect(buildDisplayBlock({}, [0, 1], [1], [], null)).toEqual({ series: { 1: { axis: 1 } } });
  });

  it("marks hiddenChannels as hidden: true", () => {
    expect(buildDisplayBlock({}, [0, 1], null, [1], null)).toEqual({ series: { 1: { hidden: true } } });
  });

  it("combines hidden + axis + style on one channel", () => {
    const styles = { 2: { color: "#abc" } };
    expect(buildDisplayBlock(styles, [0, 1, 2], [2], [2], null)).toEqual({
      series: { 2: { color: "#abc", hidden: true, axis: 1 } },
    });
  });

  it("captures order only when it differs from ascending-plotted", () => {
    expect(buildDisplayBlock({}, [0, 1, 2], null, [], [0, 1, 2])).toBeUndefined();
    expect(buildDisplayBlock({}, [2, 0, 1], null, [], [2, 0, 1])).toEqual({ order: [2, 0, 1] });
  });

  it("ignores channels not in `plotted` even if styled", () => {
    const styles = { 5: { color: "#fff" } }; // channel 5 not plotted
    expect(buildDisplayBlock(styles, [0, 1], null, [], null)).toBeUndefined();
  });
});

// ── buildAxesBlock ───────────────────────────────────────────────────────────
describe("buildAxesBlock", () => {
  it("returns undefined for a fully-default axes state", () => {
    expect(
      buildAxesBlock({
        xLabel: "",
        yLabel: "",
        xScale: "linear",
        yScale: "linear",
        y2Scale: null,
        xLim: null,
        yLim: null,
        y2Lim: null,
        xStep: null,
        yStep: null,
        xFmt: { mode: "auto", digits: 2 },
        yFmt: { mode: "auto", digits: 2 },
      }),
    ).toBeUndefined();
    expect(buildAxesBlock({})).toBeUndefined();
  });

  it("captures non-blank labels, limits, non-default scale/step/fmt", () => {
    const block = buildAxesBlock({
      title: "My graph",
      xLabel: "Field",
      yLabel: "Moment",
      xLim: [0, 10],
      yScale: "log",
      xStep: 2,
      yFmt: { mode: "sci", digits: 3 },
    });
    expect(block).toEqual({
      title: "My graph",
      x: { label: "Field", lim: [0, 10], step: 2 },
      y: { label: "Moment", scale: "log", fmt: { mode: "sci", digits: 3 } },
    });
  });

  it("omits an 'auto' AxisFormat (matches axisFmtParam's own convention)", () => {
    expect(buildAxesBlock({ xLabel: "Field", xFmt: { mode: "auto", digits: 5 } })).toEqual({
      x: { label: "Field" },
    });
  });

  it("captures an explicit y2Scale (including 'linear', unlike x/y where linear is default)", () => {
    expect(buildAxesBlock({ y2Scale: "linear" })).toEqual({ y2: { scale: "linear" } });
    expect(buildAxesBlock({ y2Scale: "log" })).toEqual({ y2: { scale: "log" } });
    expect(buildAxesBlock({ y2Scale: null })).toBeUndefined();
  });

  it("captures xScale/yScale only when they differ from the linear default", () => {
    expect(buildAxesBlock({ xScale: "linear", yScale: "linear" })).toBeUndefined();
    expect(buildAxesBlock({ xScale: "log" })).toEqual({ x: { scale: "log" } });
  });

  it("treats a blank label as absent", () => {
    expect(buildAxesBlock({ xLabel: "", title: "" })).toBeUndefined();
  });
});
