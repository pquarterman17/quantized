// Axis tick labels and the Numbers prefs (PREFS_AUDIT lane 3, P1-7): defaults
// are byte-identical; a decimal comma, grouping and Scientific are display-only.

import type uPlot from "uplot";
import { afterEach, describe, expect, it } from "vitest";

import { setFormatOpts } from "./format";
import { NUMBER_PREF_DEFAULTS, type NumberPrefs, numberPrefsSlot, setFormatHooks, startNumberPrefs } from "./locale";
import { tickFormatter } from "./uplotOpts";

const NBSP = " ";
const labels = (ticks: number[]) => tickFormatter(undefined, "linear")(null as unknown as uPlot, ticks, 1, 30, 0);
const P = (o: Partial<NumberPrefs>) => ({ ...NUMBER_PREF_DEFAULTS, ...o });
const CASES = [[0, 0.5, 1, 1.5], [-2, -1, 0, 1, 2], [0, 20000, 40000], [0.001, 0.002, 0.003], [1000, 2000, 3000]];

afterEach(() => {
  setFormatOpts(6, "auto");
  setFormatHooks({});
  numberPrefsSlot.reset();
  localStorage.clear();
});

describe("auto tick labels", () => {
  it("defaults: identical with the prefs module started and not", () => {
    const bare = CASES.map(labels);
    startNumberPrefs();
    expect(CASES.map(labels)).toEqual(bare);
    expect(labels([0, 0.5, 1, 1.5])).toEqual(["0.0", "0.5", "1.0", "1.5"]);
  });

  it("decimal comma, with the typographic minus kept", () => {
    startNumberPrefs();
    numberPrefsSlot.save(P({ decimal: "comma" }));
    expect(labels([0, 0.5, 1, 1.5])).toEqual(["0,0", "0,5", "1,0", "1,5"]);
    expect(labels([-2, -1, 0, 1, 2])[0]).toBe("−2,0".replace(",0", "") === "−2" ? "−2" : "−2");
  });

  it("grouping applies to a long tick", () => {
    startNumberPrefs();
    numberPrefsSlot.save(P({ grouping: "space" }));
    expect(labels([1000, 2000, 3000])).toEqual([`1${NBSP}000`, `2${NBSP}000`, `3${NBSP}000`]);
  });

  it("Scientific notation: ticks become mantissa-exponent; Auto/Fixed leave them alone", () => {
    startNumberPrefs();
    setFormatOpts(4, "scientific");
    expect(labels([1000, 2000, 3000])).toEqual(["1e+3", "2e+3", "3e+3"]);
    expect(labels([0, 0.5, 1, 1.5])).toEqual(["0.0", "5e-1", "1e+0", "1.5e+0"]); // zero stays "0.0"
    setFormatOpts(4, "fixed");
    expect(labels([1000, 2000, 3000])).toEqual(["1000", "2000", "3000"]);
  });
});
