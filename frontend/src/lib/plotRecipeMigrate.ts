// Plot recipe schema migration (F4.2 / audit P1.3: "version migration beyond
// the v1 parse-gate"). Before this, `plotRecipeIO.ts` accepted exactly one
// `schemaVersion` and dropped (tolerant path) or refused (strict path)
// everything else, so the first real schema change would have silently lost
// every recipe a user had saved. Now every read boundary routes through
// `migrateRecipeObject` first:
//
//   * an OLDER recipe is walked forward one version at a time by the step
//     table below (each step is a pure object -> object function that adds or
//     reshapes exactly what its version introduced) and then validated as a
//     current-version recipe by the same per-field sanitizers as always;
//   * a NEWER recipe (a file or project from a later build) is refused with
//     its own named error -- never guessed at, never down-converted;
//   * anything that is not an integer version at all is "unsupported", the
//     wording `parseRecipe` has always used.
//
// ADDING v3: bump `PLOT_RECIPE_SCHEMA_VERSION` (plotRecipeSchema.ts), add a
// `2: v2ToV3` step here, and add a frozen v2 literal to the migration test.
// Steps never read a field later than their own version, so a v1 recipe
// passes through every step in order.
//
// The v2 fields' sanitizers live here, beside the step that introduced them,
// so plotRecipeIO.ts (near its line ceiling) only wires them in.

import {
  PLOT_RECIPE_SCHEMA_VERSION,
  type RecipeOutlierPolicy,
  type RecipePreview,
  type RecipeTransformRef,
} from "./plotRecipeSchema";

type Raw = Record<string, unknown>;

/** v1 -> v2: the preview, outlier policy and transformation reference did not
 *  exist, so they are recorded as "not captured" (null) -- never invented. */
function v1ToV2(o: Raw): Raw {
  return { ...o, schemaVersion: 2, preview: null, outlierPolicy: null, transform: null };
}

/** `STEPS[n]` turns a version-n object into a version-(n+1) one. */
const STEPS: Readonly<Record<number, (o: Raw) => Raw>> = { 1: v1ToV2 };

export type RecipeMigration = { ok: Raw } | { error: string };

/** Walk `o` forward to `PLOT_RECIPE_SCHEMA_VERSION`. Pure: never mutates `o`.
 *  The result still needs the ordinary per-field validation; this only
 *  guarantees the SHAPE is the current version's. */
export function migrateRecipeObject(o: Raw): RecipeMigration {
  const v = o.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    return { error: `unsupported plot recipe schema version: ${String(v)}` };
  }
  if (v > PLOT_RECIPE_SCHEMA_VERSION) {
    return {
      error: `plot recipe schema version ${v} is newer than this app supports (v${PLOT_RECIPE_SCHEMA_VERSION}); update Quantized to open it`,
    };
  }
  let cur = o;
  for (let at = v; at < PLOT_RECIPE_SCHEMA_VERSION; at++) {
    const step = STEPS[at];
    if (!step) return { error: `unsupported plot recipe schema version: ${v}` };
    cur = step(cur);
  }
  return { ok: cur };
}

// ── v2 field sanitizers ─────────────────────────────────────────────────

export const PREVIEW_MAX_SERIES = 4;
export const PREVIEW_MAX_POINTS = 48;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Numbers only, clamped to [0, 1], capped at 4 series x 48 points; a point
 *  that is not two finite numbers is dropped, a series left empty is dropped,
 *  and a preview left with no series is null. */
export function sanitizePreview(v: unknown): RecipePreview | null {
  if (typeof v !== "object" || v === null) return null;
  const raw = (v as Raw).series;
  if (!Array.isArray(raw)) return null;
  const series: [number, number][][] = [];
  for (const s of raw) {
    if (!Array.isArray(s)) continue;
    const pts: [number, number][] = [];
    for (const p of s) {
      if (!Array.isArray(p) || p.length !== 2) continue;
      const [x, y] = p as unknown[];
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push([clamp01(x), clamp01(y)]);
      if (pts.length === PREVIEW_MAX_POINTS) break;
    }
    if (pts.length > 0) series.push(pts);
    if (series.length === PREVIEW_MAX_SERIES) break;
  }
  return series.length > 0 ? { series } : null;
}

export function sanitizeOutlierPolicy(v: unknown): RecipeOutlierPolicy | null {
  const d = typeof v === "object" && v !== null ? (v as Raw).excludedDisplay : undefined;
  return d === "hide" || d === "grey" ? { excludedDisplay: d } : null;
}

export function sanitizeTransformRef(v: unknown): RecipeTransformRef | null {
  if (typeof v !== "object" || v === null) return null;
  const { name, revision } = v as Raw;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return null;
  return { name, revision };
}
