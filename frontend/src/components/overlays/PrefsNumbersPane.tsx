// Preferences ▸ Numbers (split out of PreferencesDialog.tsx, PREFS_AUDIT lane
// 1; lane 3 added the locale, threshold, date and statistics rows). Lazy with
// the dialog. All defaults equal the behaviour before these prefs existed:
// provisional, owner to confirm. Display only: nothing here reaches CSV, TSV,
// the clipboard's data formats, Origin export, .dwk or an API payload.

import { useEffect } from "react";

import { type NumberPrefs, bumpFormat, fmtDisp, fmtInt, fmtWhen, numberPrefsSlot, startNumberPrefs } from "../../lib/locale";
import { useFormatEpoch } from "../../lib/useFormatEpoch";
import { useApp } from "../../store/useApp";
import { Select } from "../primitives";
import { SliderRow } from "../primitives/SliderRow";
import { Switch } from "../primitives/Switch";
import PrefRow from "./PrefRow";

const NOTATION_OPTS = [
  { value: "auto", label: "Auto" },
  { value: "scientific", label: "Scientific" },
  { value: "fixed", label: "Fixed" },
];
const opts = (xs: readonly (readonly [string | number, string])[]) => xs.map(([value, label]) => ({ value: String(value), label }));
const LOW = opts([[-1, "0.1"], [-2, "0.01"], [-3, "0.001 (default)"], [-4, "0.0001"], [-5, "0.00001"], [-6, "0.000001"]]);
const HIGH = opts([[3, "1,000"], [4, "10,000"], [5, "100,000 (default)"], [6, "1,000,000"], [8, "100,000,000"], [10, "10,000,000,000"]]);
const DECIMAL = opts([["point", "Point (1.5)"], ["comma", "Comma (1,5)"]]);
const GROUPING = opts([["default", "Default"], ["none", "None"], ["comma", "Comma (1,234)"], ["point", "Point (1.234)"], ["space", "Space (1 234)"]]);
const DATE = opts([["default", "Browser locale"], ["iso", "ISO 8601 (2026-11-25)"]]);
const CLOCK = opts([["default", "Default"], ["24h", "24-hour"], ["12h", "12-hour"]]);
const ALPHA = opts([[0.1, "0.10 (90% confidence)"], [0.05, "0.05 (95% confidence)"], [0.01, "0.01 (99% confidence)"]]);

export default function PrefsNumbersPane() {
  useEffect(startNumberPrefs, []);
  useFormatEpoch(); // the preview line follows every change
  const sigFigs = useApp((s) => s.sigFigs);
  const notation = useApp((s) => s.notation);
  const setPref = useApp((s) => s.setPref);
  useEffect(bumpFormat, [sigFigs, notation]); // the grid, ticks and cards follow these two as well
  const p = numberPrefsSlot.use();
  const set = <K extends keyof NumberPrefs>(k: K, v: NumberPrefs[K]) => numberPrefsSlot.save({ ...p, [k]: v });
  const pick = (k: "sciLow" | "sciHigh") => (e: { target: { value: string } }) => set(k, Number(e.target.value));
  return (
    <>
      {/* P2-12: the slider spans the range the store and formatter accept (1 to 12). */}
      <PrefRow label="Significant figures">
        <div style={{ width: 160 }}>
          <SliderRow
            aria-label="Significant figures"
            label="sf"
            value={sigFigs}
            min={1}
            max={12}
            step={1}
            onChange={(v) => setPref("sigFigs", v)}
            format={(v) => String(v)}
          />
        </div>
      </PrefRow>
      <PrefRow label="Notation">
        <Select aria-label="Notation" options={NOTATION_OPTS} value={notation} onChange={(e) => setPref("notation", e.target.value)} />
      </PrefRow>
      <PrefRow label="Scientific below" hint="Auto goes exponential for values under this">
        <Select aria-label="Scientific below" options={LOW} value={String(p.sciLow)} onChange={pick("sciLow")} />
      </PrefRow>
      <PrefRow label="Scientific from" hint="and for values at or above this">
        <Select aria-label="Scientific from" options={HIGH} value={String(p.sciHigh)} onChange={pick("sciHigh")} />
      </PrefRow>
      <PrefRow label="Decimal separator" hint="display only; files, copy and exports always use a point">
        <Select aria-label="Decimal separator" options={DECIMAL} value={p.decimal} onChange={(e) => set("decimal", e.target.value as NumberPrefs["decimal"])} />
      </PrefRow>
      <PrefRow label="Digit grouping" hint="display only; Default keeps each place's own grouping">
        <Select aria-label="Digit grouping" options={GROUPING} value={p.grouping} onChange={(e) => set("grouping", e.target.value as NumberPrefs["grouping"])} />
      </PrefRow>
      <PrefRow label="Worksheet cells follow these" hint="off: the grid's own 4 decimals / 3 digit rule">
        <Switch aria-label="Worksheet cells follow these" checked={p.worksheetCells} onChange={(v) => set("worksheetCells", v)} />
      </PrefRow>
      <PrefRow label="Date format">
        <Select aria-label="Date format" options={DATE} value={p.dateFormat} onChange={(e) => set("dateFormat", e.target.value as NumberPrefs["dateFormat"])} />
      </PrefRow>
      <PrefRow label="Clock" hint="Default: 24-hour in the status bar, locale elsewhere">
        <Select aria-label="Clock" options={CLOCK} value={p.clock} onChange={(e) => set("clock", e.target.value as NumberPrefs["clock"])} />
      </PrefRow>
      <PrefRow label="Default significance level (alpha)" hint="starting value in tools with an alpha or confidence level">
        <Select aria-label="Default significance level" options={ALPHA} value={String(p.alpha)} onChange={(e) => set("alpha", Number(e.target.value))} />
      </PrefRow>
      <div className="qzk-pref-note" aria-label="Number preview">
        Preview: {fmtDisp(-12345.678)} · {fmtDisp(0.00012345)} · {fmtInt(1234567)} · {fmtWhen(new Date(2026, 10, 25, 14, 5, 9))}
      </div>
      <div className="qzk-pref-note">
        Significant figures and Notation apply to Inspector and readout values, and to worksheet cells and plot axis
        ticks (Scientific only) when enabled here. Decimal separator and grouping change what is shown on screen
        (worksheet cells, axis ticks, Inspector readouts, counts) and never what is saved, copied or exported. Units
        keep their scientific casing (kOe, Å⁻¹, µ_B/f.u.).
      </div>
    </>
  );
}
