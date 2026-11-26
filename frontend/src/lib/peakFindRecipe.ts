// Field-level validation of a peak recipe's OPTIONAL Advanced `find` fields
// (lib/peakwizard's `PeakFindAdvanced`), split out of nameKeyedRecipes.ts for
// its module-size ceiling. Absent fields stay absent (= the route's default).

import type { PeakFindAdvanced } from "./peakwizard";

const PEAK_FIND_SENSITIVITIES = ["low", "medium", "high"] as const;
const PEAK_FIND_BACKGROUNDS = ["snip", "polynomial"] as const;
const PEAK_FINDERS = ["residual", "derivative1", "derivative2"] as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nonneg = (v: unknown): v is number => finite(v) && v >= 0;
const nonnegInt = (v: unknown): v is number => nonneg(v) && Number.isInteger(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v);

/** The Advanced fields `find` carries, validated; `bad(field)` throws. */
export function parseFindAdvanced(find: Record<string, unknown>, bad: (field: string) => never): Partial<PeakFindAdvanced> {
  const advanced: Partial<PeakFindAdvanced> = {};
  if (find.sensitivity !== undefined) {
    if (!oneOf(find.sensitivity, PEAK_FIND_SENSITIVITIES)) bad("find.sensitivity");
    advanced.sensitivity = find.sensitivity as PeakFindAdvanced["sensitivity"];
  }
  for (const k of ["min_separation", "min_width_deg", "max_width_deg", "max_window_deg"] as const) {
    if (find[k] === undefined) continue;
    if (!nonneg(find[k])) bad(`find.${k}`);
    advanced[k] = find[k] as number;
  }
  if (find.bg_method !== undefined) {
    if (!oneOf(find.bg_method, PEAK_FIND_BACKGROUNDS)) bad("find.bg_method");
    advanced.bg_method = find.bg_method as PeakFindAdvanced["bg_method"];
  }
  if (find.bg_poly_degree !== undefined) {
    if (!nonnegInt(find.bg_poly_degree)) bad("find.bg_poly_degree");
    advanced.bg_poly_degree = find.bg_poly_degree as number;
  }
  if (find.finder !== undefined) {
    if (!oneOf(find.finder, PEAK_FINDERS)) bad("find.finder");
    advanced.finder = find.finder;
  }
  if (find.smooth_window !== undefined) {
    const w = find.smooth_window;
    if (!nonnegInt(w) || (w > 0 && (w < 5 || w % 2 === 0))) bad("find.smooth_window");
    advanced.smooth_window = find.smooth_window as number;
  }
  for (const k of ["bg_iterative", "strict_prominence"] as const) {
    if (find[k] === undefined) continue;
    if (typeof find[k] !== "boolean") bad(`find.${k}`);
    advanced[k] = find[k] as boolean;
  }
  return advanced;
}
