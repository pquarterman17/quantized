// Column spec limits (LSL / USL / Target) and free-text tags: two more
// `Dataset.columnProps` fields (GAP_AUDIT_9 G27; JMP's Spec Limits column
// property and column tags). Pure. Every field is optional, so an old
// project without them loads unchanged. Provisional, owner to confirm.

/** A column's specification limits; each one optional. */
export interface SpecLimits {
  lsl?: number;
  usl?: number;
  target?: number;
}

const SPEC_KEYS = ["lsl", "usl", "target"] as const;

/** `s` with non-finite fields dropped; `undefined` when nothing is left. */
export function cleanSpec(s: unknown): SpecLimits | undefined {
  if (!s || typeof s !== "object") return undefined;
  const out: SpecLimits = {};
  for (const k of SPEC_KEYS) {
    const v = (s as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Trimmed, de-duplicated (case-insensitive, first spelling wins), non-empty
 *  tags; `undefined` when none. Accepts an array or one comma-separated string. */
export function cleanTags(raw: unknown): string[] | undefined {
  const list = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const s = typeof t === "string" ? t.trim() : "";
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out.length ? out : undefined;
}

/** Spec fields that fill blanks of an SPC test: only the ones the user has
 *  NOT typed (null) and the column defines. Typed values always win. */
export function fillBlankSpec<T extends { lsl: number | null; usl: number | null; target: number | null }>(
  typed: T,
  spec: SpecLimits | undefined,
): { params: T; filled: string[] } {
  const params = { ...typed };
  const filled: string[] = [];
  for (const [k, label] of [["lsl", "LSL"], ["usl", "USL"], ["target", "Target"]] as const) {
    const v = spec?.[k];
    if (params[k] == null && v != null) {
      params[k] = v;
      filled.push(label);
    }
  }
  return { params, filled };
}
