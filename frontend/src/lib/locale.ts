// Numbers / locale / statistics preferences (PREFS_AUDIT lane 3), slot
// `qz.numberPrefs`. Every default below equals what the app did before the
// pref existed; all of them are PROVISIONAL, owner to confirm.
//
// This one module is also the lazy display half (the hooks lib/format.ts calls,
// fmtDisp / fmtDispStat / fmtInt / fmtWhen, startNumberPrefs): a single lazy
// chunk, because the eager bundle has no budget left. With every pref at its
// default only identity hooks are installed and the output is today's.
//
// DISPLAY ONLY: a decimal comma or grouping reaches labels the user reads
// (worksheet cells, axis ticks, Inspector readouts). It never reaches CSV /
// TSV, the clipboard's data formats, Origin export, `.dwk` or any API payload:
// those paths format with their own plain "." and never call the hooks
// (`lib/locale.ts` installs them; tests/locale invariance).

import { fmtCfg, fmtNum, type FormatHooks } from "./format";
import { definePrefSlot, onPrefSlotChange } from "./prefSlots";

export type DecimalSep = "point" | "comma";
export type Grouping = "default" | "none" | "comma" | "point" | "space";
export type DateFormat = "default" | "iso";
export type ClockFormat = "default" | "24h" | "12h";

export interface NumberPrefs {
  /** Auto notation goes exponential below 10^sciLow ... */
  sciLow: number;
  /** ... and from 10^sciHigh up (the original fixed 1e-3 / 1e5). */
  sciHigh: number;
  decimal: DecimalSep;
  grouping: Grouping;
  dateFormat: DateFormat;
  clock: ClockFormat;
  /** Default significance level for tools that take alpha (confidence = 1 - alpha). */
  alpha: number;
  /** Worksheet cells follow Significant figures / Notation (off: the grid's own 4 dp / 3 digit rule). */
  worksheetCells: boolean;
}

export const NUMBER_PREF_DEFAULTS: NumberPrefs = {
  sciLow: -3,
  sciHigh: 5,
  decimal: "point",
  grouping: "default",
  dateFormat: "default",
  clock: "default",
  alpha: 0.05,
  worksheetCells: false,
};
export const ALPHA_MIN = 0.0001;
export const ALPHA_MAX = 0.25;

const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
const int = (v: unknown, lo: number, hi: number, d: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : d;

export const numberPrefsSlot = definePrefSlot("qz.numberPrefs", NUMBER_PREF_DEFAULTS, (r): NumberPrefs => {
  const d = NUMBER_PREF_DEFAULTS;
  return {
    sciLow: int(r.sciLow, -12, -1, d.sciLow),
    sciHigh: int(r.sciHigh, 2, 15, d.sciHigh),
    decimal: pick(r.decimal, ["point", "comma"], d.decimal),
    grouping: pick(r.grouping, ["default", "none", "comma", "point", "space"], d.grouping),
    dateFormat: pick(r.dateFormat, ["default", "iso"], d.dateFormat),
    clock: pick(r.clock, ["default", "24h", "12h"], d.clock),
    alpha: typeof r.alpha === "number" && r.alpha >= ALPHA_MIN && r.alpha <= ALPHA_MAX ? r.alpha : d.alpha,
    worksheetCells: r.worksheetCells === true,
  };
});

/** The default alpha for a tool's input (0.05 unless the user set another). */
export const defaultAlpha = (): number => numberPrefsSlot.load().alpha;
/** The pref's alpha when `options` offers it (a select cannot show a value it lacks), else `fallback`. */
export const alphaIn = (options: readonly number[], fallback = 0.05): number => (options.includes(defaultAlpha()) ? defaultAlpha() : fallback);
/** The pref's confidence level when `options` offers it, else `fallback`. */
export const confidenceIn = (options: readonly number[], fallback = 0.95): number => (options.includes(defaultConfidence()) ? defaultConfidence() : fallback);
/** The matching confidence level, 1 - alpha (0.95 by default), rounded off float noise. */
export const defaultConfidence = (): number => Number((1 - defaultAlpha()).toPrecision(6));

// ---- display formatters (print-only surfaces) ----------------------------

// Counts and stat keys (PREFS_AUDIT P0-2) live here, not in lib/format.ts: only lazy
// surfaces use them, and an unused export still costs eager bytes there.

/** Integer-valued quantities (N, point counts, row counts, iterations, bins):
 *  always the plain integer, never routed through the sig-figs / notation
 *  prefs (Scientific + 3 sf must not turn 201 into "2.01e+2"). No thousands
 *  grouping, matching the rest of the app. A non-integer value is NOT a count,
 *  so it falls back to fmtNum rather than being silently rounded. Non-numbers
 *  / non-finite → an em-dash, as fmtNum. */
export function fmtCount(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (!Number.isInteger(v)) return fmtNum(v);
  return v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 });
}

/** Stat keys (descriptive-stats routes, worksheet footer) that hold counts. */
export const COUNT_STAT_KEYS: ReadonlySet<string> = new Set(["N", "n", "count", "missing"]);

/** fmtCount for a count-valued stat key, fmtNum otherwise. */
export function fmtStat(key: string, v: unknown): string {
  return COUNT_STAT_KEYS.has(key) ? fmtCount(v) : fmtNum(v);
}

const post = (s: string): string => fmtCfg.h.num?.(s) ?? s;

/** fmtNum for a DISPLAY surface (Inspector readouts, stats, chips): the same
 *  text, then the display locale (decimal separator, grouping). Never for
 *  text that is saved, exported or copied: those keep fmtNum / a plain ".". */
export const fmtDisp = (v: unknown): string => post(fmtNum(v));

/** fmtStat for a display surface (see fmtDisp); counts take only the grouping. */
export const fmtDispStat = (key: string, v: unknown): string => post(fmtStat(key, v));

/** An integer for display; `loc` pins a locale (default: the browser's). */
export const fmtInt = (n: number, loc?: string): string => (fmtCfg.h.int ? fmtCfg.h.int(n, loc) : n.toLocaleString(loc));

/** A date/time for display: `d` date only, `t` time only, `hm` hh:mm (24 h), else both. */
export const fmtWhen = (d: Date, k?: "d" | "t" | "hm"): string =>
  fmtCfg.h.when ? fmtCfg.h.when(d, k) : k === "hm" ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    : k ? d[k === "d" ? "toLocaleDateString" : "toLocaleTimeString"]() : d.toLocaleString();

// ---- applying the prefs --------------------------------------------------

/** Install the hooks + the auto-notation thresholds (10^lo, 10^hi) and re-render subscribers. */
export function setFormatHooks(h: FormatHooks, lo = -3, hi = 5): void {
  fmtCfg.h = h;
  fmtCfg.l = Number(`1e${lo}`);
  fmtCfg.u = Number(`1e${hi}`);
  bumpFormat();
}

/** Tell the display surfaces (grid, plots, cards) to re-render; the Numbers pane
 *  calls it when Significant figures or Notation change (they live in the store). */
export function bumpFormat(): void {
  const old = fmtCfg.s;
  fmtCfg.s = new Set(old);
  old.forEach((f) => f());
}

const NBSP = " ";
const GROUP_CHAR = { comma: ",", point: ".", space: NBSP } as const;

/** Re-punctuate a finished "-1234.5e-7"-style string: grouping on the integer
 *  part, the decimal separator on the fraction. Anything that does not start
 *  with a number (an em-dash, text) is returned untouched. */
export function punctuate(s: string, decimal: string, group: string): string {
  const m = /^([-−]?)(\d+)(?:\.(\d+))?([\s\S]*)$/.exec(s);
  if (!m) return s;
  const [, sign, ip, fp, rest] = m;
  const int = group ? ip!.replace(/\B(?=(\d{3})+$)/g, group) : ip;
  return `${sign}${int}${fp === undefined ? "" : decimal + fp}${rest}`;
}

/** The grouping character a pref selects ("" = none), never equal to the decimal one. */
function groupChar(p: NumberPrefs): string {
  if (p.grouping === "default" || p.grouping === "none") return "";
  const g = GROUP_CHAR[p.grouping];
  return g === (p.decimal === "comma" ? "," : ".") ? NBSP : g;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** The date/time hook for the date + clock prefs (undefined when both default). */
function whenHook(p: NumberPrefs): FormatHooks["when"] {
  if (p.dateFormat === "default" && p.clock === "default") return undefined;
  const h12 = p.clock === "default" ? {} : { hour12: p.clock === "12h" };
  return (d, k) => {
    if (Number.isNaN(d.valueOf())) return "Invalid Date";
    const iso = p.dateFormat === "iso";
    if (k === "d") return iso ? isoDate(d) : d.toLocaleDateString();
    if (k === "hm") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: p.clock === "12h" });
    if (k === "t") return iso && !h12.hour12 ? isoTime(d) : d.toLocaleTimeString(undefined, h12);
    return iso && !h12.hour12 ? `${isoDate(d)} ${isoTime(d)}` : d.toLocaleString(undefined, h12);
  };
}

/** The hooks for `p`; with the defaults they change no output. */
export function hooksFor(p: NumberPrefs): FormatHooks {
  const g = groupChar(p);
  const dec = p.decimal === "comma" ? "," : ".";
  const h: FormatHooks = {};
  if (dec !== "." || g) h.num = (s) => punctuate(s, dec, g);
  if (dec !== "." || g || p.worksheetCells) {
    // Numeric worksheet cells: the Inspector's fmtNum when asked, then re-punctuated.
    h.cell = (own) => {
      const base = p.worksheetCells ? fmtNum : own();
      return h.num ? (v) => h.num!(base(v)) : base;
    };
  }
  // Always installed (reads the notation pref at draw time): Scientific
  // notation reaches the ticks as the shortest mantissa that shows the value.
  h.tick = (s, v) => {
    const o = { sigFigs: fmtCfg.sf, notation: fmtCfg.n };
    const sci = v !== undefined && Number.isFinite(v) && v !== 0 && o.notation === "scientific"
      ? Number(v.toPrecision(o.sigFigs)).toExponential().replace(/^-/, "\u2212") : s;
    return dec === "." && !g ? sci : punctuate(sci, dec, g);
  };
  if (p.grouping !== "default") {
    h.int = (n, loc) => (g ? punctuate(String(n), dec, g) : n.toLocaleString(loc, { useGrouping: false }));
  }
  const w = whenHook(p);
  if (w) h.when = w;
  return h;
}

let started = false;
function apply(): void {
  const p = numberPrefsSlot.load();
  setFormatHooks(hooksFor(p), p.sciLow, p.sciHigh);
}

/** Apply now, and again on every write to the slot (Preferences, server hydration, Reset). */
export function startNumberPrefs(): void {
  apply();
  if (started) return;
  started = true;
  onPrefSlotChange((k) => k === numberPrefsSlot.key && apply());
}
