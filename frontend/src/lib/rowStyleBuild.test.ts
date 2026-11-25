// G24 row states: the level / gradient -> colour and marker mapping. The
// oracles are literal: the theme slot of level k is `s{k % 8 + 1}` (the same
// rule `plotEncoding` gives a Color zone: SERIES_VARS[k % 8]), the marker is
// AUTO_MARKER_CYCLE[k % 8], and a gradient's ends are the colormap's own end
// stops (viridis #440154 .. #fde725, matplotlib's published endpoints).

import { describe, expect, it } from "vitest";

import { buildRowStyle, levelSlot, MAX_ROW_STYLE_LEVELS, mergeRowStyle } from "./rowStyleBuild";
import { AUTO_MARKER_CYCLE } from "./seriesStyleCycle";
import type { DataStruct } from "./types";

// ch0 Sample (codes 2,0,1,0,2,NaN; level order = ascending code), ch1 T.
const data: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[2, 10], [0, 20], [1, 30], [0, 40], [2, 50], [NaN, 60]],
  labels: ["Sample", "T"],
  units: ["", "K"],
  metadata: {},
  cat_levels: { 0: ["a", "b", "c"] },
};

describe("buildRowStyle: levels", () => {
  it("level k takes slot s(k+1) and AUTO_MARKER_CYCLE[k]; a missing cell takes none", () => {
    const r = buildRowStyle(data, { column: 0, mode: "levels", color: true, marker: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.style.color).toEqual(["s3", "s1", "s2", "s1", "s3", ""]);
    expect(r.style.marker).toEqual([AUTO_MARKER_CYCLE[2], AUTO_MARKER_CYCLE[0], AUTO_MARKER_CYCLE[1], AUTO_MARKER_CYCLE[0], AUTO_MARKER_CYCLE[2], ""]);
    expect(r.style.legend).toEqual({
      column: "Sample", kind: "levels",
      entries: [
        { label: "a", color: "s1", marker: "circle" },
        { label: "b", color: "s2", marker: "square" },
        { label: "c", color: "s3", marker: "triangle" },
      ],
    });
  });

  it("is deterministic: the same column builds the same style, twice", () => {
    const req = { column: 0, mode: "levels", color: true, marker: true } as const;
    expect(buildRowStyle(data, req)).toEqual(buildRowStyle(data, req));
  });

  it("colour only leaves the marker array absent; marker only leaves the colour absent", () => {
    const c = buildRowStyle(data, { column: 0, mode: "levels", color: true, marker: false });
    const m = buildRowStyle(data, { column: 0, mode: "levels", color: false, marker: true });
    expect(c.ok && c.style.marker).toBeUndefined();
    expect(m.ok && m.style.color).toBeUndefined();
  });

  it("levels past slot 8 wrap, and past the cap the build is refused (fail closed)", () => {
    expect(levelSlot(8)).toBe("s1");
    const n = MAX_ROW_STYLE_LEVELS + 1;
    const many: DataStruct = { ...data, time: Array.from({ length: n }, (_, i) => i), values: Array.from({ length: n }, (_, i) => [i, 0]), cat_levels: undefined };
    const r = buildRowStyle(many, { column: 0, mode: "levels", color: true, marker: false });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("65 distinct levels") });
  });

  it("refuses nothing-to-do requests with a reason", () => {
    expect(buildRowStyle(data, { column: 0, mode: "levels", color: false, marker: false }).ok).toBe(false);
    expect(buildRowStyle(data, { column: 9, mode: "levels", color: true, marker: false }).ok).toBe(false);
    expect(buildRowStyle(data, { column: 0, mode: "gradient", color: false, marker: true }).ok).toBe(false);
  });
});

describe("buildRowStyle: a text column", () => {
  const withText: DataStruct = { ...data, metadata: { origin_text_columns: { Sample: ["x1", "y2", "x1", " y2 ", "", "z3"] } } };

  it("levels by first appearance (trimmed); a blank cell takes no state", () => {
    const r = buildRowStyle(withText, { column: "Sample", mode: "levels", color: true, marker: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.style.color).toEqual(["s1", "s2", "s1", "s2", "", "s3"]);
    expect(r.style.legend?.entries.map((e) => e.label)).toEqual(["x1", "y2", "z3"]);
    expect(r.style.legend?.column).toBe("Sample");
  });

  it("refuses a missing column and a gradient over text", () => {
    expect(buildRowStyle(withText, { column: "Nope", mode: "levels", color: true, marker: false }).ok).toBe(false);
    expect(buildRowStyle(withText, { column: "Sample", mode: "gradient", color: true, marker: false }).ok).toBe(false);
  });
});

describe("buildRowStyle: gradient", () => {
  it("maps the finite range through the colormap: the ends are the colormap's end stops", () => {
    const r = buildRowStyle(data, { column: 1, mode: "gradient", color: true, marker: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.style.color?.[0]).toBe("#440154");
    expect(r.style.color?.[5]).toBe("#fde725");
    expect(r.style.legend).toMatchObject({ kind: "gradient", column: "T", lo: 10, hi: 60, colormap: "viridis" });
  });

  it("a column with no finite value is refused", () => {
    const blank = { ...data, values: data.values.map(([s]) => [s, NaN]) };
    expect(buildRowStyle(blank, { column: 1, mode: "gradient", color: true, marker: false }).ok).toBe(false);
  });
});

describe("mergeRowStyle", () => {
  it("replaces colour and marker independently; the legend is the latest build's", () => {
    const c = buildRowStyle(data, { column: 0, mode: "levels", color: true, marker: false });
    const m = buildRowStyle(data, { column: 1, mode: "levels", color: false, marker: true });
    if (!c.ok || !m.ok) throw new Error("build");
    const merged = mergeRowStyle(c.style, m.style);
    expect(merged.color).toBe(c.style.color);
    expect(merged.marker).toBe(m.style.marker);
    expect(merged.legend?.column).toBe("T");
  });
});
