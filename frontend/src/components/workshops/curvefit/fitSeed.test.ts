import { describe, expect, it } from "vitest";

import { convergedParams, seedStarts } from "./fitSeed";

describe("convergedParams", () => {
  it("returns the parameters of a converged fit only", () => {
    expect(convergedParams({ exitFlag: 1, params: [1, 2] }, 2)).toEqual([1, 2]);
    expect(convergedParams({ exitFlag: 0, params: [1, 2] }, 2)).toBeNull();
    expect(convergedParams({ params: [1, 2] }, 2)).toBeNull();
    expect(convergedParams({ exitFlag: 1, params: [1, null] }, 2)).toBeNull();
    expect(convergedParams({ exitFlag: 1, params: [1] }, 2)).toBeNull();
  });
});

describe("seedStarts", () => {
  it("clamps into the bounds and holds fixed parameters at the panel value", () => {
    expect(seedStarts([5, 50, 3], [1, 10, 1], [0, 0, null], [10, 20, null], [false, false, true])).toEqual([5, 20, 1]);
  });
  it("passes the prior through when the table has no bounds or holds", () => {
    expect(seedStarts([5, -7], undefined, undefined, undefined, undefined)).toEqual([5, -7]);
  });
  it("treats null and infinite bounds as open", () => {
    expect(seedStarts([5], [1], [null], [Infinity], undefined)).toEqual([5]);
  });
});
