import { describe, expect, it, vi } from "vitest";

import type { ContextMenuItem } from "../components/overlays/ContextMenu";
import { edgeFocusableIndex, focusableIndices, nextFocusableIndex, typeaheadIndex } from "./menuKeyboardNav";

const items: ContextMenuItem[] = [
  { label: "Alpha", run: vi.fn() },
  { separator: true },
  { header: "Section" },
  { label: "Beta", run: vi.fn(), disabled: true },
  { label: "Gamma", run: vi.fn() },
  { swatches: [] },
  { label: "Apricot", run: vi.fn() },
];

describe("focusableIndices", () => {
  it("skips separators/headers/swatches/disabled entries", () => {
    expect(focusableIndices(items)).toEqual([0, 4, 6]); // Alpha, Gamma, Apricot
  });

  it("empty for an all-non-focusable list", () => {
    expect(focusableIndices([{ separator: true }, { header: "H" }])).toEqual([]);
  });
});

describe("nextFocusableIndex", () => {
  it("from -1 (nothing focused), ArrowDown goes to the first focusable item", () => {
    expect(nextFocusableIndex(items, -1, 1)).toBe(0);
  });
  it("from -1, ArrowUp goes to the LAST focusable item", () => {
    expect(nextFocusableIndex(items, -1, -1)).toBe(6);
  });
  it("cycles forward, skipping disabled/non-focusable in between", () => {
    expect(nextFocusableIndex(items, 0, 1)).toBe(4); // Alpha -> Gamma (Beta is disabled)
    expect(nextFocusableIndex(items, 4, 1)).toBe(6); // Gamma -> Apricot
  });
  it("wraps past the end back to the start", () => {
    expect(nextFocusableIndex(items, 6, 1)).toBe(0); // Apricot -> Alpha
  });
  it("cycles backward and wraps past the start", () => {
    expect(nextFocusableIndex(items, 0, -1)).toBe(6); // Alpha -> Apricot
  });
  it("null for a list with nothing focusable", () => {
    expect(nextFocusableIndex([{ separator: true }], -1, 1)).toBeNull();
  });
});

describe("edgeFocusableIndex", () => {
  it("start/end land on the first/last focusable item", () => {
    expect(edgeFocusableIndex(items, "start")).toBe(0);
    expect(edgeFocusableIndex(items, "end")).toBe(6);
  });
  it("null for a list with nothing focusable", () => {
    expect(edgeFocusableIndex([{ header: "H" }], "start")).toBeNull();
  });
});

describe("typeaheadIndex", () => {
  it("jumps to the first item whose label starts with the letter (case-insensitive)", () => {
    expect(typeaheadIndex(items, -1, "g")).toBe(4); // Gamma
    expect(typeaheadIndex(items, -1, "A")).toBe(0); // Alpha (first match after start=-1 -> 0)
  });
  it("repeated presses of the same letter cycle through every match, checking the current item LAST", () => {
    // Two "A" labels: Alpha (0) and Apricot (6). From Alpha, the next "a" press
    // should land on Apricot, then wrap back to Alpha.
    expect(typeaheadIndex(items, 0, "a")).toBe(6);
    expect(typeaheadIndex(items, 6, "a")).toBe(0);
  });
  it("no match returns null", () => {
    expect(typeaheadIndex(items, -1, "z")).toBeNull();
  });
});
