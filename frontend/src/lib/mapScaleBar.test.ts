// The map scale bar's rules against the table the export asserts too
// (tests/fixtures/wire/map_scalebar.json, tests/test_map_scalebar.py), and the
// option's sanitizer at the one read boundary.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { niceLength, resolveScaleBar, scaleBarLayout } from "./mapScaleBar";
import { cleanScaleBars, scaleBarField, type ScaleBarCorner } from "./mapScaleBarOptions";
import { sanitizeMapViews } from "./mapView";
import { serializeMapViews } from "./mapViewSerialize";

const F = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "tests", "fixtures", "wire", "map_scalebar.json"), "utf8"),
);

describe("niceLength", () => {
  it.each<{ span: number; length: number | null }>(F.nice_length)("span $span", (c) => {
    const got = niceLength(c.span);
    if (c.length === null) expect(got).toBeNull();
    else expect(got).toBeCloseTo(c.length, 12);
  });
  it("is always 1, 2 or 5 times a power of ten, near a fifth of the axis", () => {
    for (const span of [3.7, 48, 820, 0.0031, 1.2e6]) {
      const len = niceLength(span) as number;
      const mantissa = len / 10 ** Math.floor(Math.log10(len));
      expect([1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9)).toBe(true);
      expect(len / span).toBeGreaterThanOrEqual(0.1);
      expect(len / span).toBeLessThanOrEqual(0.35);
    }
  });
});

describe("resolveScaleBar", () => {
  it.each<{ spec: { length?: number; label?: string; unit?: string }; span: number; length: number | null; text: string | null }>(F.resolve)(
    "$spec over $span",
    (c) => {
      const got = resolveScaleBar(c.spec, c.span, c.spec.unit);
      if (c.length === null) {
        expect(got).toBeNull();
        return;
      }
      expect(got?.length).toBeCloseTo(c.length, 12);
      expect(got?.text).toBe(c.text);
    },
  );
});

describe("scaleBarLayout", () => {
  it.each<{ corner: ScaleBarCorner; plot: number[]; bar_px: number; text: number[]; x0: number; x1: number; y: number; label_left: number; label_top: number }>(F.layout)(
    "$corner label $text",
    (c) => {
      const got = scaleBarLayout(c.corner, c.plot[0], c.plot[1], c.bar_px, c.text[0], c.text[1]);
      expect(got.x0).toBeCloseTo(c.x0, 9);
      expect(got.x1).toBeCloseTo(c.x1, 9);
      expect(got.y).toBeCloseTo(c.y, 9);
      expect(got.labelLeft).toBeCloseTo(c.label_left, 9);
      expect(got.labelTop).toBeCloseTo(c.label_top, 9);
    },
  );
});

describe("scale bar option", () => {
  it("keeps a valid option and defaults what is wrong, never throwing", () => {
    expect(scaleBarField({ length: 5, label: "5 nm", corner: "tl", color: "#FF0000" })).toEqual({
      scaleBar: { length: 5, label: "5 nm", corner: "tl", color: "#FF0000" },
    });
    expect(scaleBarField({ length: -1, label: 7, corner: "mid", color: "red" })).toEqual({
      scaleBar: { corner: "br", color: "#ffffff" },
    });
    expect(scaleBarField({ length: Infinity }).scaleBar).not.toHaveProperty("length");
    expect(scaleBarField({ length: NaN }).scaleBar).not.toHaveProperty("length");
    expect(scaleBarField({ label: "x".repeat(200) }).scaleBar?.label).toHaveLength(80);
    expect(scaleBarField(null)).toEqual({});
    expect(scaleBarField("bar")).toEqual({});
  });

  it("saves, reads and cleans: a hand-edited bar in a map view is repaired on open", () => {
    const views = {
      ds: { colormap: "viridis" as const, logZ: false, colorLimits: null, slices: [], annotations: [], scaleBar: { length: 5, corner: "tr" as const, color: "#00ff00" } },
    };
    const saved = JSON.parse(JSON.stringify(serializeMapViews(views)));
    expect(cleanScaleBars(sanitizeMapViews(saved)).ds.scaleBar).toEqual({ length: 5, corner: "tr", color: "#00ff00" });
    saved.ds.scaleBar = { length: "long", corner: "up", color: "url(x)", extra: 1 };
    expect(cleanScaleBars(sanitizeMapViews(saved)).ds.scaleBar).toEqual({ corner: "br", color: "#ffffff" });
  });
});
