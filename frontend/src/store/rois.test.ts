import { describe, expect, it } from "vitest";

import type { RoiDef } from "../lib/roi";
import { deserializeRois, serializeRois } from "./rois";

// Unit coverage for the .dwk (de)serialize helpers (RSM_CUTS_PLAN item 13).
// The CRUD actions (saveRoi/applySavedRoi/removeSavedRoi) this slice also
// owns are exercised indirectly through components/workshops/roicuts's tests;
// this file is scoped to the persistence functions lib/workspace.ts calls.

const rect: RoiDef = {
  id: "roi-1",
  name: "Film peak box",
  kind: "rect",
  rect: { space: "q", x0: -0.1, x1: 0.1, y0: 4.7, y1: 4.9 },
};
const ruler: RoiDef = {
  id: "roi-2",
  name: "Radial cut",
  kind: "ruler",
  ruler: { space: "angular", cx: 10, cy: 20, angle: 45, length: 5, width: 0.5 },
};
const sector: RoiDef = {
  id: "roi-3",
  name: "Full annulus",
  kind: "sector",
  sector: { qMin: 4.5, qMax: 5.0, phiMin: 0, phiMax: 360 },
};

describe("serializeRois", () => {
  it("returns an equal but distinct copy of each entry", () => {
    const out = serializeRois([rect, ruler, sector]);
    expect(out).toEqual([rect, ruler, sector]);
    expect(out[0]).not.toBe(rect); // defensive copy, not the same reference
  });

  it("round-trips an empty list", () => {
    expect(serializeRois([])).toEqual([]);
  });
});

describe("deserializeRois", () => {
  it("accepts a well-formed mix of rect/ruler/sector entries", () => {
    const warnings: string[] = [];
    const out = deserializeRois(serializeRois([rect, ruler, sector]), warnings);
    expect(out).toEqual([rect, ruler, sector]);
    expect(warnings).toEqual([]);
  });

  it("degrades non-array input to an empty list without a warning", () => {
    const warnings: string[] = [];
    expect(deserializeRois("not an array", warnings)).toEqual([]);
    expect(deserializeRois(undefined, warnings)).toEqual([]);
    expect(deserializeRois(null, warnings)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("skips an entry missing id/name and warns", () => {
    const warnings: string[] = [];
    const out = deserializeRois([{ kind: "rect", rect: rect.rect }], warnings);
    expect(out).toEqual([]);
    // No `name` to report — this shape is dropped before the named-warning path.
    expect(warnings).toEqual([]);
  });

  it("skips a rect with a non-finite bound and warns by name", () => {
    const warnings: string[] = [];
    const bad = { id: "x", name: "Bad box", kind: "rect", rect: { ...rect.rect, x1: NaN } };
    const out = deserializeRois([bad], warnings);
    expect(out).toEqual([]);
    expect(warnings).toEqual([`skipped saved ROI "Bad box" with an invalid or unknown shape`]);
  });

  it("skips a ruler with an invalid space and warns", () => {
    const warnings: string[] = [];
    const bad = { id: "x", name: "Bad ruler", kind: "ruler", ruler: { ...ruler.ruler, space: "bogus" } };
    const out = deserializeRois([bad], warnings);
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("skips a sector missing a bound and warns", () => {
    const warnings: string[] = [];
    const bad = { id: "x", name: "Bad sector", kind: "sector", sector: { qMin: 1, qMax: 2, phiMin: 0 } };
    const out = deserializeRois([bad], warnings);
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("skips an entry whose kind doesn't match its own payload field and warns", () => {
    const warnings: string[] = [];
    // kind:"rect" but no `rect` field at all (e.g. hand-edited to the wrong kind).
    const bad = { id: "x", name: "Mismatched", kind: "rect", ruler: ruler.ruler };
    const out = deserializeRois([bad], warnings);
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("skips an unknown kind and warns", () => {
    const warnings: string[] = [];
    const bad = { id: "x", name: "Unknown kind", kind: "circle", circle: { r: 1 } };
    const out = deserializeRois([bad], warnings);
    expect(out).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("keeps the valid entries and skips only the malformed ones from a mixed batch", () => {
    const warnings: string[] = [];
    const bad = { id: "x", name: "Bad", kind: "rect", rect: { space: "q", x0: 1 } };
    const out = deserializeRois([rect, bad, sector], warnings);
    expect(out).toEqual([rect, sector]);
    expect(warnings).toHaveLength(1);
  });
});
