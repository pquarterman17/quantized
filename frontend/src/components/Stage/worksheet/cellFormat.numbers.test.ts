// Worksheet cells and the Numbers prefs (PREFS_AUDIT lane 3, P1-7): defaults are
// byte-identical to the grid's own rule; the locale and "follow Numbers" are opt-in.

import { afterEach, describe, expect, it } from "vitest";

import { fmtNum, setFormatOpts } from "../../../lib/format";
import { NUMBER_PREF_DEFAULTS, type NumberPrefs, numberPrefsSlot, setFormatHooks, startNumberPrefs } from "../../../lib/locale";
import { columnFormatter, gridFormatters } from "./cellFormat";

const NBSP = " ";
const time = [0.5, 1234.5678, 2, 99999.5, -3];
const values = [[0.000123, 1], [0.5, 2], [1e-5, 3], [7, 4], [12345.6789, 5]];
const P = (o: Partial<NumberPrefs>) => ({ ...NUMBER_PREF_DEFAULTS, ...o });

afterEach(() => {
  setFormatOpts(6, "auto");
  setFormatHooks({});
  numberPrefsSlot.reset();
  localStorage.clear();
});

describe("gridFormatters and the Numbers prefs", () => {
  it("defaults: exactly the column formatter's text (byte-identical)", () => {
    startNumberPrefs();
    const f = gridFormatters(time, values);
    for (const col of [-1, 0, 1]) {
      const own = col < 0 ? columnFormatter(time.length, (r) => time[r]) : columnFormatter(values.length, (r) => values[r]?.[col]);
      const rows = col < 0 ? time : values.map((r) => r[col]);
      expect(rows.map((v) => f(col)(v))).toEqual(rows.map((v) => own(v)));
    }
  });

  it("decimal comma + grouping re-punctuate numeric cells; missing stays an em-dash", () => {
    startNumberPrefs();
    numberPrefsSlot.save(P({ decimal: "comma", grouping: "space" }));
    const base = columnFormatter(values.length, (r) => values[r]?.[0]);
    const f = gridFormatters(time, values)(0);
    expect(f(0.5)).toBe(base(0.5).replace(".", ","));
    expect(f(undefined)).toBe("—");
    const x = gridFormatters(time, values)(-1);
    expect(x(1234.5678)).toContain(","); // comma decimal, never a point
    expect(x(1234.5678)).not.toContain(".");
    expect(gridFormatters([20000, 30000], [[1], [2]])(-1)(20000)).toBe(`20${NBSP}000`); // an integer column prints in full, grouped
  });

  it("'follow Numbers' uses the Inspector's formatter (sig figs, notation, thresholds)", () => {
    startNumberPrefs();
    numberPrefsSlot.save(P({ worksheetCells: true, sciLow: -6 }));
    setFormatOpts(3, "scientific");
    const f = gridFormatters(time, values)(0);
    expect(f(1234.5678)).toBe(fmtNum(1234.5678));
    expect(f(1234.5678)).toBe("1.23e+3");
    setFormatOpts(4, "auto");
    const small = gridFormatters(time, values)(0)(0.00012345);
    expect(small).toBe(fmtNum(0.00012345));
    expect(small).not.toContain("e"); // threshold moved to 1e-6: fixed, not exponential
  });

  it("date and clock x columns and user column formats are not re-punctuated", () => {
    startNumberPrefs();
    numberPrefsSlot.save(P({ decimal: "comma" }));
    const f = gridFormatters(time, values, { 0: { format: { kind: "decimal", digits: 2 } } as never }, true);
    expect(f(-1)(0)).toBe("1970-01-01 00:00:00");
    expect(f(0)(0.5)).toBe("0.50");
  });
});
