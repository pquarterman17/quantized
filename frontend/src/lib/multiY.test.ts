// Origin-style multiple Y axes (gap audit 4 G11): the model, its validation
// at the file boundary, and the derivation the canvas and export share.

import { describe, expect, it } from "vitest";

import {
  MAX_EXTRA_Y, extraAxisFmt, multiYNote, newExtraYAxis, resolveExtraYAxes, sanitizeYAxes, sanitizeYAxisOf,
  withExtraYAxes, yScaleKey, type ExtraYAxis,
} from "./multiY";
import { assignYAxis, editYAxis } from "./multiYEdit";
import { sanitizePlotView } from "./plotview";
import type { AxisFormat } from "./types";

const PRIMARY = { scale: "linear" as const, fmt: { mode: "fixed" as const, digits: 3, reverse: true } };
const axis = (over: Partial<ExtraYAxis> = {}): ExtraYAxis => ({ ...newExtraYAxis(), ...over });

const isFmt = (f: unknown): f is AxisFormat => !!f && typeof f === "object" && ["auto", "fixed", "sci", "eng"].includes((f as AxisFormat).mode) && typeof (f as AxisFormat).digits === "number";
const sanitizeYAxesT = (v: unknown) => sanitizeYAxes(v, isFmt);

describe("validation at the .dwk / template boundary", () => {
  it("keeps valid axes field by field and defaults the damaged fields, slot kept", () => {
    const got = sanitizeYAxesT([
      { lim: [0, 5], scale: "log", step: 2, fmt: { mode: "sci", digits: 1, cross: 0, breaks: [[1, 2]], offset: 9, minor: 4 }, label: "M", color: "#AA0011" },
      { lim: [5, 1], scale: "probit", step: -1, fmt: { mode: 3 }, label: 7, color: "red" },
      "junk",
    ]);
    expect(got[0]).toEqual({ lim: [0, 5], scale: "log", step: 2, fmt: { mode: "sci", digits: 1, cross: 0, breaks: [[1, 2]], offset: 9, minor: 4 }, label: "M", color: "#AA0011" });
    // What a stacked right axis cannot draw is dropped when the axis is resolved.
    expect(resolveExtraYAxes([1], { yAxes: got, yAxisOf: { 1: 3 } }, PRIMARY).axes[0].fmt).toEqual({ mode: "sci", digits: 1, minor: 4 });
    expect(got[1]).toEqual(newExtraYAxis());
    expect(got[2]).toEqual(newExtraYAxis());
    expect(sanitizeYAxesT(Array.from({ length: 9 }, () => ({})))).toHaveLength(MAX_EXTRA_Y);
    expect(sanitizeYAxesT("nope")).toEqual([]);
  });

  it("keeps an assignment past the saved axes (an orphan, reported later) and drops nonsense", () => {
    expect(sanitizeYAxisOf({ 1: 3, 2: 8, 3: 9, 4: 2, x: 3, 5: 3.5, 6: "3" })).toEqual({ 1: 3, 2: 8 });
    expect(sanitizeYAxisOf(null)).toEqual({});
  });

  it("a saved view round-trips through the file sanitizer", () => {
    const view = sanitizePlotView({ yAxes: [{ lim: null, scale: null, step: null, fmt: null, label: "", color: null }], yAxisOf: { 2: 3, 4: 5 } });
    expect(view.yAxes).toEqual([newExtraYAxis()]);
    expect(view.yAxisOf).toEqual({ 2: 3, 4: 5 });
    expect(sanitizePlotView({}).yAxes).toEqual([]);
  });

  it("an extra axis' format keeps only what a stacked right axis can draw", () => {
    expect(extraAxisFmt({ mode: "auto", digits: 2, base: "2", prob: "percent", custom: { at: [1], labels: ["a"] }, cross: 0, offset: 5, rotate: 30, reverse: true }))
      .toEqual({ mode: "auto", digits: 2, base: "2", prob: "percent", custom: { at: [1], labels: ["a"] }, reverse: true });
  });
});

describe("resolveExtraYAxes", () => {
  const view = {
    yAxes: [axis({ label: " Moment ", color: "#123456" }), axis({ scale: "log", fmt: { mode: "eng", digits: 1 }, lim: [1, 10] })],
    yAxisOf: { 2: 4, 3: 3, 5: 3, 6: 9 },
  };

  it("collects each axis' plotted members in display order, axes in number order", () => {
    const { axes, orphans } = resolveExtraYAxes([5, 0, 2, 3, 6], view, PRIMARY);
    expect(axes.map((a) => [a.n, a.keys])).toEqual([[3, [5, 3]], [4, [2]]]);
    expect(orphans).toEqual([6]);
  });

  it("inherits Y1's scale and number format (not its own look) unless the axis has its own", () => {
    const [y3, y4] = resolveExtraYAxes([2, 3], view, PRIMARY).axes;
    expect(y3).toMatchObject({ scale: "linear", fmt: { mode: "fixed", digits: 3 }, label: "Moment", color: "#123456", lim: null });
    expect(y3.fmt.reverse).toBeUndefined();
    expect(y4).toMatchObject({ scale: "log", fmt: { mode: "eng", digits: 1 }, label: null, lim: [1, 10] });
  });

  it("a tick step without a fixed range is dropped (Y1's rule)", () => {
    const v = { yAxes: [axis({ step: 2 }), axis({ step: 2, lim: [0, 10] })], yAxisOf: { 2: 3, 3: 4 } };
    const [y3, y4] = resolveExtraYAxes([2, 3], v, PRIMARY).axes;
    expect(y3.step).toBeNull();
    expect(y4.step).toBe(2);
  });

  it("an axis no plotted series rides is not in play", () => {
    expect(resolveExtraYAxes([0, 1], view, PRIMARY).axes).toEqual([]);
  });

  it("re-tags the payload's series by channel, leaving overlays past the plotted list", () => {
    const payload = { series: [{ axis: 0 }, { axis: 1 }, { axis: 0 }, { axis: 0 }] };
    const { axes } = resolveExtraYAxes([0, 3, 2], view, PRIMARY);
    expect(withExtraYAxes(payload, [0, 3, 2], axes).series.map((s) => s.axis)).toEqual([0, 2, 3, 0]);
    expect(withExtraYAxes(payload, [0, 3, 2], [])).toBe(payload);
  });

  it("names the scale keys", () => {
    expect([undefined, 0, 1, 2, 5].map(yScaleKey)).toEqual(["y", "y", "y2", "y3", "y6"]);
  });

  it("says why, and never silently", () => {
    expect(multiYNote(null, [], String)).toBeNull();
    expect(multiYNote(null, [6], (ch) => `col${ch}`)).toBe("col6: assigned to a Y axis that no longer exists — drawn on Y1");
    expect(multiYNote("a multi-panel view", [], String)).toMatch(/not drawn in a multi-panel view/);
  });
});

describe("the assign / edit gestures", () => {
  const base = { y2Keys: [1, 4], yAxes: [axis()], yAxisOf: { 2: 3, 7: 6 } };

  it("moving a series to the next number makes the axis, dropping orphans first", () => {
    const patch = assignYAxis(base, 4, 4)!;
    expect(patch.yAxes).toHaveLength(2);
    expect(patch.yAxisOf).toEqual({ 2: 3, 4: 4 });
    expect(patch.y2Keys).toEqual([1]);
  });

  it("Y1 and Y2 come back out of the extra axes", () => {
    expect(assignYAxis(base, 2, 1)).toEqual({ yAxisOf: { 7: 6 }, y2Keys: [1, 4] });
    expect(assignYAxis(base, 2, 2)).toEqual({ yAxisOf: { 7: 6 }, y2Keys: [1, 2, 4] });
  });

  it("refuses a gap or more than the maximum", () => {
    expect(assignYAxis(base, 2, 5)).toBeNull();
    const full = { ...base, yAxes: Array.from({ length: MAX_EXTRA_Y }, () => axis()) };
    expect(assignYAxis(full, 2, MAX_EXTRA_Y + 3)).toBeNull();
    expect(assignYAxis(full, 2, MAX_EXTRA_Y + 2)).not.toBeNull();
  });

  it("removing an axis returns its series to Y1 and renumbers the later ones", () => {
    const s = { y2Keys: null, yAxes: [axis({ label: "a" }), axis({ label: "b" }), axis({ label: "c" })], yAxisOf: { 1: 3, 2: 4, 3: 5 } };
    const out = editYAxis(s, 1, null)!;
    expect(out.yAxes?.map((a) => a.label)).toEqual(["a", "c"]);
    expect(out.yAxisOf).toEqual({ 1: 3, 3: 4 });
    expect(editYAxis(s, 0, { color: "#000000" })!.yAxes?.[0].color).toBe("#000000");
    expect(editYAxis(s, 7, null)).toBeNull();
  });
});
