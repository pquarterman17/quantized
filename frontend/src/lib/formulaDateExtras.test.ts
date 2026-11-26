// datedif, weeknum, quarter, monthname, weekdayname (lib/formulaDateExtras.ts).
// Reference values: Python's datetime (strftime %U / %W / isocalendar) and
// dateutil's month arithmetic through the existing datediff fixture; Origin's
// own documented example weeknum(1/11/2009) = 3, and the Origin 2026b COM
// measurements of 2026-11-25 noted at each table. All exact integers or text,
// so the comparison is exact.

import { describe, expect, it } from "vitest";

import { applyFormulasWithErrors, compileFormula } from "./formula";
import { makeEpoch } from "./formulaCalendar";
import { quarter, weekNum } from "./formulaDateExtras";
import { headlessFormulaProblem } from "./formulaHeadless";
import "./formulaRefs"; // registers the lazy extension
import type { DataStruct } from "./types";

const t = (y: number, m: number, d: number, hh = 0): number => makeEpoch(y, m, d, hh);

function column(expr: string, a: number[], b: number[] = a): number[] {
  const data: DataStruct = {
    time: a.map(() => 0),
    values: a.map((v, i) => [v, b[i]]),
    labels: ["A", "B"],
    units: ["", ""],
    metadata: {},
  };
  const { data: out, errors } = applyFormulasWithErrors(data, [{ name: "out", expr }]);
  expect(errors).toEqual({});
  return out.values.map((r) => r[2]);
}

describe("weeknum", () => {
  // Measured in Origin 2026b over COM, 2026-11-25: [y, m, d, n1=1 (Sunday start) for n2 = 0, 1, 2,
  // n1=2 (Monday start) for n2 = 0, 1, 2].
  const ORIGIN: [number, number, number, number[], number[]][] = [
    [2017, 1, 1, [1, 1, 1], [1, 1, 52]],
    [2021, 1, 1, [1, 1, 53], [1, 1, 53]],
    [2022, 1, 1, [1, 1, 52], [1, 1, 52]],
    [2023, 1, 1, [1, 1, 1], [1, 1, 52]],
    [2021, 1, 7, [2, 2, 1], [2, 2, 1]],
    [2021, 1, 10, [3, 3, 2], [2, 2, 1]],
    [2021, 12, 31, [53, 53, 52], [53, 53, 52]],
    [2025, 12, 29, [53, 53, 53], [53, 53, 1]],
    [2022, 1, 3, [2, 2, 1], [2, 2, 1]],
    [2018, 1, 1, [1, 1, 1], [1, 1, 1]],
    [2019, 1, 1, [1, 1, 1], [1, 1, 1]],
    [2020, 1, 1, [1, 1, 1], [1, 1, 1]],
  ];
  it("reproduces every combination measured in Origin", () => {
    for (const [y, m, d, sun, mon] of ORIGIN) {
      for (let n2 = 0; n2 < 3; n2++) {
        expect(weekNum(t(y, m, d), 1, n2), `${m}/${d}/${y} n1=1 n2=${n2}`).toBe(sun[n2]);
        expect(weekNum(t(y, m, d), 2, n2), `${m}/${d}/${y} n1=2 n2=${n2}`).toBe(mon[n2]);
      }
    }
  });
  it("defaults to Sunday weeks, week 1 holding 1 January (Origin's documented example)", () => {
    expect(weekNum(t(2009, 1, 11))).toBe(3);
    expect(column("weeknum(A)", [t(2009, 1, 11)])).toEqual([3]);
    expect(column("weeknum(A, 2, 2)", [t(2025, 12, 29)])).toEqual([1]);
  });
  it("n1 = 2, n2 = 2 is ISO 8601 (Python isocalendar)", () => {
    const iso: [number, number, number, number][] = [
      [2009, 1, 11, 2],
      [2009, 1, 1, 1],
      [2010, 1, 3, 53],
      [2024, 12, 30, 1],
      [2016, 1, 1, 53],
    ];
    for (const [y, m, d, w] of iso) expect(weekNum(t(y, m, d), 2, 2), `${y}-${m}-${d}`).toBe(w);
  });
  it("a bad option or a blank date is missing", () => {
    expect(weekNum(t(2020, 1, 1), 0)).toBeNaN();
    expect(weekNum(t(2020, 1, 1), 3)).toBeNaN();
    expect(weekNum(t(2020, 1, 1), 1, 3)).toBeNaN();
    expect(weekNum(NaN)).toBeNaN();
  });
});

describe("quarter", () => {
  it("1..4 by month", () => {
    expect([1, 3, 4, 6, 7, 9, 10, 12].map((m) => quarter(t(2026, m, 15)))).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(quarter(NaN)).toBeNaN();
  });
});

describe("datedif", () => {
  it("counts WHOLE days, months and years", () => {
    const a = [t(2001, 1, 1), t(2024, 1, 31), t(2024, 2, 29), t(2026, 3, 1, 23)];
    const b = [t(2003, 1, 1), t(2024, 2, 28), t(2025, 2, 28), t(2026, 3, 2, 1)];
    expect(column('datedif(A, B, "Y")', a, b)).toEqual([2, 0, 1, 0]);
    expect(column('datedif(A, B, "M")', a, b)).toEqual([24, 0, 12, 0]);
    expect(column('datedif(A, B, "D")', a, b)).toEqual([730, 28, 365, 0]);
    expect(column('datedif(A, B, "d")', a, b)).toEqual([730, 28, 365, 0]);
  });
  it("is negative backwards, missing for a blank, and checks the unit", () => {
    expect(column('datedif(A, B, "D")', [t(2026, 1, 10), NaN], [t(2026, 1, 1), t(2026, 1, 1)])).toEqual([-9, NaN]);
    expect(() => compileFormula('datedif(A, B, "week")')).toThrow(/unknown unit/);
    expect(() => compileFormula("datedif(A, B, 1)")).toThrow(/quotes/);
  });
});

describe("monthname / weekdayname (text, inside a text consumer)", () => {
  const d = [t(2007, 12, 20), t(2026, 3, 1), NaN]; // a Thursday, a Sunday
  const fri = [t(2021, 1, 1)]; // Friday, January
  it("names, lengths and styles", () => {
    expect(column("len(monthname(A))", d)).toEqual([3, 3, NaN]);
    expect(column("len(monthname(A, 0))", d)).toEqual([8, 5, NaN]);
    expect(column("len(monthname(A, 1))", d)).toEqual([1, 1, NaN]);
    expect(column('contains(monthname(A, 0), "ember")', d)).toEqual([1, 0, NaN]);
    expect(column('startswith(weekdayname(A, 0), "Thurs")', d)).toEqual([1, 0, NaN]);
    expect(column('contains(weekdayname(A, -1), "THU")', d)).toEqual([1, 0, NaN]);
    expect(column('contains(weekdayname(A), "Sun")', d)).toEqual([0, 1, NaN]);
    expect(column('contains(weekdayname(A, 1), "T")', d)).toEqual([1, 0, NaN]);
  });
  it("matches Origin's options (measured in Origin 2026b, 2026-11-25)", () => {
    // weekdayname: default "Fri", 0 "Friday", 1 "F", 2 "" (invalid), 3 "Fri"; monthname likewise with "Jan".
    const eq = (e: string, want: number): void => expect(column(e, fri), e).toEqual([want]);
    for (const [opt, wd, mo] of [
      ["", 3, 3],
      [", 0", 6, 7],
      [", 1", 1, 1],
      [", 2", 0, 0],
      [", 3", 3, 3],
    ] as const) {
      eq(`len(weekdayname(A${opt}))`, wd);
      eq(`len(monthname(A${opt}))`, mo);
    }
    eq('contains(weekdayname(A, 1), "F")', 1);
    eq('contains(monthname(A, 1), "J")', 1);
    eq('startswith(weekdayname(A, 0), "Friday")', 1);
    eq('startswith(monthname(A, 0), "January")', 1);
  });
  it("weekdayname's third argument is accepted and changes nothing", () => {
    const sun = [t(2026, 3, 1)];
    for (const n2 of [0, 1, 2]) expect(column(`startswith(weekdayname(A, 0, ${n2}), "Sunday")`, sun)).toEqual([1]);
  });
  it("a top-level name is refused", () => {
    expect(() => compileFormula("monthname(A)")).toThrow(/returns text/);
  });
});

describe("headless export", () => {
  it("refuses every date extra (app-only), with the function named", () => {
    for (const e of ['datedif(A, B, "Y")', "weeknum(A)", "quarter(A)", "len(monthname(A))", "len(weekdayname(A))"]) {
      expect(headlessFormulaProblem(e), e).not.toBeNull();
    }
  });
});
