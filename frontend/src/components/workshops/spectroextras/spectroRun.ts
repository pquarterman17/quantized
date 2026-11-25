// Spectroscopy extras workshop (GAP_AUDIT_9 G21): the option model, the checks
// that fail closed before a request is sent, and the dispatch to the three
// backend tools (routes/spectro_extras.py). Pure apart from the API calls.

import {
  spectroCorr2d, spectroFsd, spectroOnset,
  type Apodization, type Corr2dResult, type FsdResult, type OnsetResult,
} from "../../../lib/api/spectroExtras";

export type SeTab = "fsd" | "corr2d" | "onset";

export const SE_TABS: readonly { id: SeTab; label: string }[] = [
  { id: "fsd", label: "Self-deconvolution" },
  { id: "corr2d", label: "2-D correlation" },
  { id: "onset", label: "Onset" },
];

export interface SeOptions {
  fsd: { hwhm: number; k: number; apodization: Apodization };
  /** Comma-separated perturbation values, one per spectrum; blank = the column order. */
  corr: { perturbation: string; xMin: number | null; xMax: number | null };
  /** Blank (null) baseline / window ends use the backend defaults (outer 10 % / every row). */
  onset: { side: "left" | "right"; fraction: number; smooth: number; baseMin: number | null; baseMax: number | null; xMin: number | null; xMax: number | null };
}

export const DEFAULT_SE_OPTIONS: SeOptions = {
  fsd: { hwhm: 1, k: 1.5, apodization: "triangular" },
  corr: { perturbation: "", xMin: null, xMax: null },
  onset: { side: "left", fraction: 0.1, smooth: 1, baseMin: null, baseMax: null, xMin: null, xMax: null },
};

/** One picked column against the shared X. */
export interface SeChannel { index: number; label: string; y: number[] }
export interface SeInput { x: number[]; channels: SeChannel[]; xLabel: string; xUnit: string }

export type SeResult =
  | { tab: "fsd"; runs: { label: string; res: FsdResult }[] }
  | { tab: "corr2d"; data: Corr2dResult }
  | { tab: "onset"; runs: { label: string; res: OnsetResult }[] };

/** The perturbation values, null for blank, or "bad" when the text is not a list of numbers. */
export function parsePerturbation(text: string): number[] | null | "bad" {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(/[\s,;]+/).filter(Boolean).map(Number);
  return parts.some((v) => !Number.isFinite(v)) ? "bad" : parts;
}

const evenlySpaced = (x: readonly number[]): boolean => {
  if (x.length < 3) return false;
  const d = x.slice(1).map((v, i) => v - x[i]);
  const step = [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)];
  return step !== 0 && d.every((v) => Math.abs(v - step) <= 0.01 * Math.abs(step));
};

/** A reason the run cannot start (shown beside the Run button), or null. */
export function seProblem(tab: SeTab, input: SeInput | null, o: SeOptions): string | null {
  if (!input || input.channels.length === 0) return "Tick at least one column.";
  const bad = input.x.reduce((n, v) => n + (Number.isFinite(v) ? 0 : 1), 0)
    + input.channels.reduce((n, c) => n + c.y.reduce((m, v) => m + (Number.isFinite(v) ? 0 : 1), 0), 0);
  if (bad) return `${bad} value${bad === 1 ? " is" : "s are"} blank or non-finite: these tools need a gap-free spectrum, so clean or interpolate them first.`;
  switch (tab) {
    case "fsd":
      if (!evenlySpaced(input.x)) return "Self-deconvolution needs an evenly spaced X; resample the spectrum first.";
      if (!(o.fsd.hwhm > 0)) return "The line half-width (HWHM) must be positive.";
      return o.fsd.k >= 1 ? null : "The enhancement factor K must be at least 1.";
    case "corr2d": {
      if (input.channels.length < 3) return "2-D correlation needs at least 3 spectra: tick three or more columns.";
      const p = parsePerturbation(o.corr.perturbation);
      if (p === "bad") return "Perturbation values must be numbers separated by commas.";
      if (p && p.length !== input.channels.length) return `Give ${input.channels.length} perturbation values (one per ticked column), or leave it blank.`;
      return o.corr.xMin !== null && o.corr.xMax !== null && o.corr.xMin >= o.corr.xMax ? "X minimum must be below X maximum." : null;
    }
    case "onset": {
      const t = o.onset;
      if (!(t.fraction > 0 && t.fraction < 1)) return "The threshold fraction must be between 0 and 1.";
      if (!(t.smooth === 1 || (Number.isInteger(t.smooth) && t.smooth >= 5 && t.smooth % 2 === 1))) return "Smoothing must be 1 (none) or an odd number of rows, 5 or more.";
      if ((t.baseMin === null) !== (t.baseMax === null)) return "Give both ends of the baseline range, or neither.";
      if (t.baseMin !== null && t.baseMax !== null && t.baseMin >= t.baseMax) return "Baseline minimum must be below its maximum.";
      return t.xMin !== null && t.xMax !== null && t.xMin >= t.xMax ? "Window minimum must be below its maximum." : null;
    }
  }
}

/** The settings section the tool reads. */
export const seOptionsOf = (tab: SeTab, o: SeOptions): SeOptions[keyof SeOptions] => (tab === "fsd" ? o.fsd : tab === "corr2d" ? o.corr : o.onset);

/** Everything the answer depends on: a changed setting, column pick or spectrum makes a shown result stale. */
export function seRunKey(tab: SeTab, fingerprint: string, picked: readonly number[], o: SeOptions): string {
  return JSON.stringify([tab, fingerprint, picked, seOptionsOf(tab, o)]);
}

const num = (v: number | null): number | undefined => (v === null ? undefined : v);

export async function runSpectro(tab: SeTab, input: SeInput, o: SeOptions): Promise<SeResult> {
  const { x, channels } = input;
  switch (tab) {
    case "fsd":
      return { tab, runs: await Promise.all(channels.map(async (c) => ({
        label: c.label, res: await spectroFsd({ x, y: c.y, hwhm: o.fsd.hwhm, k: o.fsd.k, apodization: o.fsd.apodization }),
      }))) };
    case "corr2d": {
      const p = parsePerturbation(o.corr.perturbation);
      return { tab, data: await spectroCorr2d({
        x, spectra: channels.map((c) => c.y), x_label: input.xLabel, x_unit: input.xUnit,
        ...(Array.isArray(p) ? { perturbation: p } : {}),
        ...(o.corr.xMin !== null ? { x_min: o.corr.xMin } : {}), ...(o.corr.xMax !== null ? { x_max: o.corr.xMax } : {}),
      }) };
    }
    case "onset": {
      const t = o.onset;
      return { tab, runs: await Promise.all(channels.map(async (c) => ({
        label: c.label,
        res: await spectroOnset({
          x, y: c.y, side: t.side, fraction: t.fraction, smooth: t.smooth,
          x_min: num(t.xMin), x_max: num(t.xMax), baseline_min: num(t.baseMin), baseline_max: num(t.baseMax),
        }),
      }))) };
    }
  }
}
