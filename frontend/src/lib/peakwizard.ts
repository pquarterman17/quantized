// Peak Analyzer wizard (#31/#32) — pure helpers + the recipe contract. A
// PeakRecipe is the wizard's full configuration (range, baseline, find, model,
// report mode) as plain diffable JSON: saved recipes re-run the whole flow on
// another dataset, and the shape is designed to drop into the future pipeline
// (#6) as a step's params verbatim. Pure (no React / store / fetch).

export interface PeakRecipe {
  version: 1;
  name: string;
  range: { lo: number | null; hi: number | null };
  baseline: {
    method: "none" | "als" | "rollingball" | "modpoly";
    lam: number; // ALS smoothness
    p: number; // ALS asymmetry
    radius: number; // rolling-ball radius (points)
    order: number; // modpoly order
  };
  find: { snr_threshold: number; min_prominence: number; max_peaks: number };
  model: { shape: string; bgDegree: number; linkMode: string; constrain: boolean };
  report: { mode: "fit" | "integrate"; regionWidth: number }; // width in ×FWHM
}

export const DEFAULT_RECIPE: PeakRecipe = {
  version: 1,
  name: "",
  range: { lo: null, hi: null },
  baseline: { method: "none", lam: 1e5, p: 0.01, radius: 50, order: 2 },
  find: { snr_threshold: 3, min_prominence: 0, max_peaks: 20 },
  model: { shape: "Gaussian", bgDegree: 1, linkMode: "None", constrain: false },
  report: { mode: "fit", regionWidth: 3 },
};

/** Contiguous slice of (x, y) with x inside [lo, hi] (null bound = open). Also
 *  returns the kept original indices so results can align back to the full x. */
export function cutRange(
  x: readonly number[],
  y: readonly number[],
  lo: number | null,
  hi: number | null,
): { x: number[]; y: number[]; kept: number[] } {
  const kept: number[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (lo !== null && x[i] < lo) continue;
    if (hi !== null && x[i] > hi) continue;
    kept.push(i);
  }
  return { x: kept.map((i) => x[i]), y: kept.map((i) => y[i]), kept };
}

/** y minus baseline, null/NaN baseline points passed through unchanged. */
export function subtractBaseline(
  y: readonly number[],
  baseline: readonly (number | null)[],
): number[] {
  return y.map((v, i) => {
    const b = baseline[i];
    return b === null || b === undefined || !Number.isFinite(b) ? v : v - b;
  });
}

/** Map a cut-segment y (or overlay) back onto the full row count: value at its
 *  kept original index, null elsewhere. */
export function expandToFullRows(
  values: readonly (number | null)[],
  kept: readonly number[],
  fullLength: number,
): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(fullLength).fill(null);
  kept.forEach((orig, i) => {
    out[orig] = values[i] ?? null;
  });
  return out;
}

/** Integration regions from peak positions: center ± (width×FWHM)/2, clamped
 *  to the data range, overlapping regions kept as-is (the integrator handles
 *  them independently — matches Origin's per-region model). */
export function regionsFromPeaks(
  peaks: readonly { center: number; fwhm: number }[],
  width: number,
  xMin: number,
  xMax: number,
): [number, number][] {
  return peaks.map((p) => {
    const half = (Math.max(p.fwhm, 0) * width) / 2 || (xMax - xMin) / 50;
    return [Math.max(xMin, p.center - half), Math.min(xMax, p.center + half)];
  });
}

// ── Saved recipes (localStorage, like recent files / prefs) ────────────────
const KEY = "qz.peakRecipes";

function isRecipe(v: unknown): v is PeakRecipe {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === 1 &&
    typeof o.name === "string" &&
    typeof o.range === "object" &&
    o.range !== null &&
    typeof o.baseline === "object" &&
    o.baseline !== null &&
    typeof o.find === "object" &&
    o.find !== null &&
    typeof o.model === "object" &&
    o.model !== null &&
    typeof o.report === "object" &&
    o.report !== null
  );
}

export function loadRecipes(): PeakRecipe[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecipe) : [];
  } catch {
    return [];
  }
}

/** Save (upsert by name) and return the new list. */
export function saveRecipe(recipe: PeakRecipe): PeakRecipe[] {
  const list = loadRecipes().filter((r) => r.name !== recipe.name);
  list.push(recipe);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full/unavailable — recipe stays session-local */
  }
  return list;
}

export function deleteRecipe(name: string): PeakRecipe[] {
  const list = loadRecipes().filter((r) => r.name !== name);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}
