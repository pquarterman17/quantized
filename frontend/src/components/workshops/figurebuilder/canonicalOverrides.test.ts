import { describe, expect, it } from "vitest";

import { defaultPlotView } from "../../../lib/plotview";
import { effectiveFigureOverrides, publicationOverridesDelta } from "./canonicalOverrides";

describe("effectiveFigureOverrides", () => {
  it("falls back to the view-derived overrides when publication is absent", () => {
    const view = defaultPlotView();
    const expected = { legend: { show: true, loc: "upper right" }, grid: true, spines: { top: false, right: false } };
    expect(effectiveFigureOverrides(view, undefined)).toEqual(expected);
    expect(effectiveFigureOverrides(view, null)).toEqual(expected);
  });

  it("layers the publication delta over the view-derived overrides, merging nested groups", () => {
    const view = { ...defaultPlotView(), legendTitle: "Series" };
    const effective = effectiveFigureOverrides(view, { font_name: "Times", legend: { frame: true } });
    expect(effective.font_name).toBe("Times");
    // `legend` MERGES (mergeFigureOverrides's nested-group rule): the
    // publication's `frame` layers over the view's derived show/loc/title
    // instead of replacing the whole group.
    expect(effective.legend).toEqual({ show: true, loc: "upper right", title: "Series", frame: true });
  });

  it("surfaces view-derived state a fresh publication delta never carries (the bug this module fixes)", () => {
    const view = { ...defaultPlotView(), annotations: [{ id: "a1", x: 1, y: 2, text: "Hi" }] };
    expect(effectiveFigureOverrides(view, null).annotations).toEqual([{ x: 1, y: 2, text: "Hi" }]);
  });
});

describe("publicationOverridesDelta", () => {
  it("writes only the top-level keys that changed from the effective (rendered) value", () => {
    const effective = { grid: true, legend: { show: true, loc: "upper right" } };
    const next = { grid: false, legend: { show: true, loc: "upper right" } };
    expect(publicationOverridesDelta(effective, next, null)).toEqual({ grid: false });
  });

  it("treats an array override as one whole value, not an element-wise merge", () => {
    const effective = { annotations: [{ x: 1, y: 2, text: "A" }] };
    const next = { annotations: [{ x: 5, y: 6, text: "A" }] };
    expect(publicationOverridesDelta(effective, next, null)).toEqual({
      annotations: [{ x: 5, y: 6, text: "A" }],
    });
  });

  it("leaves an unchanged array override out of the write-set even when both sides carry it", () => {
    const anns = [{ x: 1, y: 2, text: "A" }];
    const effective = { annotations: anns, grid: true };
    const next = { annotations: anns, grid: false };
    expect(publicationOverridesDelta(effective, next, null)).toEqual({ grid: false });
  });

  it("preserves untouched keys already present in the current publication delta", () => {
    const effective = { grid: true };
    const next = { grid: false };
    expect(publicationOverridesDelta(effective, next, { font_name: "Times" })).toEqual({
      font_name: "Times",
      grid: false,
    });
  });

  it("returns null (an absent override, not an empty object) when nothing changed and nothing was already set", () => {
    const effective = { grid: true, legend: { show: true } };
    expect(publicationOverridesDelta(effective, effective, null)).toBeNull();
  });
});
