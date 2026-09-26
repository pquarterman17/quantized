// Where to mark a custom-equation syntax error (audit P2.7).
//
// `/api/fitting/equation/validate` reports the error's `[errorStart,
// errorEnd)` in CODE POINTS of the submitted text (Python string indices);
// a JS string and an <input>'s selection are indexed in UTF-16 code units.
// The two agree for every BMP character and differ by one per astral
// character (an emoji, a math-alphanumeric letter) before the span, so the
// span is converted here rather than trusted as-is. Pure.

export interface TextSpan {
  /** UTF-16 offsets into the text, `end` exclusive, `end > start`. */
  start: number;
  end: number;
}

/** Convert a code-point span into a UTF-16 span of `text`, clamped to the
 *  text and widened to at least one character; null when there is nothing
 *  to mark (empty text, non-finite or inverted input). */
export function codePointSpanToUtf16(
  text: string,
  start: number | null | undefined,
  end: number | null | undefined,
): TextSpan | null {
  if (start == null || end == null) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return null;
  const points = Array.from(text);
  if (points.length === 0) return null;
  const s = Math.min(start, points.length - 1);
  const e = Math.min(Math.max(end, s + 1), points.length);
  const utf16 = (n: number) => points.slice(0, n).join("").length;
  return { start: utf16(s), end: utf16(e) };
}
