// CSV formula-injection guard (OWASP), the client twin of the backend's
// quantized/csv_safe.py. Exported CSVs carry dataset names and labels read
// from imported files; a spreadsheet runs a cell that starts with = + - @
// (or tab / CR) as a formula. A TEXT cell gets a leading `'` instead. Number
// cells never come through here, and a plain decimal literal ("-1.5") that
// does is left alone so it stays a number.

const TRIGGER = /^[=+\-@\t\r]/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** `text` with a leading `'` when it would start a spreadsheet formula. */
export function neutralizeFormula(text: string): string {
  return TRIGGER.test(text) && !NUMBER.test(text) ? `'${text}` : text;
}

/** One RFC-4180 TEXT cell: formula-neutralized, then quoted when it holds a
 *  comma, quote, or newline. */
export function csvTextCell(text: string): string {
  const s = neutralizeFormula(text);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
