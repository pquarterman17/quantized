// SIMS depth-profile workshop — the form model (pure). The text fields the
// user types into, and their translation into the recorded `SimsParams`
// (lib/transformSims.ts) or one plain message saying what is missing.

import type { SimsCalMethod, SimsParams, SimsSmoothMethod } from "../../../lib/transformSims";
import type { DataStruct } from "../../../lib/types";

export interface SimsForm {
  calOn: boolean;
  calMethod: SimsCalMethod;
  sputterRate: string;
  rateLen: string;
  rateTime: string;
  craterDepth: string;
  craterUnit: string;
  /** Crater method: total sputter time in x's unit ("" = the last time point). */
  totalTime: string;
  depthUnit: string;
  /** "" = use x's recorded unit; otherwise the user's explicit statement. */
  timeUnit: string;
  bgOn: boolean;
  bgLo: string;
  bgHi: string;
  /** Columns the background leaves unchanged (default: the likely matrix). */
  bgKeep: string[];
  normOn: boolean;
  reference: string;
  /** Column name -> RSF text ("" = plain ratio for that column). */
  rsf: Record<string, string>;
  rsfUnit: string;
  smoothOn: boolean;
  smoothMethod: SimsSmoothMethod;
  window: string;
  polyOrder: string;
}

/** The likely matrix species: the column with the largest median signal —
 *  only a starting suggestion; the user picks the reference. */
export function guessReference(data: DataStruct | undefined): string {
  if (!data?.labels.length) return "";
  let best = 0;
  let bestMed = -Infinity;
  data.labels.forEach((_, c) => {
    const col = data.values.map((r) => r?.[c]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (!col.length) return;
    col.sort((a, b) => a - b);
    const med = col[Math.floor(col.length / 2)];
    if (med > bestMed) {
      bestMed = med;
      best = c;
    }
  });
  return data.labels[best] ?? "";
}

export function defaultForm(data?: DataStruct): SimsForm {
  return {
    calOn: false,
    calMethod: "crater",
    sputterRate: "",
    rateLen: "nm",
    rateTime: "s",
    craterDepth: "",
    craterUnit: "nm",
    totalTime: "",
    depthUnit: "nm",
    timeUnit: "",
    bgOn: false,
    bgLo: "",
    bgHi: "",
    bgKeep: data ? [guessReference(data)].filter(Boolean) : [],
    normOn: false,
    reference: guessReference(data),
    rsf: {},
    rsfUnit: "atoms/cm3",
    smoothOn: false,
    smoothMethod: "moving",
    window: "2",
    polyOrder: "2",
  };
}

const num = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** The recorded params for `f`, or a message naming what is missing. */
export function formToParams(f: SimsForm, labels: readonly string[]): SimsParams | string {
  const p: SimsParams = { op: "sims" };
  if (f.calOn) {
    const cal: NonNullable<SimsParams["calibration"]> = { method: f.calMethod, depthUnit: f.depthUnit };
    if (f.timeUnit) cal.timeUnit = f.timeUnit;
    if (f.calMethod === "rate") {
      const r = num(f.sputterRate);
      if (r === null || r <= 0) return "Enter the sputter rate (a positive number).";
      Object.assign(cal, { sputterRate: r, rateUnit: `${f.rateLen}/${f.rateTime}` });
    } else {
      const d = num(f.craterDepth);
      if (d === null || d <= 0) return "Enter the measured crater depth (a positive number).";
      Object.assign(cal, { craterDepth: d, craterUnit: f.craterUnit });
      if (f.totalTime.trim()) {
        const t = num(f.totalTime);
        if (t === null || t <= 0) return "The total sputter time must be a positive number (or blank for the last point).";
        cal.totalTime = t;
      }
    }
    p.calibration = cal;
  }
  if (f.bgOn) {
    const lo = num(f.bgLo);
    const hi = num(f.bgHi);
    if (lo === null || hi === null) return "Enter both limits of the background region.";
    const keep = f.bgKeep.filter((name) => labels.includes(name));
    p.background = { lo, hi, ...(keep.length ? { keep } : {}) };
  }
  if (f.normOn) {
    if (!f.reference || !labels.includes(f.reference)) return "Pick the reference (matrix) species.";
    const rsf: Record<string, number> = {};
    for (const [name, text] of Object.entries(f.rsf)) {
      if (name === f.reference || !labels.includes(name) || !text.trim()) continue;
      const v = num(text);
      if (v === null || v <= 0) return `The RSF for ${name} must be a positive number (or blank for a plain ratio).`;
      rsf[name] = v;
    }
    const hasRsf = Object.keys(rsf).length > 0;
    if (hasRsf && !f.rsfUnit.trim()) return "Give the unit the RSFs convert to (e.g. atoms/cm3).";
    p.normalization = { reference: f.reference, ...(hasRsf ? { rsf, rsfUnit: f.rsfUnit.trim() } : {}) };
  }
  if (f.smoothOn) {
    const w = num(f.window);
    const k = num(f.polyOrder);
    if (w === null || !Number.isInteger(w) || w < 1) return "The smoothing half-width must be a whole number ≥ 1.";
    if (f.smoothMethod === "savitzky-golay" && (k === null || !Number.isInteger(k) || k < 0 || k >= 2 * w + 1)) {
      return `The polynomial order must be a whole number below the window width (${2 * w + 1}).`;
    }
    p.smoothing = { method: f.smoothMethod, window: w, polyOrder: k !== null && Number.isInteger(k) ? k : 2 };
  }
  if (!p.calibration && !p.background && !p.normalization && !p.smoothing) return "Turn on at least one step.";
  return p;
}
