// The SHAPE of a plot window's P1.4 encoding picks (`FigureBindings.encoding`,
// lib/figureDocument.ts) and its persistence validator — dependency-free on
// purpose: the document codec sits in the eager graph, and the gate, the wire
// field and the palette (lib/plotEncodingBinding.ts) need not ride along with
// it. See plotEncodingBinding.ts for what the picks mean.

/** Per-slot text-column picks (P1.4 residual 5): a row-indexed text column
 *  (`metadata.text_columns ?? origin_text_columns`, lib/columnmeta.ts) named by
 *  its short name, since it has no channel index. A slot's text pick wins over
 *  its numeric one. */
export interface FigureEncodingText {
  color?: string;
  symbol?: string;
  label?: string;
}

/** A plot window's encoding picks: value-channel indices of its bound dataset.
 *  Absent fields are unset; the whole object is absent when none is set, so a
 *  document with no encoding serializes byte-identically to one from before
 *  this field existed. `color` is a categorical factor (a colour per level) or,
 *  for a continuous column, a gradient (P1.4 residual 4) — the gate decides. */
export interface FigureEncoding {
  color?: number;
  symbol?: number;
  label?: number;
  text?: FigureEncodingText;
}

export const ENCODING_SLOTS = ["color", "symbol", "label"] as const;

/** Validate an untrusted persisted `bindings.encoding`: non-negative integer
 *  fields and non-empty text names only; undefined when nothing valid remains
 *  (so the key is omitted). */
export function sanitizeFigureEncoding(value: unknown): FigureEncoding | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: FigureEncoding = {};
  const text: FigureEncodingText = {};
  const rawText = (raw.text ?? {}) as Record<string, unknown>;
  for (const k of ENCODING_SLOTS) {
    const v = raw[k];
    const t = rawText[k];
    if (Number.isInteger(v) && (v as number) >= 0) out[k] = v as number;
    if (typeof t === "string" && t) text[k] = t;
  }
  if (Object.keys(text).length > 0) out.text = text;
  return Object.keys(out).length > 0 ? out : undefined;
}
