// Williamson-Hall's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. The Reductions window holds five methods; this adapter is the
// Williamson-Hall one. A preset is the instrument and model settings: the X-ray
// wavelength, the Scherrer K factor and the instrumental broadening. The peak
// table (2theta and FWHM per peak) is DATA, the fitted peaks of one pattern, so
// it is never stored (P5): Apply says to enter or load the peaks. No columns, no
// mode-dependent knobs, so nothing is hidden.
// Lazy: loaded with the preset bar and after a successful Fit.

import {
  parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import type { WilliamsonHallState } from "./useWilliamsonHall";

export interface WilliamsonHallPreset {
  /** X-ray wavelength in angstrom. */
  wavelength: number;
  kFactor: number;
  /** Instrumental broadening in degrees (0 for none). */
  instrumentalBroadening: number;
}

/** The slice of the section the adapter reads and writes. */
export type WilliamsonHallHandle = Pick<
  WilliamsonHallState,
  "wavelength" | "kFactor" | "instrumentalBroadening" | "setWavelength" | "setKFactor" | "setInstrumentalBroadening"
>;

export const WILLIAMSON_HALL_WORKSHOP = "williamson-hall";
export const WILLIAMSON_HALL_SCHEMA = 1;

const positive: FieldCheck = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? null : "must be a positive number");
const nonNegative: FieldCheck = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? null : "must be zero or a positive number");

const parseSettings = (raw: unknown): WilliamsonHallPreset | { error: string } =>
  parseFields<WilliamsonHallPreset>(raw, { wavelength: positive, kFactor: positive, instrumentalBroadening: nonNegative });

export function presetFromPanel(p: Pick<WilliamsonHallHandle, "wavelength" | "kFactor" | "instrumentalBroadening">): WilliamsonHallPreset {
  return { wavelength: p.wavelength, kFactor: p.kFactor, instrumentalBroadening: p.instrumentalBroadening };
}

export function createWilliamsonHallAdapter(panel: WilliamsonHallHandle): PresetAdapter<WilliamsonHallPreset> {
  return {
    workshop: WILLIAMSON_HALL_WORKSHOP,
    label: "Williamson-Hall",
    runLabel: "Fit",
    schema: WILLIAMSON_HALL_SCHEMA,
    defaults: () => ({ wavelength: 1.5406, kFactor: 0.9, instrumentalBroadening: 0 }),
    parse: parseSettings,
    capture: () => presetFromPanel(panel),
    apply(s): ApplyOutcome {
      // A setter also retires the shown result and the fitted-peak caption, so only a value that changes is written.
      if (panel.wavelength !== s.wavelength) panel.setWavelength(s.wavelength);
      if (panel.kFactor !== s.kFactor) panel.setKFactor(s.kFactor);
      if (panel.instrumentalBroadening !== s.instrumentalBroadening) panel.setInstrumentalBroadening(s.instrumentalBroadening);
      return { ok: true, applied: Object.keys(s), skipped: [], notes: ["enter or load the peaks: a preset does not store them"] };
    },
    describe: (s) => `${s.wavelength} Å, K = ${s.kFactor}, instrument broadening ${s.instrumentalBroadening}°`,
  };
}

/** After a successful Fit: remember the settings as last used (only if they would read back). */
export function recordWilliamsonHallRun(settings: WilliamsonHallPreset): void {
  if ("error" in parseSettings(settings)) return;
  recordLastUsed({ workshop: WILLIAMSON_HALL_WORKSHOP, schema: WILLIAMSON_HALL_SCHEMA }, settings);
}
