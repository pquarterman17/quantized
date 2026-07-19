import { describe, expect, it } from "vitest";

import {
  axesBlockHasContent,
  buildAxesBlock,
  buildDecorBlock,
  buildDisplayBlock,
  decorBlockHasContent,
  displayBlockHasContent,
  validateAxesBlock,
  validateDecorBlock,
  validateDisplayBlock,
  buildPageBlock,
  pageBlockHasContent,
  validatePageBlock,
  type AxesBlock,
  type DecorBlock,
  type DisplayBlock,
} from "./plotspec2";
import type { PageSetup } from "./pagesetup";
import type { Annotation, Shape } from "./types";

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

  it("omits y2Fmt when null (inherit yFmt) — never flips a spec to v2 on its own", () => {
    expect(buildAxesBlock({ y2Fmt: null })).toBeUndefined();
    expect(buildAxesBlock({ y2Fmt: undefined })).toBeUndefined();
  });

  it("captures an explicit y2Fmt independently of yFmt", () => {
    expect(
      buildAxesBlock({ yFmt: { mode: "auto", digits: 2 }, y2Fmt: { mode: "sci", digits: 3 } }),
    ).toEqual({ y2: { fmt: { mode: "sci", digits: 3 } } });
  });

  it("captures xScale/yScale only when they differ from the linear default", () => {
    expect(buildAxesBlock({ xScale: "linear", yScale: "linear" })).toBeUndefined();
    expect(buildAxesBlock({ xScale: "log" })).toEqual({ x: { scale: "log" } });
  });

  it("treats a blank label as absent", () => {
    expect(buildAxesBlock({ xLabel: "", title: "" })).toBeUndefined();
  });
});

// ── validateDecorBlock ("part C") ───────────────────────────────────────────
describe("validateDecorBlock", () => {
  it("returns null only when the input isn't an object", () => {
    expect(validateDecorBlock(null)).toBeNull();
    expect(validateDecorBlock(undefined)).toBeNull();
    expect(validateDecorBlock("nope")).toBeNull();
    expect(validateDecorBlock(5)).toBeNull();
  });

  it("returns an empty (but non-null) block for an empty object", () => {
    expect(validateDecorBlock({})).toEqual({});
  });

  it("captures a well-formed annotation + shape + legend via the reused sanitizers", () => {
    const v = {
      annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }],
      shapes: [{ id: "s1", kind: "arrow", x1: 0, y1: 0, x2: 1, y2: 1 }],
      legend: { pos: "sw", xy: [0.2, 0.8], title: "Nb/Au" },
    };
    expect(validateDecorBlock(v)).toEqual({
      annotations: [{ id: "a1", x: 1, y: 2, text: "peak" }],
      shapes: [{ id: "s1", kind: "arrow", x1: 0, y1: 0, x2: 1, y2: 1 }],
      legend: { pos: "sw", xy: [0.2, 0.8], title: "Nb/Au" },
    });
  });

  it("drops a malformed annotation/shape entry per-entry via sanitizeAnnotations/sanitizeShapes, never nulls the block", () => {
    const v = {
      annotations: [{ id: "a1", x: 1, y: 2, text: "ok" }, { x: 1, y: 2 }], // missing id — dropped
      shapes: [{ id: "s1", kind: "bogus", x1: 0, y1: 0, x2: 1, y2: 1 }], // unknown kind — dropped
    };
    expect(validateDecorBlock(v)).toEqual({
      annotations: [{ id: "a1", x: 1, y: 2, text: "ok" }],
    });
  });

  it("omits annotations/shapes keys entirely when the sanitized list is empty", () => {
    expect(validateDecorBlock({ annotations: [], shapes: [] })).toEqual({});
    expect(validateDecorBlock({ annotations: "not an array" })).toEqual({});
  });

  it("drops an unknown legend.pos value and an out-of-shape legend.xy, keeping the rest", () => {
    expect(validateDecorBlock({ legend: { pos: "center" } })).toEqual({});
    expect(validateDecorBlock({ legend: { pos: "nw", xy: "not a tuple" } })).toEqual({
      legend: { pos: "nw" },
    });
  });

  it("clamps an out-of-range legend.xy into [0, 1] (legendXYOrNull's convention)", () => {
    expect(validateDecorBlock({ legend: { xy: [-0.5, 1.5] } })).toEqual({ legend: { xy: [0, 1] } });
  });

  it("drops a legend value that isn't an object, without nulling the whole block", () => {
    expect(validateDecorBlock({ legend: "fancy", shapes: [{ id: "s1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }] })).toEqual({
      shapes: [{ id: "s1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }],
    });
  });
});

// ── decorBlockHasContent ─────────────────────────────────────────────────────
describe("decorBlockHasContent", () => {
  it("is false for null/undefined/empty/empty-array fields", () => {
    expect(decorBlockHasContent(null)).toBe(false);
    expect(decorBlockHasContent(undefined)).toBe(false);
    expect(decorBlockHasContent({})).toBe(false);
    expect(decorBlockHasContent({ annotations: [] })).toBe(false);
    expect(decorBlockHasContent({ shapes: [] })).toBe(false);
  });

  it("is true with any annotation, shape, or legend content", () => {
    const withAnn: DecorBlock = { annotations: [{ id: "a1", x: 0, y: 0, text: "x" }] };
    expect(decorBlockHasContent(withAnn)).toBe(true);
    const withShape: DecorBlock = { shapes: [{ id: "s1", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }] };
    expect(decorBlockHasContent(withShape)).toBe(true);
    const withLegend: DecorBlock = { legend: { pos: "sw" } };
    expect(decorBlockHasContent(withLegend)).toBe(true);
  });
});

// ── buildDecorBlock ──────────────────────────────────────────────────────────
describe("buildDecorBlock", () => {
  const ANN: Annotation = { id: "a1", x: 1, y: 2, text: "peak" };
  const SHAPE: Shape = { id: "s1", kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1 };

  it("returns undefined for a fully-default capture (no overlays, default legend)", () => {
    expect(buildDecorBlock([], [], { pos: "ne", xy: null, title: null })).toBeUndefined();
  });

  it("captures annotations/shapes verbatim when present", () => {
    expect(buildDecorBlock([ANN], [SHAPE], { pos: "ne", xy: null, title: null })).toEqual({
      annotations: [ANN],
      shapes: [SHAPE],
    });
  });

  it("captures legend.pos only when it differs from the 'ne' default", () => {
    expect(buildDecorBlock([], [], { pos: "ne", xy: null, title: null })).toBeUndefined();
    expect(buildDecorBlock([], [], { pos: "sw", xy: null, title: null })).toEqual({
      legend: { pos: "sw" },
    });
  });

  it("captures a free legend.xy independently of pos", () => {
    expect(buildDecorBlock([], [], { pos: "ne", xy: [0.2, 0.8], title: null })).toEqual({
      legend: { xy: [0.2, 0.8] },
    });
  });

  it("captures a non-blank legend.title only", () => {
    expect(buildDecorBlock([], [], { pos: "ne", xy: null, title: "" })).toBeUndefined();
    expect(buildDecorBlock([], [], { pos: "ne", xy: null, title: "Nb/Au" })).toEqual({
      legend: { title: "Nb/Au" },
    });
  });

  it("combines overlays + legend into one block", () => {
    expect(buildDecorBlock([ANN], [SHAPE], { pos: "sw", xy: [0.1, 0.1], title: "Nb/Au" })).toEqual({
      annotations: [ANN],
      shapes: [SHAPE],
      legend: { pos: "sw", xy: [0.1, 0.1], title: "Nb/Au" },
    });
  });
});

// ── page block (#54 pass C) ──────────────────────────────────────────────────
const PAGE: PageSetup = {
  width: 8.5,
  height: 11,
  unit: "in",
  margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 },
  aspectDerived: false,
};

describe("validatePageBlock", () => {
  it("returns null only when the input isn't an object at all", () => {
    expect(validatePageBlock(null)).toBeNull();
    expect(validatePageBlock("page")).toBeNull();
    expect(validatePageBlock(7)).toBeNull();
    expect(validatePageBlock({})).toEqual({});
  });

  it("keeps valid stack/fit/setup", () => {
    expect(validatePageBlock({ stack: true, fit: "page", setup: PAGE })).toEqual({
      stack: true,
      fit: "page",
      setup: PAGE,
    });
  });

  it("keeps an explicit stack:false (a boolean is a boolean)", () => {
    expect(validatePageBlock({ stack: false })).toEqual({ stack: false });
  });

  it("drops a malformed field without dropping the block", () => {
    expect(validatePageBlock({ stack: "yes", fit: "sideways", setup: 3 })).toEqual({});
    expect(validatePageBlock({ stack: true, fit: "sideways" })).toEqual({ stack: true });
  });

  it("CLAMPS a bad page setup through the shared sanitizer rather than dropping it", () => {
    // Deliberate divergence from the sibling fields (a bad `fit` DROPS): the
    // decor block's own precedent is to reuse the `.dwk` restore sanitizer for
    // a shape rather than grow a second, drifting validator for it, and
    // `sanitizePageSetup` is a CLAMPING gate (Math.max floors, unit falls back
    // to "in"). Nothing invalid escapes either way; it just normalizes instead
    // of discarding. Asserted explicitly so the divergence stays intentional.
    expect(validatePageBlock({ setup: { width: -1, height: 11, unit: "in" } })?.setup).toMatchObject({
      width: 0.01,
      height: 11,
      unit: "in",
    });
    expect(validatePageBlock({ setup: { width: 8.5, height: 11, unit: "furlongs" } })?.setup).toMatchObject({
      unit: "in",
    });
  });
});

describe("pageBlockHasContent", () => {
  it("is the v1/v2 promotion gate", () => {
    expect(pageBlockHasContent(null)).toBe(false);
    expect(pageBlockHasContent(undefined)).toBe(false);
    expect(pageBlockHasContent({})).toBe(false);
    expect(pageBlockHasContent({ stack: false })).toBe(true);
    expect(pageBlockHasContent({ fit: "window" })).toBe(true);
    expect(pageBlockHasContent({ setup: PAGE })).toBe(true);
  });
});

describe("buildPageBlock", () => {
  it("captures nothing when every field is default (never flips a spec to v2)", () => {
    expect(buildPageBlock({ stackMode: false, panelFit: "frames", pageSetup: null })).toBeUndefined();
  });

  it("captures stacking", () => {
    expect(buildPageBlock({ stackMode: true, panelFit: "frames", pageSetup: null })).toEqual({ stack: true });
  });

  it("captures a non-default fit only", () => {
    expect(buildPageBlock({ stackMode: false, panelFit: "page", pageSetup: null })).toEqual({ fit: "page" });
    expect(buildPageBlock({ stackMode: false, panelFit: "window", pageSetup: null })).toEqual({ fit: "window" });
  });

  it("captures the page model", () => {
    expect(buildPageBlock({ stackMode: false, panelFit: "frames", pageSetup: PAGE })).toEqual({ setup: PAGE });
  });

  it("round-trips a full capture through the validator", () => {
    const built = buildPageBlock({ stackMode: true, panelFit: "page", pageSetup: PAGE });
    expect(validatePageBlock(built)).toEqual(built);
  });
});
