// A6 (visual sweep): Origin's auto axis-title codes are substituted from the
// layer's first curve's columns -- Long Name (Short Name when none) plus
// "(Units)" -- instead of being drawn raw. Catchment *.opju Graph6 is the
// corpus case (`%(?X)` -> "Year", `%(?Y)` -> "ΔS"); the option forms are the
// ones the corpus holds (`@LC`, `@WL`). Unknown options and unimported
// columns resolve to "" (the plot's data-derived label), never a guess.

import { describe, expect, it } from "vitest";

import { resolveAxisTitleCodes, withResolvedAxisTitles } from "./originAxisTitles";
import type { Dataset, OriginFigure } from "./types";

const ds: Dataset = {
  id: "d1",
  name: "Book1",
  data: {
    time: [1, 2],
    values: [[1, 2, 3, 4], [5, 6, 7, 8]],
    labels: ["Precipitation", "Precipitation (2)", "ΔS", "J"],
    units: ["mm", "mm", "", ""],
    metadata: {
      origin_book: "Book1",
      x_column_name: "D",
      x_column_long: "Year",
      x_column_unit: "",
      origin_column_names: ["B", "E", "I", "J"],
      column_comments: { I: "storage change" },
      origin_text_column_labels: { A: { long_name: "Month", unit: "" } },
    },
  },
};

const fig = (curves: OriginFigure["curves"], titles: Partial<OriginFigure> = {}): OriginFigure => ({
  name: "Graph6", x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false,
  n_curves: curves?.length ?? 0, annotations: [], curves, ...titles,
});

describe("resolveAxisTitleCodes (A6)", () => {
  const f = fig([{ book: "Book1", x: "D", y: "I" }]);

  it("substitutes the first curve's X and Y long names, with units when set", () => {
    expect(resolveAxisTitleCodes("%(?X)", f, [ds])).toBe("Year");
    expect(resolveAxisTitleCodes("%(?Y)", f, [ds])).toBe("ΔS");
    const withUnits = fig([{ book: "Book1", x: "D", y: "E" }]);
    // The DataStruct dedupe suffix is not part of Origin's Long Name.
    expect(resolveAxisTitleCodes("%(?Y)", withUnits, [ds])).toBe("Precipitation (mm)");
    expect(resolveAxisTitleCodes(" %(?Y)", withUnits, [ds])).toBe("Precipitation (mm)");
  });

  it("falls back to the Short Name when a column has no Long Name", () => {
    expect(resolveAxisTitleCodes("%(?Y)", fig([{ book: "Book1", x: "D", y: "J" }]), [ds])).toBe("J");
  });

  it("resolves the @ options Origin defines, and nothing else", () => {
    expect(resolveAxisTitleCodes("%(?Y,@LC)", f, [ds])).toBe("storage change");
    expect(resolveAxisTitleCodes("%(?Y, @LL)", f, [ds])).toBe("ΔS");
    expect(resolveAxisTitleCodes("%(?Y,@C)", f, [ds])).toBe("I");
    const e = fig([{ book: "Book1", x: "D", y: "E" }]);
    expect(resolveAxisTitleCodes("%(?Y, @LU)", e, [ds])).toBe("mm");
    expect(resolveAxisTitleCodes("%(?Y, @WL)", f, [ds])).toBe("");
  });

  it("names a text (category) X from its text-column labels", () => {
    expect(resolveAxisTitleCodes("%(?X)", fig([{ book: "Book1", x: "A", y: "B" }]), [ds])).toBe("Month");
  });

  it("is empty when the curve's book or column did not import (never a guess)", () => {
    expect(resolveAxisTitleCodes("%(?X)", fig([{ book: "Other", x: "A", y: "B" }]), [ds])).toBe("");
    expect(resolveAxisTitleCodes("%(?Y)", fig([{ book: "Book1", x: "D", y: "Z" }]), [ds])).toBe("");
    expect(resolveAxisTitleCodes("%(?Y)", fig([]), [ds])).toBe("");
  });

  it("leaves plain titles alone and keeps literal text around a code", () => {
    expect(resolveAxisTitleCodes("Field (Oe)", f, [ds])).toBe("Field (Oe)");
    expect(resolveAxisTitleCodes("%(?Y) per year", f, [ds])).toBe("ΔS per year");
  });

  it("withResolvedAxisTitles rewrites only the title fields, and returns the entry unchanged without codes", () => {
    const entry = { id: "e", stem: "C", datasetId: "d1", siblingIds: ["d1"], figure: { ...f, x_title: "%(?X)", y_title: "%(?Y)" } };
    const out = withResolvedAxisTitles(entry, [ds]);
    expect(out.figure.x_title).toBe("Year");
    expect(out.figure.y_title).toBe("ΔS");
    expect(out.figure.curves).toBe(entry.figure.curves);
    const plain = { ...entry, figure: { ...f, x_title: "Year" } };
    expect(withResolvedAxisTitles(plain, [ds])).toBe(plain);
  });
});
