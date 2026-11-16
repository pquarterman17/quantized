// The Import wizard's raw-lines view, without the backend (UX audit 8 #7).
// The preview request 422s exactly when the wizard is needed most (an
// ambiguous decimal comma, a header the guess got wrong), and the wizard then
// showed only an error -- no lines, no columns. The raw lines come from the
// file text the wizard already holds, and the delimiter to highlight from the
// preview when there is one, else the setting, else a local guess. The guess
// is a display aid only: the backend's own vote (`io._delimiter_vote`) still
// decides how the file is parsed.

import { parseLineField } from "./importwizard";

/** How many raw lines the wizard shows: the backend preview's `max_lines`. */
export const RAW_LINE_LIMIT = 60;

/** Python's `str.splitlines()` boundaries, which the backend's numbering
 *  (`import_parse`: `text.removeprefix("\ufeff").splitlines()`) counts by:
 *  a form feed or U+2028 is a line break there, so it must be one here, or
 *  every line after it is numbered one off from the preview. */
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** `text` the way the backend reads it: without a leading BOM. */
const unBom = (text: string): string => (text.startsWith("\ufeff") ? text.slice(1) : text);

/** The first `limit` lines of `text`, as `splitlines()` would give them. */
export function rawLines(text: string, limit = RAW_LINE_LIMIT): string[] {
  const lines = unBom(text).split(LINE_BREAK, limit + 1);
  // A trailing line break is not one more (empty) line.
  if (lines.length <= limit && lines.at(-1) === "") lines.pop();
  return lines.slice(0, limit);
}

/** How many lines `text` holds (`len(text.splitlines())`, uncapped). */
export function countLines(text: string): number {
  const body = unBom(text);
  const breaks = body.match(new RegExp(LINE_BREAK.source, "g"))?.length ?? 0;
  return body === "" || new RegExp(`(?:${LINE_BREAK.source})$`).test(body) ? breaks : breaks + 1;
}

/** The wizard's named delimiters (`DELIMITER_OPTIONS`) as the character they
 *  split on; `null` for whitespace (nothing single to highlight) and `auto`. */
const NAMED: Readonly<Record<string, string | null>> = {
  comma: ",", tab: "\t", semicolon: ";", pipe: "|", whitespace: null, auto: null,
};

const CANDIDATES = ["\t", ";", "|", ","] as const;

/** A delimiter that splits every sampled line the same nonzero number of
 *  times, tab first, then `;` (a `;` file writes "2,000;0,5": its commas are
 *  decimals), `|`, `,`. `null` when none does (a whitespace file). */
export function guessDelimiter(lines: readonly string[]): string | null {
  const sample = lines.filter((l) => l.trim() && !/^\s*[#%!]/.test(l)).slice(0, 10);
  if (!sample.length) return null;
  for (const d of CANDIDATES) {
    const counts = sample.map((l) => l.split(d).length - 1);
    if (counts[0] > 0 && counts.every((n) => n === counts[0])) return d;
  }
  // A ragged preamble line: settle for the delimiter on most lines.
  let best: string | null = null;
  let bestLines = sample.length / 2;
  for (const d of CANDIDATES) {
    const n = sample.filter((l) => l.includes(d)).length;
    if (n > bestLines) [best, bestLines] = [d, n];
  }
  return best;
}

/** The delimiter character to highlight: the preview's resolved one, else the
 *  chosen setting, else a guess from the lines. */
export function highlightDelimiter(
  previewDelimiter: string | null | undefined,
  setting: string | undefined,
  lines: readonly string[],
): string | null {
  // Whitespace (" ") has no single character worth highlighting.
  if (previewDelimiter != null) return previewDelimiter === " " || !previewDelimiter ? null : previewDelimiter;
  if (setting && setting !== "auto") return setting in NAMED ? NAMED[setting] : setting;
  return guessDelimiter(lines);
}

/** The text after an error message has been read in the wizard: the backend
 *  says "pick … in the Import Wizard", which is where the user already is. */
export function inWizard(message: string): string {
  return message.replace(/ in the Import Wizard/gi, " above");
}

/** A 1-based line field back to the wire's 0-based index: `null` when blank
 *  or not a line number (0 and negatives are no line, not line 1). */
export function lineIndex(raw: string): number | null {
  const n = parseLineField(raw);
  return n === null || n < 1 ? null : n - 1;
}
