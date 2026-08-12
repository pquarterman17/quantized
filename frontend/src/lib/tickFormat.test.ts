import { describe, expect, it } from "vitest";

import {
  isDateTickMode,
  normalizeTickDigits,
  TICK_DATE_OPTIONS,
  TICK_MODE_OPTIONS,
  xAxisIsDate,
} from "./tickFormat";

describe("tick-format vocabulary", () => {
  it("offers exactly the four numeric modes, in render order", () => {
    // Pinned: both the Inspector card and the Publication Preview panel render
    // from this list, and a figure's ticks must not change meaning depending
    // on which surface the user reached for.
    expect(TICK_MODE_OPTIONS.map((option) => option.value)).toEqual(["auto", "fixed", "sci", "eng"]);
  });

  it("keeps the date modes out of the numeric list", () => {
    expect(TICK_MODE_OPTIONS.some((option) => isDateTickMode(option.value))).toBe(false);
  });

  it("maps the date select's non-date option back to a numeric mode", () => {
    expect(TICK_DATE_OPTIONS[0]).toEqual({ value: "numeric", label: "Numeric" });
    expect(TICK_DATE_OPTIONS.slice(1).every((option) => isDateTickMode(option.value as never))).toBe(true);
  });
});

describe("isDateTickMode", () => {
  it("recognizes the three calendar modes and nothing else", () => {
    expect(["date", "time", "datetime"].map((m) => isDateTickMode(m as never))).toEqual([true, true, true]);
    expect(["auto", "fixed", "sci", "eng"].map((m) => isDateTickMode(m as never))).toEqual([false, false, false, false]);
  });
});

describe("xAxisIsDate", () => {
  it("offers date modes when the parser recognized the X column as timestamps", () => {
    expect(xAxisIsDate({ time_is_datetime: true }, "auto")).toBe(true);
  });

  it("withholds them on a physics axis — a date format there produces out-of-range epochs", () => {
    expect(xAxisIsDate({ technique: "vsm" }, "auto")).toBe(false);
    expect(xAxisIsDate(undefined, "auto")).toBe(false);
  });

  it("keeps them offered when a date mode is ALREADY selected, so it can be switched back", () => {
    // Otherwise a saved spec with a date mode on non-datetime data would
    // strand the user with no control to undo it.
    expect(xAxisIsDate(undefined, "datetime")).toBe(true);
  });

  it("treats a non-true time_is_datetime as not-a-date rather than truthy-coercing", () => {
    expect(xAxisIsDate({ time_is_datetime: "yes" }, "auto")).toBe(false);
    expect(xAxisIsDate({ time_is_datetime: 1 }, "auto")).toBe(false);
  });
});

describe("normalizeTickDigits", () => {
  it("rejects input that should not commit at all", () => {
    expect(normalizeTickDigits("")).toBeNull();
    expect(normalizeTickDigits("   ")).toBeNull();
    expect(normalizeTickDigits("abc")).toBeNull();
    expect(normalizeTickDigits("Infinity")).toBeNull();
  });

  it("clamps to 0..20 and rounds", () => {
    expect(normalizeTickDigits("-5")).toBe(0);
    expect(normalizeTickDigits("99")).toBe(20);
    expect(normalizeTickDigits("2.6")).toBe(3);
    expect(normalizeTickDigits("3")).toBe(3);
  });
});
