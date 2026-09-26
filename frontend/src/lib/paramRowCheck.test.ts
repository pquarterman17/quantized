// The one row validator shared by the registry and equation fit tables
// (audit P2.7 review): same checks, same wording, per-table blank start.

import { describe, expect, it } from "vitest";

import { ALL_HELD_ERROR, allHeld, checkParamRow, type ParamRowInput } from "./paramRowCheck";

const row = (patch: Partial<ParamRowInput> = {}): ParamRowInput => ({
  name: "a",
  start: "1",
  min: "",
  max: "",
  held: false,
  ...patch,
});

describe("checkParamRow", () => {
  it("reads numbers; blank bounds are open sides", () => {
    expect(checkParamRow(row({ min: "0" }), { startLabel: "guess" })).toEqual({ start: 1, lo: 0, hi: null });
  });

  it("blank start: an error without a fallback, the fallback with one", () => {
    expect(checkParamRow(row({ start: " " }), { startLabel: "guess" })).toEqual({ error: "a: guess is not a number" });
    expect(checkParamRow(row({ start: "" }), { startLabel: "start", blankStart: 4 })).toEqual({
      start: 4,
      lo: null,
      hi: null,
    });
  });

  it("refuses, in order: unreadable numbers, min above max, held outside bounds", () => {
    const opts = { startLabel: "start" };
    expect(checkParamRow(row({ start: "x" }), opts)).toEqual({ error: "a: start is not a number" });
    expect(checkParamRow(row({ start: "Infinity" }), opts)).toEqual({ error: "a: start is not a number" });
    expect(checkParamRow(row({ min: "lo" }), opts)).toEqual({ error: "a: min is not a number" });
    expect(checkParamRow(row({ max: "hi" }), opts)).toEqual({ error: "a: max is not a number" });
    expect(checkParamRow(row({ min: "3", max: "1", held: true }), opts)).toEqual({ error: "a: min is above max" });
    expect(checkParamRow(row({ start: "5", max: "1", held: true }), opts)).toEqual({
      error: "a: held at 5, outside its bounds",
    });
    // A FREE start outside its bounds is the solver's to clip.
    expect(checkParamRow(row({ start: "5", max: "1" }), opts)).toEqual({ start: 5, lo: null, hi: 1 });
  });
});

describe("allHeld", () => {
  it("is true only for a non-empty all-held table", () => {
    expect(allHeld([true, true])).toBe(true);
    expect(allHeld([true, false])).toBe(false);
    expect(allHeld([])).toBe(false);
    expect(ALL_HELD_ERROR).toBe("every parameter is held — nothing left to fit");
  });
});
