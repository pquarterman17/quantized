// Pawley refinement's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. The Reductions window holds five methods; this adapter is the
// Pawley one. A preset is the intensity channel BY LABEL (P5), the starting cell
// (axes, angles and the tie between axes), the centering, the wavelength, the
// profile FWHM and whether the cell is refined. The scan itself and its 2-theta
// range are data and are never stored. A channel label this sheet lacks (or has
// twice) is skipped and named, and the current channel stays. The b and c axes
// are hidden while the tie fixes them to a (lib/presetShownFields.ts): neither
// checked nor stored there, and an Apply never writes a refused one.
// Lazy: loaded with the preset bar and after a successful Refine.

import {
  checkBoolean, checkOneOf, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { shownFieldKit } from "../../../lib/presetShownFields";
import { cellVolumeFactor, PAWLEY_DEFAULT_FIELDS, parseField, type PawleyFields, type PawleyTie } from "./pawleyInputs";
import { PAWLEY_CENTERING_OPTIONS, PAWLEY_TIE_OPTIONS } from "./pawleyOptions";
import type { PawleyState } from "./usePawley";

export interface PawleyPreset extends PawleyFields {
  /** The intensity channel, by its label. */
  column: string;
  tie: PawleyTie;
  symmetry: PawleyState["symmetry"];
  refineCell: boolean;
}

/** The slice of the section the adapter reads and writes. */
export type PawleyHandle = Pick<PawleyState, "columns" | "col" | "setCol" | "fields" | "tie" | "symmetry" | "setSymmetry" | "refineCell" | "setRefineCell" | "applyFields">;

export const PAWLEY_WORKSHOP = "pawley";
export const PAWLEY_SCHEMA = 1;

const values = (options: readonly { value: string }[]): string[] => options.map((o) => o.value);
const label: FieldCheck = (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? null : "must be a column label");

/** Text holding a number the refinement accepts: not blank, above zero and at most `max` (or below 180 for an angle). */
const bounded = (max: number, what: string): FieldCheck => (v) => {
  if (typeof v !== "string") return "must be text";
  if (v.length > 40) return "is too long";
  const n = parseField(v);
  if (!Number.isFinite(n)) return "must be a number";
  return n > 0 && n <= max && (max !== 180 || n < 180) ? null : `must be ${what}`;
};
const length = bounded(1000, "a positive length up to 1000 Å");
const angle = bounded(180, "an angle between 0° and 180°");

const STRICT: { [K in keyof PawleyPreset]: FieldCheck } = {
  column: label,
  a: length, b: length, c: length,
  alpha: angle, beta: angle, gamma: angle,
  wavelength: bounded(10, "a positive wavelength up to 10 Å"),
  fwhm: bounded(20, "a positive width up to 20°"),
  tie: checkOneOf(values(PAWLEY_TIE_OPTIONS)),
  symmetry: checkOneOf(values(PAWLEY_CENTERING_OPTIONS)),
  refineCell: checkBoolean,
};

const DEFAULTS: PawleyPreset = { column: "Intensity", ...PAWLEY_DEFAULT_FIELDS, tie: "abc", symmetry: "P", refineCell: true };

/** All but the axes the tie fixes to a: b unless the axes are independent, c only for a cubic cell. */
const shown = (s: Record<string, unknown>): string[] =>
  Object.keys(STRICT).filter((k) => !(k === "b" && s["tie"] !== "none") && !(k === "c" && s["tie"] === "abc"));

const kit = shownFieldKit<PawleyPreset>(STRICT, DEFAULTS, shown);

function parseSettings(raw: unknown): PawleyPreset | { error: string } {
  const r = kit.parse(raw);
  if ("error" in r && Object.keys(r).length === 1) return r;
  const s = r as PawleyPreset;
  if (cellVolumeFactor(parseField(s.alpha), parseField(s.beta), parseField(s.gamma)) <= 0) {
    return { error: "setting 'alpha' (with beta and gamma) does not describe a real (positive-volume) cell" };
  }
  return s;
}

export function presetFromPanel(p: Pick<PawleyHandle, "columns" | "col" | "fields" | "tie" | "symmetry" | "refineCell">): PawleyPreset {
  return { column: p.columns.find((c) => c.index === p.col)?.label ?? "", ...p.fields, tie: p.tie, symmetry: p.symmetry, refineCell: p.refineCell };
}

export function createPawleyAdapter(panel: PawleyHandle): PresetAdapter<PawleyPreset> {
  const adapter: PresetAdapter<PawleyPreset> = {
    workshop: PAWLEY_WORKSHOP,
    label: "Pawley refinement",
    runLabel: "Refine",
    schema: PAWLEY_SCHEMA,
    columnFields: ["column"],
    fieldNames: { column: "intensity channel" },
    defaults: () => ({ ...DEFAULTS, column: panel.columns[0]?.label ?? "Intensity" }),
    parse: parseSettings,
    capture: () => kit.storable(presetFromPanel(panel), DEFAULTS),
    apply(raw): ApplyOutcome {
      const s = kit.storable(raw, presetFromPanel(panel)); // a refused hidden value is not written into the panel
      const plan = planColumnFields(adapter, s, panel.columns.map((c) => c.label));
      if ("refuse" in plan) return { ok: false, reason: plan.refuse };
      const skipped = [...plan.skipped];
      const same = panel.columns.filter((c) => c.label === s.column);
      if (skipped.length === 0 && same.length === 1) panel.setCol(same[0]!.index);
      else if (skipped.length === 0 && same.length > 1) skipped.push({ field: "column", reason: `column '${s.column}' appears more than once on this sheet, so none was picked` });
      panel.applyFields({ a: s.a, b: s.b, c: s.c, alpha: s.alpha, beta: s.beta, gamma: s.gamma, wavelength: s.wavelength, fwhm: s.fwhm }, s.tie);
      panel.setSymmetry(s.symmetry);
      panel.setRefineCell(s.refineCell);
      const skippedFields = new Set(skipped.map((x) => x.field));
      return { ok: true, applied: Object.keys(raw).filter((k) => !skippedFields.has(k)), skipped, notes: [] };
    },
    describe: (s) => `${s.column}, a = ${s.a} Å (${s.tie}), ${s.symmetry} centering, ${s.wavelength} Å, ${s.refineCell ? "refine the cell" : "cell fixed"}`,
  };
  return adapter;
}

/** After a successful Refine: remember the settings as last used (only if they would read back). */
export function recordPawleyRun(settings: PawleyPreset): void {
  const stored = kit.storable(settings, DEFAULTS);
  if ("error" in parseSettings(stored)) return;
  recordLastUsed({ workshop: PAWLEY_WORKSHOP, schema: PAWLEY_SCHEMA }, stored);
}
