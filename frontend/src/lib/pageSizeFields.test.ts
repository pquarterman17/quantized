// Audit #5: the page size has ONE source of truth (the window's pageSetup),
// shared by the Export dialog and Page setup; and the default page is the size
// an export already uses (the "default" preset's 6 x 4 in), not 6 x 4.5.

import { describe, expect, it } from "vitest";

import { defaultPageSetup, marginFractions, pageSizeInches, toInches } from "./pageGeometry";
import { convertPageUnit, pageSetupFromFields, pageSizeFields } from "./pageSizeFields";
import type { PageSetup } from "./pagesetup";

const page = (over: Partial<PageSetup> = {}): PageSetup => ({
  width: 8.5, height: 6, unit: "cm", margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 }, aspectDerived: false, ...over,
});

describe("page size fields (Export dialog == Page setup)", () => {
  it("the default page is the default preset's own 6 x 4 in, with no margin", () => {
    const ps = defaultPageSetup();
    expect(pageSizeInches(ps)).toEqual({ width_in: 6, height_in: 4 });
    expect(ps.margins).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("seeds from the window's page, blank when there is none (= the preset size)", () => {
    expect(pageSizeFields(page()).map((f) => [f.key, f.default])).toEqual([["width", 8.5], ["height", 6], ["unit", "cm"]]);
    expect(pageSizeFields(null).map((f) => f.default)).toEqual(["", "", "in"]);
    expect(pageSizeFields(null)[2].options).toEqual(["cm", "mm", "in", "px"]);
  });

  it("blank answers keep the page as it is; a typed size makes or edits one", () => {
    expect(pageSetupFromFields({ width: 0, height: 0, unit: "in" }, null, defaultPageSetup)).toBeNull();
    const ps = page({ aspectDerived: true });
    expect(pageSetupFromFields({ width: 0, height: 0, unit: "cm" }, ps, defaultPageSetup)).toBe(ps);
    const made = pageSetupFromFields({ width: 85, height: 60, unit: "mm" }, null, defaultPageSetup)!;
    expect(made).toMatchObject({ width: 85, height: 60, unit: "mm", aspectDerived: false });
    expect(pageSizeInches(made).width_in).toBeCloseTo(8.5 / 2.54, 12);
    const edited = pageSetupFromFields({ width: 9, height: 6, unit: "cm" }, ps, defaultPageSetup)!;
    expect(edited).toMatchObject({ width: 9, height: 6, aspectDerived: false, margins: ps.margins });
  });

  it("one typed side keeps the other side's physical length, in the new unit", () => {
    const next = pageSetupFromFields({ width: 100, height: 0, unit: "mm" }, page(), defaultPageSetup)!;
    expect(next.unit).toBe("mm");
    expect(next.height).toBeCloseTo(60, 9);
    expect(next.margins.left).toBeCloseTo(5, 9);
  });

  it("a unit change alone converts the same physical page", () => {
    const mm = convertPageUnit(page(), "mm");
    expect(mm).toMatchObject({ unit: "mm" });
    expect(mm.width).toBeCloseTo(85, 9);
    expect(toInches(mm.width, "mm")).toBeCloseTo(toInches(8.5, "cm"), 12);
    // Margin fractions (the wire's page_pad) do not depend on the unit.
    const a = marginFractions(page());
    const b = marginFractions(mm);
    expect(b.left).toBeCloseTo(a.left, 12);
    expect(b.top).toBeCloseTo(a.top, 12);
  });
});
