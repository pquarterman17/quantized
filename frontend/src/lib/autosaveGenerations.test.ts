import { describe, expect, it } from "vitest";

import {
  capBySize,
  MAX_GENERATIONS,
  newestFirst,
  pickRestorable,
  rotate,
  totalSize,
  type Generation,
} from "./autosaveGenerations";

const gen = (at: number, text = `g${at}`): Generation => ({ at, text });
const always = () => true;

describe("rotate", () => {
  it("puts the newest generation first", () => {
    expect(rotate([gen(1)], gen(2)).map((g) => g.at)).toEqual([2, 1]);
  });

  it("drops the oldest past the cap", () => {
    let gens: Generation[] = [];
    for (const at of [1, 2, 3, 4, 5]) gens = rotate(gens, gen(at));
    expect(gens.map((g) => g.at)).toEqual([5, 4, 3]);
    expect(gens).toHaveLength(MAX_GENERATIONS);
  });

  it("never returns an empty set even with a nonsense cap", () => {
    // A zero/negative cap must not silently disable autosave entirely.
    expect(rotate([gen(1)], gen(2), 0)).toHaveLength(1);
    expect(rotate([gen(1)], gen(2), -5)).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    const existing = [gen(1)];
    rotate(existing, gen(2));
    expect(existing).toHaveLength(1);
  });
});

describe("pickRestorable", () => {
  it("returns the newest when it is valid", () => {
    expect(pickRestorable([gen(2), gen(1)], always)?.at).toBe(2);
  });

  it("falls back past a CORRUPT newest generation", () => {
    // The whole reason more than one generation exists: a bad newest snapshot
    // must not cost the user a good older one.
    const gens = [gen(3, "corrupt"), gen(2, "good"), gen(1, "good")];
    expect(pickRestorable(gens, (t) => t === "good")?.at).toBe(2);
  });

  it("returns null only when every generation is unusable", () => {
    expect(pickRestorable([gen(2), gen(1)], () => false)).toBeNull();
  });

  it("returns null for an empty set", () => {
    expect(pickRestorable([], always)).toBeNull();
  });

  it("respects recency even when the store hands back a jumbled order", () => {
    expect(pickRestorable([gen(1), gen(3), gen(2)], always)?.at).toBe(3);
  });
});

describe("capBySize", () => {
  it("keeps everything that fits", () => {
    const gens = [gen(3, "aaa"), gen(2, "bbb"), gen(1, "ccc")];
    expect(capBySize(gens, 100)).toHaveLength(3);
  });

  it("drops the oldest to fit the budget", () => {
    const gens = [gen(3, "aaaaa"), gen(2, "bbbbb"), gen(1, "ccccc")];
    expect(capBySize(gens, 12).map((g) => g.at)).toEqual([3, 2]);
  });

  it("ALWAYS keeps the newest, even when it alone blows the budget", () => {
    // One huge project must degrade to "a save that may fail loudly", never to
    // "no autosave at all, silently".
    const gens = [gen(2, "x".repeat(50)), gen(1, "y")];
    expect(capBySize(gens, 10).map((g) => g.at)).toEqual([2]);
  });

  it("returns empty only for empty input", () => {
    expect(capBySize([], 10)).toEqual([]);
  });
});

describe("newestFirst / totalSize", () => {
  it("sorts descending by timestamp", () => {
    expect(newestFirst([gen(1), gen(3), gen(2)]).map((g) => g.at)).toEqual([3, 2, 1]);
  });

  it("sums serialized length across generations", () => {
    expect(totalSize([gen(1, "abc"), gen(2, "de")])).toBe(5);
  });

  it("is zero for no generations", () => {
    expect(totalSize([])).toBe(0);
  });
});
