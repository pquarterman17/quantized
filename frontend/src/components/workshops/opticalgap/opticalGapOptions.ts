// Optical gap (Tauc): the choices its panel offers, in one place so the selects
// that render them, the hook that validates a reopened result and the preset
// adapter that accepts them cannot drift.

import type { TaucSignal, TaucXUnit, TransitionKind } from "../../../lib/api/analysisExtras";

export const TAUC_X_UNIT_OPTIONS: readonly { value: TaucXUnit; label: string }[] = [
  { value: "eV", label: "Photon energy (eV)" },
  { value: "meV", label: "Photon energy (meV)" },
  { value: "cm-1", label: "Wavenumber (cm⁻¹)" },
  { value: "nm", label: "Wavelength (nm)" },
  { value: "A", label: "Wavelength (Å)" },
  { value: "um", label: "Wavelength (µm)" },
];

export const TAUC_SIGNAL_OPTIONS: readonly { value: TaucSignal; label: string }[] = [
  { value: "alpha", label: "Absorption coefficient α (1/cm)" },
  { value: "absorbance", label: "Absorbance A (∝ α)" },
  { value: "transmittance", label: "Transmittance T" },
];

export const TAUC_SCALE_OPTIONS: readonly { value: "fraction" | "percent"; label: string }[] = [
  { value: "fraction", label: "fraction (0 to 1)" },
  { value: "percent", label: "percent (0 to 100)" },
];

export const TAUC_TRANSITION_OPTIONS: readonly { value: TransitionKind; label: string }[] = [
  { value: "direct", label: "Direct allowed, (αhν)²" },
  { value: "direct-forbidden", label: "Direct forbidden, (αhν)^(2/3)" },
  { value: "indirect", label: "Indirect allowed, (αhν)^(1/2)" },
  { value: "indirect-forbidden", label: "Indirect forbidden, (αhν)^(1/3)" },
];
