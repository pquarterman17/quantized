import { describe, expect, it } from "vitest";

import { TYPEAHEAD_IDLE, TYPEAHEAD_RESET_MS, typeahead, typeaheadChar, type TypeaheadState } from "./libraryTreeTypeahead";

const names = ["Folder A", "Book alpha", "beta.dat", "Bravo", "alpha.csv", "Graph1"];

/** Feed `keys` one at a time, `gap` ms apart, from row `start`; returns every
 *  focus index the sequence produced (null where nothing matched). */
function run(keys: string, start = 0, gap = 10): Array<number | null> {
  let state: TypeaheadState = TYPEAHEAD_IDLE;
  let index = start;
  let now = 1_000;
  const out: Array<number | null> = [];
  for (const ch of keys) {
    const r = typeahead(names, index, state, ch, now);
    state = r.state;
    if (r.focusIndex != null) index = r.focusIndex;
    out.push(r.focusIndex);
    now += gap;
  }
  return out;
}

describe("typeahead", () => {
  it("one character moves to the NEXT row whose name starts with it, case-insensitively", () => {
    expect(run("b")).toEqual([1]); // "Book alpha", not the current row
    expect(run("B", 1)).toEqual([2]); // from "Book alpha" on to "beta.dat"
  });

  it("wraps around past the last row", () => {
    expect(run("f", 3)).toEqual([0]);
  });

  it("characters typed within the window accumulate into one prefix", () => {
    expect(run("br")).toEqual([1, 3]); // b -> Book alpha, br -> Bravo
  });

  it("a multi-character prefix keeps the current row when it still matches", () => {
    expect(run("bo")).toEqual([1, 1]);
  });

  it("a pause longer than the window starts a fresh search", () => {
    expect(run("bg", 0, TYPEAHEAD_RESET_MS + 1)).toEqual([1, 5]);
    expect(run("bg", 0, TYPEAHEAD_RESET_MS - 1)).toEqual([1, null]); // "bg" matches nothing
  });

  it("the same character repeated cycles through the rows starting with it", () => {
    expect(run("bbbb")).toEqual([1, 2, 3, 1]);
  });

  it("no match leaves focus where it is (null) but still records the buffer", () => {
    const r = typeahead(names, 0, TYPEAHEAD_IDLE, "z", 5);
    expect(r.focusIndex).toBeNull();
    expect(r.state).toEqual({ buffer: "z", at: 5 });
  });

  it("an empty tree never moves focus; index -1 (nothing focused yet) searches from the top", () => {
    expect(typeahead([], 0, TYPEAHEAD_IDLE, "a", 0).focusIndex).toBeNull();
    expect(typeahead(names, -1, TYPEAHEAD_IDLE, "a", 0).focusIndex).toBe(4);
    expect(typeahead(names, -1, TYPEAHEAD_IDLE, "f", 0).focusIndex).toBe(0);
  });
});

describe("typeaheadChar", () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    typeaheadChar({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

  it("accepts a single printable character, lower-cased", () => {
    expect(key("a")).toBe("a");
    expect(key("Q")).toBe("q");
    expect(key("7")).toBe("7");
    expect(key("é")).toBe("é");
  });

  it("rejects named keys, Space, and any Ctrl/Cmd/Alt chord", () => {
    for (const k of ["Enter", "ArrowDown", "Tab", "Shift", "F2", " "]) expect(key(k)).toBeNull();
    expect(key("a", { ctrlKey: true })).toBeNull();
    expect(key("a", { metaKey: true })).toBeNull();
    expect(key("a", { altKey: true })).toBeNull();
  });

  it('leaves "?" to the app (it opens the keyboard-shortcuts sheet)', () => {
    expect(key("?")).toBeNull();
  });
});
