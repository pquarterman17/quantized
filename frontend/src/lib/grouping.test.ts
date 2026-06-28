import { describe, expect, it } from "vitest";

import { groupDatasets, groupNames, hasAnyGroup } from "./grouping";
import type { Dataset } from "./types";

const ds = (id: string, group?: string): Dataset => ({
  id,
  name: id,
  data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} },
  ...(group ? { group } : {}),
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
