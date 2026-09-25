// Peak Analyzer wizard (#31/#32) — pure helpers + the recipe contract. A
// PeakRecipe is the wizard's full configuration (range, baseline, find, model,
// report mode, and — since v2 — the mixed-shape model fit's engine / shapes /
// background / parameter-table edits, lib/peakRecipeFit.ts) as plain diffable
// JSON: saved recipes re-run the whole flow on another dataset, and the shape
// is designed to drop into the future pipeline (#6) as a step's params
// verbatim. Pure (no React / store / fetch).
//
// VERSIONS. v1 had no `fit`; it migrates to v2 with `DEFAULT_FIT`, which is
// exactly how the wizard treated every v1 recipe (model engine, shapes from
// the global shape, background from the degree, no table edits) — lossless,
// so no warning. Anything else that cannot be read (an unknown version, a
// malformed fit section) FAILS CLOSED: it is skipped with a named warning
// (`loadRecipesChecked`), never half-loaded, and a later save never deletes
// it from storage — only a save under the same name replaces it.

import { DEFAULT_FIT, parseRecipeFit, type PeakRecipeFit } from "./peakRecipeFit";

export const PEAK_RECIPE_VERSION = 2;

export interface PeakRecipe {
  version: 2;
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
  fit: PeakRecipeFit;
}

/** The peak shapes and width-linking modes the wizard offers (steps.tsx) —
 *  mirrors the backend's `MODELS` (calc/peak_fit.py) and `LINK_MODES`
 *  (routes/peaks.py), which reject anything else at fit time. The recipe
 *  file importer (lib/nameKeyedRecipes.ts) validates against these same
 *  tuples so an imported recipe cannot name a shape the fit will refuse. */
export const PEAK_SHAPES = ["Lorentzian", "Gaussian", "Pseudo-Voigt", "Split Pearson VII", "TCH-pV"] as const;
export const PEAK_LINK_MODES = ["None", "Shared FWHM", "Shared FWHM + eta"] as const;

/** The wizard's per-field edit rules (steps.tsx applies these to every typed
 *  value BEFORE `patchRecipe`), kept pure so they can be unit-tested and so
 *  the recipe-file importer (lib/nameKeyedRecipes.ts) can mirror exactly the
 *  same bounds: a recipe this app saved must always re-import. `null` means
 *  "reject the edit, keep the previous value" — used for the fields with an
 *  open interval where no clamp target exists (ALS `lam` > 0, ALS `p` in
 *  (0, 1) per calc/baseline.py's baseline_als, region width > 0). Integer
 *  counts/orders round, then clamp at their floor (rolling-ball radius >= 1
 *  point, modpoly order >= 0, max peaks >= 1, background degree >= 0);
 *  thresholds clamp at 0. */
export const peakClamp = {
  lam: (v: number): number | null => (v > 0 ? v : null),
  p: (v: number): number | null => (v > 0 && v < 1 ? v : null),
  radius: (v: number): number => Math.max(1, Math.round(v)),
  order: (v: number): number => Math.max(0, Math.round(v)),
  snrThreshold: (v: number): number => Math.max(0, v),
  maxPeaks: (v: number): number => Math.max(1, Math.round(v)),
  bgDegree: (v: number): number => Math.max(0, Math.round(v)),
  regionWidth: (v: number): number | null => (v > 0 ? v : null),
} as const;

export const DEFAULT_RECIPE: PeakRecipe = {
  version: 2,
  name: "",
  range: { lo: null, hi: null },
  baseline: { method: "none", lam: 1e5, p: 0.01, radius: 50, order: 2 },
  find: { snr_threshold: 3, min_prominence: 0, max_peaks: 20 },
  model: { shape: "Gaussian", bgDegree: 1, linkMode: "None", constrain: false },
  report: { mode: "fit", regionWidth: 3 },
  fit: DEFAULT_FIT,
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
 *  kept original index, null elsewhere (an index outside the rows is skipped).
 *  `kept` must be FULL-row indices — for the wizard's analysis-view segment,
 *  map them first (peakwizard/modelFitOverlay's `segmentRows`). */
export function expandToFullRows(
  values: readonly (number | null)[],
  kept: readonly number[],
  fullLength: number,
): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(fullLength).fill(null);
  kept.forEach((orig, i) => {
    if (orig >= 0 && orig < fullLength) out[orig] = values[i] ?? null;
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

/** A stored or imported record whose ENVELOPE is a peak recipe of a version
 *  this app reads (v1 or v2): a name and the five v1 sections as objects.
 *  Exported (P3.5) so `lib/nameKeyedRecipes.ts` checks an imported file with
 *  the SAME envelope rule storage uses; `upgradePeakRecipe` does the rest. */
export type StoredPeakRecipe = Omit<PeakRecipe, "version" | "fit"> & { version: 1 | 2; fit?: unknown };

export function isPeakRecipe(v: unknown): v is StoredPeakRecipe {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const obj = (k: string) => typeof o[k] === "object" && o[k] !== null;
  return (
    (o.version === 1 || o.version === 2) &&
    typeof o.name === "string" &&
    ["range", "baseline", "find", "model", "report"].every(obj)
  );
}

const fieldOf = (v: unknown, k: string): unknown =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>)[k] : undefined;

/** Any stored value -> a current (v2) PeakRecipe, or an Error saying why not:
 *  v1 gains `DEFAULT_FIT`; v2's fit section is validated and rebuilt
 *  (lib/peakRecipeFit's `parseRecipeFit`). */
export function upgradePeakRecipe(v: unknown): PeakRecipe {
  const version = fieldOf(v, "version");
  if (typeof version === "number" && version > PEAK_RECIPE_VERSION) {
    throw new Error(`unsupported version ${version} (this app reads up to ${PEAK_RECIPE_VERSION})`);
  }
  if (!isPeakRecipe(v)) throw new Error("not a peak recipe");
  const fit = v.version === 1 ? DEFAULT_FIT : parseRecipeFit(v.fit);
  return { ...v, version: 2, fit };
}

function readRaw(): unknown[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function upgradeAll(raw: readonly unknown[], warnings: string[] | null): PeakRecipe[] {
  const out: PeakRecipe[] = [];
  for (const entry of raw) {
    try {
      out.push(upgradePeakRecipe(entry));
    } catch (e) {
      const name = fieldOf(entry, "name");
      const label = typeof name === "string" && name ? ` "${name}"` : "";
      warnings?.push(`skipped saved peak recipe${label}: ${e instanceof Error ? e.message : "unreadable"}`);
    }
  }
  return out;
}

/** Every readable saved recipe (upgraded to v2), plus one warning per record
 *  skipped — the wizard shows them the way a workspace load shows its
 *  `migrationWarnings` (store/toasts' `notifyMigrationWarnings`). */
export function loadRecipesChecked(): { recipes: PeakRecipe[]; warnings: string[] } {
  const warnings: string[] = [];
  return { recipes: upgradeAll(readRaw(), warnings), warnings };
}

export function loadRecipes(): PeakRecipe[] {
  return upgradeAll(readRaw(), null);
}

/** Rewrite the slot as `raw` — records this app cannot read ride through
 *  untouched (a newer app's v3, say) — and return the readable list, even
 *  when storage refused the write (the change then stays session-local). */
function writeRaw(raw: unknown[]): PeakRecipe[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(raw));
  } catch {
    /* storage full/unavailable */
  }
  return upgradeAll(raw, null);
}

/** Save (upsert by name) and return the new list. */
export function saveRecipe(recipe: PeakRecipe): PeakRecipe[] {
  return writeRaw([...readRaw().filter((r) => fieldOf(r, "name") !== recipe.name), recipe]);
}

export function deleteRecipe(name: string): PeakRecipe[] {
  return writeRaw(readRaw().filter((r) => fieldOf(r, "name") !== name));
}
