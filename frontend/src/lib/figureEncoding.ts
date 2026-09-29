// The SHAPE of a plot window's P1.4 encoding picks (`FigureBindings.encoding`,
// lib/figureDocument.ts) and its persistence validator — dependency-free on
// purpose: the document codec sits in the eager graph, and the gate, the wire
// field and the palette (lib/plotEncodingBinding.ts) need not ride along with
// it. See plotEncodingBinding.ts for what the picks mean.

/** A plot window's encoding picks: value-channel indices of its bound dataset.
 *  Absent fields are unset; the whole object is absent when none is set, so a
 *  document with no encoding serializes byte-identically to one from before
 *  this field existed. */
export interface FigureEncoding {
  color?: number;
  symbol?: number;
  label?: number;
}

/** Validate an untrusted persisted `bindings.encoding`: non-negative integer
 *  fields only; undefined when nothing valid remains (so the key is omitted). */
export function sanitizeFigureEncoding(value: unknown): FigureEncoding | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: FigureEncoding = {};
  for (const k of ["color", "symbol", "label"] as const) {
    const v = raw[k];
    if (Number.isInteger(v) && (v as number) >= 0) out[k] = v as number;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
