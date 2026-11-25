// The Numbers prefs' display half: the formatters, then the LOCALE INVARIANCE
// guarantee (a decimal comma / grouping never reaches saved, copied or
// exported text). Provisional rule, owner to confirm.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { analysisResultTableCsv } from "./analysisResultTable";
import { clipboardCellText, gridToClipboardText, parseCell } from "./clipboardGrid";
import { fmtNum, setFormatOpts } from "./format";
import { NUMBER_PREF_DEFAULTS, type NumberPrefs, fmtCount, fmtDisp, fmtDispStat, fmtInt, fmtStat, fmtWhen, hooksFor, numberPrefsSlot, punctuate, setFormatHooks, startNumberPrefs } from "./locale";
import { tablesToCSV, tablesToTSV } from "./statsTestsResults";
import type { Dataset } from "./types";
import { serializeWorkspace } from "./workspaceSerialize";
import { useApp } from "../store/useApp";

const P = (o: Partial<NumberPrefs>): NumberPrefs => ({ ...NUMBER_PREF_DEFAULTS, ...o });
const NBSP = " ";

beforeEach(() => localStorage.clear());
afterEach(() => {
  setFormatOpts(6, "auto");
  setFormatHooks({});
  numberPrefsSlot.reset();
  localStorage.clear();
});

describe("punctuate", () => {
  it("swaps the decimal separator and groups the integer part", () => {
    expect(punctuate("1234567.891", ",", NBSP)).toBe(`1${NBSP}234${NBSP}567,891`);
    expect(punctuate("-1234.5", ",", "")).toBe("-1234,5");
    expect(punctuate("−1234.5", ".", ",")).toBe("−1,234.5");
    expect(punctuate("1.50000e-4", ",", ".")).toBe("1,50000e-4");
    expect(punctuate("1234567", ".", ",")).toBe("1,234,567");
    expect(punctuate("123", ",", ".")).toBe("123");
  });

  it("leaves a non-number untouched", () => {
    expect(punctuate("—", ",", ".")).toBe("—");
    expect(punctuate("n/a", ",", ".")).toBe("n/a");
  });
});

describe("hooksFor", () => {
  it("defaults change no output", () => {
    const h = hooksFor(P({}));
    expect(h.num).toBeUndefined();
    expect(h.int).toBeUndefined();
    expect(h.when).toBeUndefined();
    expect(h.tick?.("-1.5", -1.5)).toBe("-1.5");
    expect(h.tick?.("60000", 60000)).toBe("60000");
  });

  it("decimal comma: numbers and ticks", () => {
    const h = hooksFor(P({ decimal: "comma" }));
    expect(h.num?.("0.25")).toBe("0,25");
    expect(h.tick?.("−0.5", -0.5)).toBe("−0,5");
  });

  it("a grouping character equal to the decimal one falls back to a no-break space", () => {
    const h = hooksFor(P({ decimal: "comma", grouping: "comma" }));
    expect(h.num?.("1234.5")).toBe(`1${NBSP}234,5`);
    expect(hooksFor(P({ grouping: "point" })).num?.("1234.5")).toBe(`1${NBSP}234.5`);
  });

  it("grouping: counts and numbers; None strips the browser's grouping", () => {
    expect(hooksFor(P({ grouping: "space" })).int?.(1234567)).toBe(`1${NBSP}234${NBSP}567`);
    expect(hooksFor(P({ grouping: "none" })).int?.(1234567, "en-US")).toBe("1234567");
    expect(hooksFor(P({ grouping: "comma" })).num?.("12345.6")).toBe("12,345.6");
  });

  it("Scientific notation reaches ticks as the shortest mantissa", () => {
    setFormatOpts(3, "scientific");
    const h = hooksFor(P({}));
    expect(h.tick?.("1500", 1500)).toBe("1.5e+3");
    expect(h.tick?.("−0.25", -0.25)).toBe("−2.5e-1");
    expect(h.tick?.("0", 0)).toBe("0");
    expect(h.tick?.("5.5")).toBe("5.5"); // a factored mantissa has no value: only punctuated
    expect(hooksFor(P({ decimal: "comma" })).tick?.("1500", 1500)).toBe("1,5e+3");
  });

  it("date / clock", () => {
    const d = new Date(2026, 10, 25, 14, 5, 9);
    expect(hooksFor(P({ dateFormat: "iso" })).when?.(d)).toBe("2026-11-25 14:05:09");
    expect(hooksFor(P({ dateFormat: "iso" })).when?.(d, "d")).toBe("2026-11-25");
    expect(hooksFor(P({ dateFormat: "iso" })).when?.(d, "t")).toBe("14:05:09");
    expect(hooksFor(P({ dateFormat: "iso" })).when?.(d, "hm")).toBe(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
    expect(hooksFor(P({ dateFormat: "iso" })).when?.(new Date(NaN))).toBe("Invalid Date");
    expect(hooksFor(P({ clock: "12h" })).when?.(d)).toBe(d.toLocaleString(undefined, { hour12: true }));
    expect(hooksFor(P({ clock: "12h" })).when?.(d, "hm")).toBe(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true }));
    expect(hooksFor(P({ clock: "24h" })).when?.(d)).toBe(d.toLocaleString(undefined, { hour12: false }));
  });
});

describe("startNumberPrefs", () => {
  it("applies the slot (thresholds + locale) now and on every later write", () => {
    startNumberPrefs();
    expect(fmtDisp(1234.5)).toBe(fmtNum(1234.5));
    numberPrefsSlot.save(P({ decimal: "comma", grouping: "space", sciLow: -5, sciHigh: 8 }));
    expect(fmtDisp(1234.5)).toBe(`1${NBSP}234,5`);
    expect(fmtDisp(1234567.5)).toBe(`1${NBSP}234${NBSP}570`); // 6 sig figs, then grouped
    expect(fmtDisp(0.0001)).toBe("0,0001"); // threshold moved from 1e-3 to 1e-5
    expect(fmtDispStat("N", 1234)).toBe(`1${NBSP}234`);
    expect(fmtInt(1234567)).toBe(`1${NBSP}234${NBSP}567`);
    numberPrefsSlot.reset();
    expect(fmtDisp(1234567.5)).toBe(fmtNum(1234567.5));
    expect(fmtDisp(1234.5)).toBe("1234.5");
    expect(fmtDisp(0.0001)).toBe("1.00000e-4");
  });

  it("a stored invalid value falls back to the default", () => {
    localStorage.setItem("qz.numberPrefs", JSON.stringify({ decimal: "semicolon", sciLow: 7, sciHigh: 1.5, alpha: 3, grouping: 5 }));
    expect(numberPrefsSlot.load()).toEqual(NUMBER_PREF_DEFAULTS);
  });
});

// ---- Locale invariance: DISPLAY ONLY ----------------------------------------
describe("locale invariance: a comma locale never reaches saved, copied or exported text", () => {
  const ds: Dataset = {
    id: "d1",
    name: "run.dat",
    data: { time: [1234567.5, 2], values: [[0.000123, 98765.4321], [3.25, 1e-9]], labels: ["a", "b"], units: ["", ""], metadata: { xLabel: "T" } },
  };
  const table = { title: "t", columns: ["x", "y"], rows: [[1234567.5, 0.25], [2, 3.5]] };
  // Everything a user can save / copy / export, built with the CURRENT hooks.
  const outputs = () => {
    useApp.setState({ datasets: [ds], activeId: "d1" });
    const s = useApp.getState();
    const dwk = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() }).replace(/"savedAt":\s*"[^"]*"/, '"savedAt":""');
    return {
      csv: analysisResultTableCsv(ds),
      tsvTables: tablesToTSV([table]),
      csvTables: tablesToCSV([table]),
      copyGrid: gridToClipboardText([[1234567.5, 0.25, "a,b"], [null, 2, "c"]]),
      copyCell: [1234567.5, 0.000123, -2.5].map((v) => clipboardCellText(v)),
      dwk,
      fmtNum: [1234567.5, 0.000123, -2.5].map(fmtNum),
      fmtStat: fmtStat("mean", 1234.5),
      fmtCount: fmtCount(1234567),
    };
  };

  it("CSV, TSV, clipboard data, .dwk and fmtNum are identical under comma + grouping", () => {
    const before = outputs();
    expect(before.csv).toContain("1234567.5"); // sanity: plain point, no grouping
    startNumberPrefs();
    numberPrefsSlot.save(P({ decimal: "comma", grouping: "space", dateFormat: "iso", clock: "12h", worksheetCells: true }));
    expect(fmtDisp(1234567.5)).toContain(","); // the locale really is on
    expect(outputs()).toEqual(before);
  });

  it("a pasted or typed point still parses; the display never feeds the parser", () => {
    startNumberPrefs();
    numberPrefsSlot.save(P({ decimal: "comma", grouping: "comma" }));
    expect(parseCell("1234.5")).toBe(1234.5);
    expect(parseCell(fmtNum(1234.5))).toBe(1234.5);
  });

  it("the only date/time hook is fmtWhen: ISO + comma leave data strings alone", () => {
    startNumberPrefs();
    numberPrefsSlot.save(P({ decimal: "comma", dateFormat: "iso" }));
    expect(fmtWhen(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02 03:04:05");
    expect(JSON.stringify({ t: 1.5 })).toBe('{"t":1.5}');
  });
});
