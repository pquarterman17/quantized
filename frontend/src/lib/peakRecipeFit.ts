// Peak Analyzer recipe v2 — the model-fit section (audit P2.4 slice 3). Pure.
// A PeakRecipe v1 (lib/peakwizard.ts) stored range / baseline / find / model /
// report; the mixed-shape fit engine's configuration (engine, per-peak shapes,
// background, the parameter table) lived only in memory. This module is that
// section's contract: its type, its default (exactly the v1 behaviour, so a
// v1 recipe migrates losslessly), its validator (one validator, used at both
// the storage boundary and the recipe-file boundary) and the peak-index remap
// the wizard applies when a peak is deleted from, or re-included into, the
// model.
//
// EDITS, NOT A SNAPSHOT. The table's defaults are seeded from the data the
// recipe runs on (peakwizard/peakModelParams.ts's `seedSetup`): centres from
// the detected peaks, heights above the seeded background, bounds from the
// window. A recipe is meant to re-run on another dataset, so it stores only
// what the USER changed, field by field, keyed by the stable parameter name
// (`p{i}.{center,height,fwhm,eta,fwhm_g,fwhm_l}`, `bg.c{k}` — the backend's
// own names, src/quantized/calc/peak_model.py): fixing p0.eta at 0.3 or tying
// p1.fwhm to p0.fwhm carries over; the detected centre of peak 0 does not,
// unless the user typed one. Re-seeding on load (or after any input change)
// is seed-then-overlay, so every stored edit is respected and every field the
// user never touched follows the new data. Per-peak shapes likewise: `null`
// means "the recipe's global shape". The "share FWHM" toggle is a FLAG
// (`shareFwhm`), never recorded as tie edits: null follows the recipe's width
// link, and the wizard resets it to null whenever that link changes.
//
// PEAK INDICES. `p{i}` is the i-th INCLUDED peak. When the wizard deletes a
// peak it renumbers the edits (`remapFitPeaks`) so each edit stays with its
// peak; an EXCLUDED peak's own edits are set aside (`extractPeak`) and put
// back when it is re-included (`insertPeak`); a wholesale new peak list (Find
// peaks, a recipe applied to another dataset) keeps them by index — that is
// what a recipe means.
//
// LOAD vs FILE. Storage is this app's own output, so a stored recipe is read
// TOLERANTLY: an edit field that cannot be honoured (bounds with min > max, a
// parameter or tie past the peak cap) is dropped with a warning instead of the
// whole recipe vanishing. An imported file is untrusted and read STRICTLY.

export const FIT_ENGINES = ["model", "classic"] as const;
export type FitEngine = (typeof FIT_ENGINES)[number];
export const MODEL_SHAPE_IDS = ["gaussian", "lorentzian", "pseudo_voigt", "voigt"] as const;
export type ModelShape = (typeof MODEL_SHAPE_IDS)[number];
export const MODEL_BACKGROUND_IDS = ["none", "constant", "linear", "quadratic"] as const;
export type ModelBackground = (typeof MODEL_BACKGROUND_IDS)[number];

/** The fields of one table row a user can change; absent = the seed's. */
export interface ParamEdit {
  value?: number;
  vary?: boolean;
  min?: number | null;
  max?: number | null;
  tie?: string | null;
}

export interface PeakRecipeFit {
  engine: FitEngine;
  /** Per included peak; null (or past the end) = the recipe's global shape. */
  shapes: (ModelShape | null)[];
  /** null = derived from `model.bgDegree`. */
  background: ModelBackground | null;
  /** User edits by stable parameter name. */
  params: Record<string, ParamEdit>;
  /** The "share FWHM across peaks" toggle: null = as the width link seeds. */
  shareFwhm: boolean | null;
  /** Share-FWHM memory: root width the toggle forced to vary -> its `vary`
   *  edit before, restored when sharing is turned off. */
  shareVary: Record<string, boolean>;
}

export const DEFAULT_FIT: PeakRecipeFit = {
  engine: "model", shapes: [], background: null, params: {}, shareFwhm: null, shareVary: {},
};

/** Large enough for any real pattern, small enough that a hostile file cannot
 *  make the wizard allocate a million-row table. */
export const MAX_RECIPE_PEAKS = 500;
const NAME_RE = /^(?:p(0|[1-9]\d*)\.(center|height|fwhm|eta|fwhm_g|fwhm_l)|bg\.c([0-2]))$/;
const WIDTHS = new Set(["fwhm", "fwhm_g", "fwhm_l"]);

/** Tie compatibility class: the backend joins only parameters of one kind
 *  (the three widths are one kind; each background order is its own). */
export function paramKind(name: string): string {
  const field = name.slice(name.indexOf(".") + 1);
  if (name.startsWith("bg.")) return `bg${field.slice(1)}`;
  return WIDTHS.has(field) ? "width" : field;
}

/** "ok", "over-cap" (a real name, peak index >= MAX_RECIPE_PEAKS) or "invalid". */
function nameStatus(name: string): "ok" | "over-cap" | "invalid" {
  const m = NAME_RE.exec(name);
  if (!m) return "invalid";
  return m[1] !== undefined && (m[1].length > 6 || Number(m[1]) >= MAX_RECIPE_PEAKS) ? "over-cap" : "ok";
}

/** A parameter name this engine knows, with a peak index under the cap. */
export function isParamName(name: string): boolean {
  return nameStatus(name) === "ok";
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v);

function fail(path: string, why: string): never {
  throw new Error(path ? `fit.${path}: ${why}` : `fit: ${why}`);
}

/** `warn` present = tolerant (storage); absent = strict (file). */
type Warn = ((path: string, why: string) => void) | undefined;
const softFail = (warn: Warn, path: string, why: string): void => (warn ? warn(path, why) : fail(path, why));

function parseEdit(name: string, raw: unknown, warn: Warn): ParamEdit {
  const at = `params["${name}"]`;
  if (!isObj(raw)) fail(at, "not an object");
  const out: ParamEdit = {};
  if ("value" in raw) {
    if (!finite(raw.value)) fail(`${at}.value`, "not a finite number");
    out.value = raw.value;
  }
  if ("vary" in raw) {
    if (typeof raw.vary !== "boolean") fail(`${at}.vary`, "not true/false");
    out.vary = raw.vary;
  }
  for (const k of ["min", "max"] as const) {
    if (!(k in raw)) continue;
    const b = raw[k];
    if (b !== null && !finite(b)) fail(`${at}.${k}`, "not a finite number or null");
    out[k] = b as number | null;
  }
  if (typeof out.min === "number" && typeof out.max === "number" && out.min > out.max) {
    softFail(warn, at, "min > max (bounds dropped)");
    delete out.min;
    delete out.max;
  }
  if ("tie" in raw) {
    const t = raw.tie;
    if (t !== null) {
      const status = typeof t === "string" ? nameStatus(t) : "invalid";
      if (status === "invalid") fail(`${at}.tie`, "not a parameter name");
      if (t === name) fail(`${at}.tie`, "tied to itself");
      if (paramKind(t as string) !== paramKind(name)) fail(`${at}.tie`, `${t as string} is a different kind of parameter`);
      if (status === "over-cap") {
        softFail(warn, `${at}.tie`, `peak index over ${MAX_RECIPE_PEAKS - 1} (tie dropped)`);
        return out;
      }
    }
    out.tie = t as string | null;
  }
  return out;
}

/** Validate a fit section and REBUILD it from its known fields (unknown keys
 *  are dropped, never persisted). Strict (no `warnings`): throws an Error
 *  naming the offending field. Tolerant (`warnings` given, the storage
 *  boundary): an edit field that cannot be honoured — min > max bounds, a name
 *  or tie past the peak cap — is dropped and described in `warnings`; a
 *  malformed STRUCTURE still throws. A missing `shareFwhm` reads as null. */
export function parseRecipeFit(v: unknown, warnings?: string[]): PeakRecipeFit {
  const warn: Warn = warnings ? (path, why) => warnings.push(`fit.${path}: ${why}`) : undefined;
  if (!isObj(v)) fail("", "missing or not an object");
  if (!oneOf(v.engine, FIT_ENGINES)) fail("engine", `not one of ${FIT_ENGINES.join(" / ")}`);
  if (!Array.isArray(v.shapes)) fail("shapes", "not a list");
  if (v.shapes.length > MAX_RECIPE_PEAKS) fail("shapes", `more than ${MAX_RECIPE_PEAKS} peaks`);
  const shapes = v.shapes.map((s, i) => {
    if (s !== null && !oneOf(s, MODEL_SHAPE_IDS)) fail(`shapes[${i}]`, `not one of ${MODEL_SHAPE_IDS.join(" / ")}`);
    return s as ModelShape | null;
  });
  if (v.background !== null && !oneOf(v.background, MODEL_BACKGROUND_IDS)) {
    fail("background", `not one of ${MODEL_BACKGROUND_IDS.join(" / ")}`);
  }
  const shareFwhm = v.shareFwhm ?? null;
  if (shareFwhm !== null && typeof shareFwhm !== "boolean") fail("shareFwhm", "not true/false/null");
  if (!isObj(v.params)) fail("params", "not an object");
  const params: Record<string, ParamEdit> = {};
  for (const [name, raw] of Object.entries(v.params)) {
    const status = nameStatus(name);
    if (status === "invalid") fail(`params["${name}"]`, "not a parameter name");
    if (status === "over-cap") {
      softFail(warn, `params["${name}"]`, `peak index over ${MAX_RECIPE_PEAKS - 1} (edit dropped)`);
      continue;
    }
    params[name] = parseEdit(name, raw, warn);
  }
  if (!isObj(v.shareVary)) fail("shareVary", "not an object");
  const shareVary: Record<string, boolean> = {};
  for (const [name, vary] of Object.entries(v.shareVary)) {
    const status = nameStatus(name);
    if (status === "invalid" || typeof vary !== "boolean") fail(`shareVary["${name}"]`, "not a parameter name -> true/false");
    if (status === "over-cap") softFail(warn, `shareVary["${name}"]`, `peak index over ${MAX_RECIPE_PEAKS - 1} (dropped)`);
    else shareVary[name] = vary;
  }
  return { engine: v.engine, shapes, background: v.background as ModelBackground | null, params, shareFwhm, shareVary };
}

/** Renumber peak `i`'s names through `map` (null = the peak is gone, or its
 *  new index is past the cap — nothing is ever written that a load refuses). */
function remapName(name: string, map: (i: number) => number | null): string | null {
  const m = /^p(\d+)\.(.+)$/.exec(name);
  if (!m) return name;
  const to = map(Number(m[1]));
  return to === null || to >= MAX_RECIPE_PEAKS ? null : `p${to}.${m[2]}`;
}

/** Keep every edit with its peak across a change of the included-peak list.
 *  `map(oldIndex)` is the peak's new index, or null when it left the model;
 *  its edits go, and an edit's tie to a peak that left is withdrawn (the seed
 *  then applies to that field again, rather than an orphaned tie). */
export function remapFitPeaks(fit: PeakRecipeFit, map: (i: number) => number | null): PeakRecipeFit {
  const params: Record<string, ParamEdit> = {};
  for (const [name, edit] of Object.entries(fit.params)) {
    const to = remapName(name, map);
    if (to === null) continue;
    const next: ParamEdit = { ...edit };
    if (typeof edit.tie === "string") {
      const tie = remapName(edit.tie, map);
      if (tie === null) delete next.tie;
      else next.tie = tie;
    }
    params[to] = next;
  }
  const shareVary: Record<string, boolean> = {};
  for (const [name, vary] of Object.entries(fit.shareVary)) {
    const to = remapName(name, map);
    if (to !== null) shareVary[to] = vary;
  }
  const shapes: (ModelShape | null)[] = [];
  fit.shapes.forEach((s, i) => {
    const to = map(i);
    if (to !== null && to < MAX_RECIPE_PEAKS) shapes[to] = s;
  });
  for (let i = 0; i < shapes.length; i++) shapes[i] ??= null;
  return { ...fit, shapes, params, shareVary };
}

/** Peak `k` left the model: later peaks move down one. */
export const removedAt = (k: number) => (i: number): number | null => (i < k ? i : i === k ? null : i - 1);
/** A peak joined the model at index `k`: it and later peaks move up one. */
export const insertedAt = (k: number) => (i: number): number | null => (i < k ? i : i + 1);

/** One peak's own edits, set aside while it is excluded. Names are the field
 *  alone (`eta`); a tie to ANOTHER peak is kept as `@{candidateId}.{field}`
 *  so it can be re-pointed at whatever index that peak has on return. */
export interface PeakSlice {
  shape: ModelShape | null;
  params: Record<string, ParamEdit>;
  shareVary: Record<string, boolean>;
}

/** Peak `k`'s slice of `fit`; `ids[j]` is the candidate id of included peak j. */
export function extractPeak(fit: PeakRecipeFit, k: number, ids: readonly number[]): PeakSlice {
  const toRef = (name: string): string | null => {
    const m = /^p(\d+)\.(.+)$/.exec(name);
    if (!m) return name;
    const j = Number(m[1]);
    if (j === k) return m[2];
    return ids[j] === undefined ? null : `@${ids[j]}.${m[2]}`;
  };
  const params: Record<string, ParamEdit> = {};
  const shareVary: Record<string, boolean> = {};
  const own = new RegExp(`^p${k}\\.(.+)$`);
  for (const [name, edit] of Object.entries(fit.params)) {
    const m = own.exec(name);
    if (!m) continue;
    const next: ParamEdit = { ...edit };
    if (typeof edit.tie === "string") {
      const ref = toRef(edit.tie);
      if (ref === null) delete next.tie;
      else next.tie = ref;
    }
    params[m[1]] = next;
  }
  for (const [name, vary] of Object.entries(fit.shareVary)) {
    const m = own.exec(name);
    if (m) shareVary[m[1]] = vary;
  }
  return { shape: fit.shapes[k] ?? null, params, shareVary };
}

/** Put a set-aside slice back as peak `k` (the caller has already shifted the
 *  others with `insertedAt(k)`); `ids` are the included candidate ids NOW. A
 *  tie to a peak that is not (or no longer) included is withdrawn. */
export function insertPeak(fit: PeakRecipeFit, k: number, slice: PeakSlice, ids: readonly number[]): PeakRecipeFit {
  if (k >= MAX_RECIPE_PEAKS) return fit;
  const fromRef = (ref: string): string | null => {
    const m = /^@(\d+)\.(.+)$/.exec(ref);
    if (!m) return ref.includes(".") ? ref : `p${k}.${ref}`;
    const j = ids.indexOf(Number(m[1]));
    return j < 0 ? null : `p${j}.${m[2]}`;
  };
  const params = { ...fit.params };
  for (const [field, edit] of Object.entries(slice.params)) {
    const next: ParamEdit = { ...edit };
    if (typeof edit.tie === "string") {
      const tie = fromRef(edit.tie);
      if (tie === null) delete next.tie;
      else next.tie = tie;
    }
    params[`p${k}.${field}`] = next;
  }
  const shareVary = { ...fit.shareVary };
  for (const [field, vary] of Object.entries(slice.shareVary)) shareVary[`p${k}.${field}`] = vary;
  const shapes = [...fit.shapes];
  if (slice.shape !== null) {
    while (shapes.length < k) shapes.push(null);
    shapes[k] = slice.shape;
  } else if (k < shapes.length) shapes[k] = null;
  return { ...fit, params, shareVary, shapes };
}
