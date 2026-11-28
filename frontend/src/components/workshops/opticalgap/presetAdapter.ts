// Optical gap (Tauc)'s preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. A preset is the energy and absorption columns BY LABEL (P5),
// what the X axis and the Y signal are, the transition type, and the fit window
// (a value-space range in eV: allowed; empty means detect the straight edge).
// Settings only: no dataset, no row range, no excluded rows. A column label this
// sheet lacks (or has twice) is skipped and named, and the current pick stays.
// The film thickness and the transmittance scale are hidden by the signals that
// do not use them (lib/presetShownFields.ts): neither checked nor stored then, so
// a refused value in a knob the user cannot see never blocks Save, and an Apply
// never writes one. The X unit and signal a preset carries are held against the
// panel's column guess, which would otherwise overwrite them on the next pick.
// Lazy: loaded with the preset bar and after a successful fit.

import {
  checkBoolean, checkNumberText, checkOneOf, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { shownFieldKit } from "../../../lib/presetShownFields";
import { TAUC_SIGNAL_OPTIONS, TAUC_TRANSITION_OPTIONS, TAUC_X_UNIT_OPTIONS } from "./opticalGapOptions";
import type { OpticalGapState } from "./useOpticalGap";

export interface OpticalGapPreset {
  /** The spectrum X column, by label. */
  xColumn: string;
  /** The spectrum Y column, by label. */
  yColumn: string;
  xUnit: OpticalGapState["xUnit"];
  signal: OpticalGapState["signal"];
  /** Transmittance only: T is in percent. */
  percent: boolean;
  /** Film thickness in nm; blank when not given. Absorbance and transmittance only. */
  thickness: string;
  kind: OpticalGapState["kind"];
  /** The fit window in eV; blank means detect it. */
  eMin: string;
  eMax: string;
}

/** The slice of the panel the adapter reads and writes. */
export type OpticalGapHandle = Pick<
  OpticalGapState,
  "columns" | "xCol" | "yCol" | "setXCol" | "setYCol" | "holdGuessFor" | "xUnit" | "setXUnit" | "signal" | "setSignal" | "percent" | "setPercent" |
  "thickness" | "setThickness" | "kind" | "setKind" | "eMin" | "eMax" | "setEMin" | "setEMax"
>;

export const OPTICAL_GAP_WORKSHOP = "optical-gap";
export const OPTICAL_GAP_SCHEMA = 1;

const values = (options: readonly { value: string }[]): string[] => options.map((o) => o.value);
const label: FieldCheck = (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? null : "must be a column label");

const STRICT: { [K in keyof OpticalGapPreset]: FieldCheck } = {
  xColumn: label,
  yColumn: label,
  xUnit: checkOneOf(values(TAUC_X_UNIT_OPTIONS)),
  signal: checkOneOf(values(TAUC_SIGNAL_OPTIONS)),
  percent: checkBoolean,
  thickness: checkNumberText((n) => (n > 0 ? null : "must be positive")),
  kind: checkOneOf(values(TAUC_TRANSITION_OPTIONS)),
  eMin: checkNumberText(),
  eMax: checkNumberText(),
};

const DEFAULTS: OpticalGapPreset = { xColumn: "x", yColumn: "y", xUnit: "eV", signal: "alpha", percent: false, thickness: "", kind: "direct", eMin: "", eMax: "" };

/** The settings the chosen signal shows: thickness for absorbance and transmittance, the T scale for transmittance. */
function shown(s: Record<string, unknown>): string[] {
  return [
    "xColumn", "yColumn", "xUnit", "signal", "kind", "eMin", "eMax",
    ...(s["signal"] === "absorbance" || s["signal"] === "transmittance" ? ["thickness"] : []),
    ...(s["signal"] === "transmittance" ? ["percent"] : []),
  ];
}

const kit = shownFieldKit<OpticalGapPreset>(STRICT, DEFAULTS, shown);

function parseSettings(raw: unknown): OpticalGapPreset | { error: string } {
  const r = kit.parse(raw);
  if ("error" in r && Object.keys(r).length === 1) return r;
  const s = r as OpticalGapPreset;
  if (s.eMin.trim() && s.eMax.trim() && Number(s.eMin) >= Number(s.eMax)) return { error: "setting 'eMin' must be below 'eMax'" };
  return s;
}

export function presetFromPanel(
  p: Pick<OpticalGapHandle, "columns" | "xCol" | "yCol" | "xUnit" | "signal" | "percent" | "thickness" | "kind" | "eMin" | "eMax">,
): OpticalGapPreset {
  const name = (i: number): string => p.columns.find((c) => c.index === i)?.label ?? "";
  return { xColumn: name(p.xCol), yColumn: name(p.yCol), xUnit: p.xUnit, signal: p.signal, percent: p.percent, thickness: p.thickness, kind: p.kind, eMin: p.eMin, eMax: p.eMax };
}

export function createOpticalGapAdapter(panel: OpticalGapHandle): PresetAdapter<OpticalGapPreset> {
  const adapter: PresetAdapter<OpticalGapPreset> = {
    workshop: OPTICAL_GAP_WORKSHOP,
    label: "Optical gap",
    runLabel: "Fit gap",
    schema: OPTICAL_GAP_SCHEMA,
    columnFields: ["xColumn", "yColumn"],
    fieldNames: { xColumn: "spectrum X column", yColumn: "spectrum Y column" },
    defaults: () => ({ ...DEFAULTS, xColumn: panel.columns[0]?.label ?? "x", yColumn: panel.columns[1]?.label ?? "y" }),
    parse: parseSettings,
    capture: () => kit.storable(presetFromPanel(panel), DEFAULTS),
    apply(raw): ApplyOutcome {
      const s = kit.storable(raw, presetFromPanel(panel)); // a refused hidden value is not written into the panel
      const plan = planColumnFields(adapter, s, panel.columns.map((c) => c.label));
      if ("refuse" in plan) return { ok: false, reason: plan.refuse };
      const skipped = [...plan.skipped];
      const pick = (field: "xColumn" | "yColumn", current: number): number => {
        if (skipped.some((x) => x.field === field)) return current;
        const same = panel.columns.filter((c) => c.label === s[field]);
        if (same.length === 1) return same[0]!.index;
        if (same.length > 1) skipped.push({ field, reason: `column '${s[field]}' appears more than once on this sheet, so none was picked` });
        return current;
      };
      const x = pick("xColumn", panel.xCol);
      const y = pick("yColumn", panel.yCol);
      if (x !== panel.xCol || y !== panel.yCol) {
        panel.holdGuessFor(x, y); // the unit and signal below are the preset's, not a fresh guess from the columns
        if (x !== panel.xCol) panel.setXCol(x);
        if (y !== panel.yCol) panel.setYCol(y);
      }
      panel.setXUnit(s.xUnit);
      panel.setSignal(s.signal);
      panel.setPercent(s.percent);
      panel.setThickness(s.thickness);
      panel.setKind(s.kind);
      panel.setEMin(s.eMin);
      panel.setEMax(s.eMax);
      const skippedFields = new Set(skipped.map((f) => f.field));
      return { ok: true, applied: Object.keys(raw).filter((k) => !skippedFields.has(k)), skipped, notes: [] };
    },
    describe: (s) =>
      `${s.yColumn} against ${s.xColumn} (${s.xUnit}), ${s.signal}, ${s.kind} transition, window ${s.eMin.trim() || "auto"} to ${s.eMax.trim() || "auto"} eV`,
  };
  return adapter;
}

/** After a successful fit: remember the settings as last used (only if they would read back). */
export function recordOpticalGapRun(settings: OpticalGapPreset): void {
  const stored = kit.storable(settings, DEFAULTS);
  if ("error" in parseSettings(stored)) return;
  recordLastUsed({ workshop: OPTICAL_GAP_WORKSHOP, schema: OPTICAL_GAP_SCHEMA }, stored);
}
