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
 *  survive (do not use `Number(v) || default`). */
export function coerceParams(
  values: ParamValues,
  fields: ParamField[],
): ParamValues {
  const out: ParamValues = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.type === "number" && typeof v === "string") {
      const n = Number(v);
      out[f.key] = Number.isFinite(n) ? n : (f.default as number);
    } else {
      out[f.key] = v;
    }
  }
  return out;
}
