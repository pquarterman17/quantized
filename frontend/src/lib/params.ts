// Ported from fermiviewer frontend/src/lib/params.ts (shared platform code —
// keep in sync). Parameter-field schema for the modal ParamDialog.

export interface ParamField {
  key: string;
  label: string;
  type: "number" | "select" | "boolean" | "text";
  default: number | string | boolean;
  options?: string[]; // for select
  hint?: string;
}

export type ParamValues = Record<string, number | string | boolean>;

/** Coerce in-progress number strings to numbers (falling back to the field
 *  default) before a command consumes the values. NB: a valid typed 0 must
 *  survive (do not use `Number(v) || default`).
 *
 *  Guarantees the output has EVERY field's key, even if `values` is missing
 *  one (falls back to `f.default`) — the shape a caller's `params.someKey`
 *  can rely on regardless of how `values` got built. ParamDialog's own local
 *  state is normally fully populated before a user can interact with it, but
 *  this is the last chokepoint before a command consumes the result, so it
 *  stays defensive: a caller like runExportFigureCommand does
 *  `(params.x_label as string).trim()` with no guard of its own, and an
 *  `undefined` there throws OUTSIDE exportActive's try/catch — silently,
 *  since store/commands.ts's runAction swallows a command's own rejection
 *  (P0.4 finding 15, 2026-07-27: traced to a ParamDialog render race, now
 *  fixed at the source — this guard is defense in depth for every OTHER
 *  askParams() caller, not a substitute for that fix). */
export function coerceParams(
  values: ParamValues,
  fields: ParamField[],
): ParamValues {
  const out: ParamValues = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined) {
      out[f.key] = f.default;
    } else if (f.type === "number" && typeof v === "string") {
      const n = Number(v);
      out[f.key] = Number.isFinite(n) ? n : (f.default as number);
    } else {
      out[f.key] = v;
    }
  }
  return out;
}
