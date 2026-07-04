import { describe, expect, it } from "vitest";

import {
  groupDatasets,
  groupNames,
  hasAnyGroup,
  originBookFamilies,
  originSheetGroups,
} from "./grouping";
import type { Dataset } from "./types";

const ds = (id: string, group?: string): Dataset => ({
  id,
  name: id,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
  ...(group ? { group } : {}),
});

/** A dataset shaped like one book from an Origin multi-book import
 *  (useApp.importFiles): named "<stem>:<book>" with origin_book metadata. */
const book = (id: string, name: string, originBook = "Book1"): Dataset => ({
  id,
  name,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: { origin_book: originBook } },
});

describe("groupDatasets", () => {
  it("groups by .group, preserving first-appearance order", () => {
    const groups = groupDatasets([ds("a", "X"), ds("b", "Y"), ds("c", "X")]);
    expect(groups.map((g) => g.key)).toEqual(["X", "Y"]);
    expect(groups[0].items.map((d) => d.id)).toEqual(["a", "c"]);
    expect(groups[1].items.map((d) => d.id)).toEqual(["b"]);
  });

  it("puts the ungrouped bucket last with an 'Ungrouped' label", () => {
    const groups = groupDatasets([ds("a"), ds("b", "X"), ds("c")]);
    expect(groups.map((g) => g.label)).toEqual(["X", "Ungrouped"]);
    expect(groups[1].items.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("treats a blank/whitespace group as ungrouped", () => {
    const groups = groupDatasets([ds("a", "   ")]);
    expect(groups).toEqual([{ key: "", label: "Ungrouped", items: [groups[0].items[0]] }]);
  });

  it("returns an empty list for no datasets", () => {
    expect(groupDatasets([])).toEqual([]);
  });
});

describe("groupNames", () => {
  it("lists distinct non-empty groups in first-appearance order", () => {
    expect(groupNames([ds("a", "X"), ds("b", "Y"), ds("c", "X"), ds("d")])).toEqual(["X", "Y"]);
  });

  it("is empty when nothing is grouped", () => {
    expect(groupNames([ds("a"), ds("b", "  ")])).toEqual([]);
  });
});

describe("hasAnyGroup", () => {
  it("is true only when some dataset has a non-blank group", () => {
    expect(hasAnyGroup([ds("a"), ds("b")])).toBe(false);
    expect(hasAnyGroup([ds("a"), ds("b", "X")])).toBe(true);
    expect(hasAnyGroup([ds("a", "  ")])).toBe(false);
  });
});

describe("originBookFamilies", () => {
  it("groups datasets sharing an origin_book-stamped '<stem>:' name prefix", () => {
    const items = [
      book("b1", "XRD:Book1", "Book1"),
      book("b2", "XRD:Book2", "Book2"),
      ds("plain"), // an ordinary dataset, not from an Origin import
    ];
    const families = originBookFamilies(items);
    expect(families).toHaveLength(1);
    expect(families[0].stem).toBe("XRD");
    expect(families[0].members.map((d) => d.id)).toEqual(["b1", "b2"]);
  });

  it("excludes a single-book family (nothing to bulk-manage)", () => {
    expect(originBookFamilies([book("b1", "Moke:Book1")])).toEqual([]);
  });

  it("never matches on a plain colon in a user-given name (needs origin_book metadata)", () => {
    expect(originBookFamilies([ds("a:1"), ds("a:2")])).toEqual([]);
  });

  it("keeps first-appearance order across multiple families", () => {
    const items = [
      book("b1", "XRD:Book1"),
      book("c1", "Moke:Book1"),
      book("b2", "XRD:Book2"),
      book("c2", "Moke:Book2"),
    ];
    expect(originBookFamilies(items).map((f) => f.stem)).toEqual(["XRD", "Moke"]);
  });
});

describe("originSheetGroups", () => {
  it("groups a book's sheet-1 base name with its '<Book>@N' sheet pseudo-books", () => {
    const items = [
      book("s1", "XRD:Book4", "Book4"),
      book("s3", "XRD:Book4 — Book4 (sheet 3)", "Book4@3"),
      book("s2", "XRD:Book4 — Book4 (sheet 2)", "Book4@2"),
    ];
    const groups = originSheetGroups(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].parent).toBe("Book4");
    // Sorted by sheet number, not insertion order: sheet 1, then 2, then 3.
    expect(groups[0].members.map((d) => d.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("excludes a single-sheet book (nothing to relate)", () => {
    expect(originSheetGroups([book("s1", "XRD:Book1", "Book1")])).toEqual([]);
  });

  it("excludes datasets without origin_book metadata", () => {
    expect(originSheetGroups([ds("a"), ds("b")])).toEqual([]);
  });

  it("keeps distinct books as separate groups, first-appearance order", () => {
    const items = [
      book("a1", "XRD:Book4", "Book4"),
      book("a2", "XRD:Book4 (sheet 2)", "Book4@2"),
      book("b1", "Moke:Book7", "Book7"),
      book("b2", "Moke:Book7 (sheet 2)", "Book7@2"),
    ];
    expect(originSheetGroups(items).map((g) => g.parent)).toEqual(["Book4", "Book7"]);
  });

  it("keeps a group's sheets adjacent when the list is already in import order", () => {
    // useApp.importFiles appends `data.books` in the backend's order, which
    // already lists sheet 1 before sheet 2/3 of the same workbook (verified
    // against io/origin_project/opj.py's OrderedDict column-iteration order).
    // The Library renders datasets in that natural insertion order rather
    // than re-sorting — this asserts the natural order already agrees with
    // the sheet-number order `originSheetGroups` computes, so no additional
    // re-sort is needed at the list-rendering layer.
    const items = [
      book("s1", "XRD:Book4", "Book4"),
      book("s2", "XRD:Book4 (sheet 2)", "Book4@2"),
      book("s3", "XRD:Book4 (sheet 3)", "Book4@3"),
      book("o1", "XRD:Book7", "Book7"),
    ];
    const insertionOrderIds = items.slice(0, 3).map((d) => d.id);
    const groups = originSheetGroups(items);
    expect(groups[0].members.map((d) => d.id)).toEqual(insertionOrderIds);
  });
});
