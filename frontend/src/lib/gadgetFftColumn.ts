// The plot FFT gadget's spectrum column: its label and unit for each output.
// Pure. Mirrors the backend's PSD units (calc/spectral_workbench._psd_unit):
// density is power per frequency unit, y² times the X unit; power ("spectrum")
// is y² per bin. The magnitude spectrum keeps the label and (blank) unit it
// always had.

import type { FftSpectralResult } from "./api";

export type GadgetFftOutput = "magnitude" | "psd" | "power";

/** The request fields for an output (magnitude is the route default and sends nothing extra). */
export function fftRequestFor(output: GadgetFftOutput): { output_type?: "psd"; scaling?: "spectrum" } {
  if (output === "psd") return { output_type: "psd" };
  if (output === "power") return { output_type: "psd", scaling: "spectrum" };
  return {};
}

/** Label and unit of the column a result commits as. */
export function fftColumnOf(r: Pick<FftSpectralResult, "magnitude" | "psd" | "scaling">, yUnit: string, xUnit: string): { label: string; unit: string; values: (number | null)[] | undefined } {
  if (r.magnitude) return { label: "magnitude", unit: "", values: r.magnitude };
  if (r.psd) {
    const y = yUnit.trim();
    const x = xUnit.trim();
    if (r.scaling === "spectrum") return { label: "power", unit: y ? `${y}²` : "", values: r.psd };
    return { label: "psd", unit: y ? (x ? `${y}²·${x}` : `${y}²`) : "", values: r.psd };
  }
  return { label: "phase", unit: "", values: undefined };
}

/** The output a result was computed as, for provenance (absent = the default magnitude). */
export const fftOutputOf = (r: Pick<FftSpectralResult, "magnitude" | "psd" | "scaling">): GadgetFftOutput =>
  r.psd ? (r.scaling === "spectrum" ? "power" : "psd") : "magnitude";
