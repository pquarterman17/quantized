import { describe, expect, it } from "vitest";

import { indexOfKey, navigate } from "./libraryTreeNav";
import type { FlatLibraryNode, LibraryNode } from "./libraryHierarchy";

// Minimal fixture rows — only the fields navigate()/indexOfKey() read.
const node = (key: string, parentKey: string | null): LibraryNode =>
  ({ key, parentKey } as unknown as LibraryNode);
const row = (key: string, parentKey: string | null, hasChildren = false, expanded = false): FlatLibraryNode => ({
  node: node(key, parentKey),
  hasChildren,
  expanded,
});

describe("navigate", () => {
  const rows = [
    row("folder:f1", null, true, true),
    row("workbook:w1", "folder:f1", true, false),
    row("worksheet:d1", null, false, false),
  ];

  it("down moves to the next row", () => {
    expect(navigate(rows, 0, "down")).toEqual({ focusIndex: 1, toggleIndex: null });
  });

  it("down is a no-op past the last row", () => {
    expect(navigate(rows, 2, "down")).toEqual({ focusIndex: null, toggleIndex: null });
  });

  it("up moves to the previous row", () => {
    expect(navigate(rows, 1, "up")).toEqual({ focusIndex: 0, toggleIndex: null });
  });

  it("up is a no-op before the first row", () => {
    expect(navigate(rows, 0, "up")).toEqual({ focusIndex: null, toggleIndex: null });
  });

  it("right on a collapsed parent toggles it in place (no focus move)", () => {
    expect(navigate(rows, 1, "right")).toEqual({ focusIndex: null, toggleIndex: 1 });
  });

  it("right on an already-expanded parent moves into its first (next) row", () => {
    expect(navigate(rows, 0, "right")).toEqual({ focusIndex: 1, toggleIndex: null });
  });

  it("right on a leaf is a no-op", () => {
    expect(navigate(rows, 2, "right")).toEqual({ focusIndex: null, toggleIndex: null });
  });

  it("left on an expanded parent collapses it in place (no focus move)", () => {
    expect(navigate(rows, 0, "left")).toEqual({ focusIndex: null, toggleIndex: 0 });
  });

  it("left on a collapsed child moves to its parent", () => {
    expect(navigate(rows, 1, "left")).toEqual({ focusIndex: 0, toggleIndex: null });
  });

  it("left at the root with no parent is a no-op", () => {
    expect(navigate(rows, 2, "left")).toEqual({ focusIndex: null, toggleIndex: null });
  });

  it("is a no-op for an out-of-range index", () => {
    expect(navigate(rows, 99, "down")).toEqual({ focusIndex: null, toggleIndex: null });
    expect(navigate(rows, -1, "up")).toEqual({ focusIndex: null, toggleIndex: null });
  });
});

describe("indexOfKey", () => {
  const rows = [row("a", null), row("b", null)];

  it("finds the row with the matching key", () => {
    expect(indexOfKey(rows, "b")).toBe(1);
  });

  it("returns -1 for a missing key", () => {
    expect(indexOfKey(rows, "gone")).toBe(-1);
  });

  it("returns -1 for a null key", () => {
    expect(indexOfKey(rows, null)).toBe(-1);
  });
});
