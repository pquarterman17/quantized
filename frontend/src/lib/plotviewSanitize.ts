// Field sanitizers for a persisted PlotView, moved out of `lib/plotview.ts`
// (P2.6 box 2) when the Stat Stage's two persisted display options
// (`statHideEmptyLevels`/`statShowGroupN`) became PlotView fields: that module
// sits on a line pin, and it and this one are both in the EAGER bundle, which
// has almost no headroom. So the move had to fund bytes as well as lines:
//
//   * `sanitizeRegionShades` — moved whole (lines only). The `.dwk` loader
//     (`plotview.sanitizePlotView`) and the recipe importer (`plotRecipeIO.ts`)
//     both call it, so the two can never disagree about a well-formed shade.
//   * `boolViewFields` — the plain-boolean fields in ONE loop instead of one
//     `boolOrDefault(o.x, fb.x)` per field. Each field now costs its key
//     string once rather than three times, which is what paid for the two new
//     fields' eager bytes (measured with `scripts/profile-eager-bundle.mjs`).

import type { PlotView } from "./plotview";
import type { RegionShade } from "./types";

/** The PlotView fields that are plain booleans. `satisfies` pins every name
 *  to a real PlotView key; `boolViewFields`' return type pins each to boolean. */
const BOOL_VIEW_KEYS = [
  "showGrid", "showLegend", "legendStatic", "showAxisBox", "stackMode", "insetMode",
  "polarMode", "statMode", "statHideEmptyLevels", "statShowGroupN",
] as const satisfies readonly (keyof PlotView)[];

export type BoolViewKey = (typeof BOOL_VIEW_KEYS)[number];

/** Each boolean field from a persisted view, or the fallback view's value when
 *  missing or not a boolean — the per-field-fallback discipline
 *  `sanitizePlotView` applies to every other field. Never throws. */
export function boolViewFields(o: Record<string, unknown>, fb: PlotView): Pick<PlotView, BoolViewKey> {
  const out = {} as Pick<PlotView, BoolViewKey>;
  for (const k of BOOL_VIEW_KEYS) out[k] = typeof o[k] === "boolean" ? (o[k] as boolean) : fb[k];
  return out;
}

/** Validate a persisted region-shade list (F2.3j — decoded film-stack shades
 *  became editable plot objects, not immutable provenance; previously this
 *  field was a bare `Array.isArray` cast). The `RegionShade` analogue of
 *  `sanitizeShapes` above: an entry missing its required `id`/finite
 *  `x1..y2`/string `fill` is dropped (nothing sane to fall back to for a
 *  single list entry); `axis` keeps only 0/1, same "drop the bad value, keep
 *  the entry" shape as an unrecognized annotation anchor. Region shades are
 *  always data-anchored (unlike `Shape`, there is no page-fraction variant),
 *  so coordinates are never clamped — same "never clamp DATA coords"
 *  convention `sanitizeShapes` already uses for a data-anchored shape. Never
 *  throws. */
export function sanitizeRegionShades(v: unknown): RegionShade[] {
  if (!Array.isArray(v)) return [];
  const out: RegionShade[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.fill !== "string") continue;
    const coords = [o.x1, o.y1, o.x2, o.y2];
    if (!coords.every((n): n is number => typeof n === "number" && Number.isFinite(n))) continue;
    out.push({
      id: o.id,
      x1: o.x1 as number,
      y1: o.y1 as number,
      x2: o.x2 as number,
      y2: o.y2 as number,
      fill: o.fill,
      ...(o.axis === 0 || o.axis === 1 ? { axis: o.axis } : {}),
    });
  }
  return out;
}
