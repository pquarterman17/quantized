// The screen's colour for a stat-plot glyph, which the export must reproduce (tests/test_stat_export_single_group.py
// pins the export side: a one-group box/violin/strip is drawn in the palette's FIRST colour).

import { describe, expect, it } from "vitest";

import { seriesColor } from "./seriesStyleCycle";
import { glyphColor } from "./statColor";

describe("glyphColor", () => {
  it("colours a lone group with the first series colour, with or without levels", () => {
    expect(glyphColor(null, 0)).toBe(seriesColor(0));
    expect(glyphColor(undefined, 0)).toBe(seriesColor(0));
    expect(glyphColor([null], 0)).toBe(seriesColor(0));
  });
  it("uses the level when there is one, else the position", () => {
    expect(glyphColor([2], 0)).toBe(seriesColor(2));
    expect(glyphColor([null, null], 1)).toBe(seriesColor(1));
  });
});
