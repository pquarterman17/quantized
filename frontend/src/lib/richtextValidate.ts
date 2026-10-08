// The rich-label editor's live validation, moved verbatim out of
// lib/richtext.ts in bundle diet slice 24: only the lazy RichLabelInput calls
// it, so it ships with it instead of in the eager bundle. Import it by this
// path; richtext.ts does not re-export it (architecture.test.ts,
// DRAGGED_OUT).
import { hasMarkup, parseRichText } from "./richtext";

/** Live editor feedback: `{ ok: true }` or `{ ok: false, error }`. */
export function validateRichText(s: string): { ok: boolean; error?: string } {
  if (!hasMarkup(s)) return { ok: true };
  const r = parseRichText(s);
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "invalid label markup" };
}
