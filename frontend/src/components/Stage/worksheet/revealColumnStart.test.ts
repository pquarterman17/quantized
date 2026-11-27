import { describe, expect, it } from "vitest";

import { revealColumnStart, type RevealColumnInput } from "./revealColumnStart";

const W = 120;
const text = (shortName: string) => ({ shortName, rows: [] as string[] });
/** Three scrolling value columns of the default width; `startOfCol` / `startAfterCol` as the column axis gives them. */
const base = (over: Partial<RevealColumnInput> = {}): RevealColumnInput => ({
  column: 0,
  textCols: [],
  textAnchors: [],
  hidden: new Set(),
  pinned: [],
  colCount: 3,
  textWidth: W,
  startOfCol: (c) => (c >= 0 && c < 3 ? c * W : null),
  startAfterCol: (c) => (c >= 0 && c < 3 ? (c + 1) * W : null),
  ...over,
});

describe("revealColumnStart", () => {
  it("is the value column's own start when no text column leads", () => {
    expect(revealColumnStart(base({ column: 2 }))).toBe(2 * W);
    expect(revealColumnStart(base({ textCols: [text("t")], textAnchors: [2], column: 1 }))).toBe(W); // trailing text: nothing ahead
  });

  it("adds every text column placed before the numeric run", () => {
    const two = base({ textCols: [text("a"), text("b")], textAnchors: [-1, -1] });
    expect(revealColumnStart({ ...two, column: 0 })).toBe(2 * W);
    expect(revealColumnStart({ ...two, column: 2 })).toBe(4 * W);
  });

  it("puts a leading text column at its place among the leading ones, and one anchored later after its anchor", () => {
    const cols = base({ textCols: [text("a"), text("b"), text("late")], textAnchors: [-1, -1, 1] });
    expect(revealColumnStart({ ...cols, column: "a" })).toBe(0);
    expect(revealColumnStart({ ...cols, column: "b" })).toBe(W);
    expect(revealColumnStart({ ...cols, column: "late" })).toBe(2 * W + 2 * W); // after channel 1, plus the two leading ones
  });

  it("follows a hidden anchor to the nearest shown column before it, which leaves it ahead when none", () => {
    const cols = base({ textCols: [text("a")], textAnchors: [0], hidden: new Set([0]) });
    expect(revealColumnStart({ ...cols, column: 1, startOfCol: (c) => (c === 0 ? null : (c - 1) * W) })).toBe(W + 0);
  });

  it("is null for a column that does not scroll or does not exist", () => {
    expect(revealColumnStart(base({ column: 5 }))).toBeNull();
    expect(revealColumnStart(base({ column: -1 }))).toBeNull();
    expect(revealColumnStart(base({ column: undefined }))).toBeNull();
    expect(revealColumnStart(base({ column: "missing" }))).toBeNull();
    expect(revealColumnStart(base({ column: 1, startOfCol: () => null }))).toBeNull(); // hidden or pinned
  });

  it("counts a text column drawn right after the pinned run as ahead of the scrolling ones", () => {
    const cols = base({ textCols: [text("p")], textAnchors: [0], pinned: [0], startOfCol: (c) => (c - 1) * W });
    expect(revealColumnStart({ ...cols, column: 1 })).toBe(W); // ch0 pinned; "p" follows it, ahead of ch1
  });
});
