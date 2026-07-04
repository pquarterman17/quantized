import { describe, expect, it } from "vitest";

import { groupDatasets, groupNames, hasAnyGroup, originBookFamilies } from "./grouping";
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
