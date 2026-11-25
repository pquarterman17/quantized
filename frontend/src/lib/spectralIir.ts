// IIR design block of a spectral "filter" recipe (scipy second-order sections,
// backend calc/iir_filter.py). Absent = the long-standing FFT-domain filter, so
// existing recipes replay unchanged.

export type IirFamily = "butter" | "cheby1" | "cheby2" | "ellip" | "bessel";
export type IirBand = "lowpass" | "highpass" | "bandpass" | "bandstop";
export type BesselNorm = "phase" | "delay" | "mag";

export interface IirSpec {
  family: IirFamily;
  btype: IirBand;
  /** Low-pass prototype order, 1..20 (band types double it). */
  order: number;
  /** One cutoff (low/high-pass) or [low, high] (band types), in axis frequency units. */
  cutoff: number[];
  /** Pass-band ripple, dB (Chebyshev I, elliptic only). */
  rp?: number;
  /** Stop-band attenuation, dB (Chebyshev II, elliptic only). */
  rs?: number;
  /** Bessel only; default "phase" (scipy's). */
  besselNorm?: BesselNorm;
  /** sosfiltfilt (zero phase, squared magnitude) instead of causal sosfilt. */
  zeroPhase: boolean;
}

const FAMILIES: readonly string[] = ["butter", "cheby1", "cheby2", "ellip", "bessel"];
const BANDS: readonly string[] = ["lowpass", "highpass", "bandpass", "bandstop"];
const NORMS: readonly string[] = ["phase", "delay", "mag"];
const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Why `spec` cannot be designed ("" = it can). Mirrors validate_iir_spec; the
 *  Nyquist limit needs the data's sampling rate and is enforced by the backend. */
export function iirSpecProblem(spec: IirSpec): string {
  const bandCount = spec.btype === "bandpass" || spec.btype === "bandstop" ? 2 : 1;
  if (!Number.isInteger(spec.order) || spec.order < 1 || spec.order > 20) return "IIR order must be an integer from 1 to 20.";
  if (spec.cutoff.length !== bandCount || !spec.cutoff.every(pos)) return "Enter positive cutoff frequencies.";
  if (bandCount === 2 && spec.cutoff[0] >= spec.cutoff[1]) return "Lower cutoff must be less than the upper cutoff.";
  const usesRp = spec.family === "cheby1" || spec.family === "ellip";
  const usesRs = spec.family === "cheby2" || spec.family === "ellip";
  if (usesRp !== (spec.rp !== undefined) || (usesRp && !pos(spec.rp))) return "Pass-band ripple must be positive (Chebyshev I and elliptic only).";
  if (usesRs !== (spec.rs !== undefined) || (usesRs && !pos(spec.rs))) return "Stop-band attenuation must be positive (Chebyshev II and elliptic only).";
  if (spec.family === "ellip" && spec.rp !== undefined && spec.rs !== undefined && spec.rs <= spec.rp) return "Stop-band attenuation must exceed the ripple.";
  return "";
}

/** Defensive decode of a saved recipe's `iir` block; anything malformed is rejected. */
export function sanitizeIirSpec(value: unknown): IirSpec | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  const allowed = new Set(["family", "btype", "order", "cutoff", "rp", "rs", "besselNorm", "zeroPhase"]);
  if (!Object.keys(r).every((key) => allowed.has(key))) return undefined;
  if (!FAMILIES.includes(String(r.family)) || !BANDS.includes(String(r.btype)) || typeof r.zeroPhase !== "boolean") return undefined;
  if (!Array.isArray(r.cutoff) || typeof r.order !== "number") return undefined;
  if (r.besselNorm !== undefined && (r.family !== "bessel" || !NORMS.includes(String(r.besselNorm)))) return undefined;
  const spec: IirSpec = {
    family: r.family as IirFamily,
    btype: r.btype as IirBand,
    order: r.order,
    cutoff: [...r.cutoff] as number[],
    zeroPhase: r.zeroPhase,
    ...(r.rp !== undefined ? { rp: r.rp as number } : {}),
    ...(r.rs !== undefined ? { rs: r.rs as number } : {}),
    ...(r.besselNorm !== undefined ? { besselNorm: r.besselNorm as BesselNorm } : {}),
  };
  return iirSpecProblem(spec) ? undefined : spec;
}

/** Snake-case body for the `/api/spectral/workbench` `iir` field. */
export function iirRequest(spec: IirSpec) {
  return {
    family: spec.family,
    btype: spec.btype,
    order: spec.order,
    cutoff: spec.cutoff,
    ...(spec.rp !== undefined ? { rp: spec.rp } : {}),
    ...(spec.rs !== undefined ? { rs: spec.rs } : {}),
    ...(spec.besselNorm !== undefined ? { bessel_norm: spec.besselNorm } : {}),
    zero_phase: spec.zeroPhase,
  };
}
