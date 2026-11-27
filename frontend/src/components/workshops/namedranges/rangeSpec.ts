// Typed column and row entries for the manager's Retarget form, pure. Columns are written the way a formula writes them
// ("B:C", "A, C", "x, B"; a lone x is the pinned x column) and rows are 1-based worksheet rows, as they are shown everywhere.
// An entry that is not a valid block is REFUSED with a reason, never clamped or repaired.

import { channelLetter } from "../../../lib/formula";
import type { RowRange } from "../../../lib/rowRange";

/** "AB" -> 27: the inverse of `channelLetter`; null for anything that is not letters. */
export function letterIndex(letters: string): number | null {
  if (!/^[A-Za-z]+$/.test(letters)) return null;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A lone "x" is the pinned x column; "X" is too, unless the sheet is wide enough to have a column X. */
const colToken = (token: string, width: number): number | null => (token === "x" || (token === "X" && width <= 23) ? -1 : letterIndex(token));

/** "B:C", "A, C" or "X, B" as channel indices in the order written (a range runs upward), or why not. `width` is the
 *  worksheet's value-column count. */
export function parseColumnSpec(text: string, width: number): { cols: number[] } | { reason: string } {
  const tokens = text.split(/[,\s]+/).filter(Boolean);
  if (tokens.length === 0) return { reason: "enter the columns, for example B:C or A, C" };
  const cols: number[] = [];
  for (const token of tokens) {
    const parts = token.split(":");
    if (parts.length > 2) return { reason: `"${token}" is not a column or a column range` };
    const [a, b] = parts.map((p) => colToken(p, width));
    if (a === null || (parts.length === 2 && b === null)) return { reason: `"${token}" is not a column or a column range` };
    const from = a;
    const to = parts.length === 2 ? (b as number) : a;
    if (to < from) return { reason: `"${token}" runs backwards` };
    for (let c = from; c <= to; c++) cols.push(c);
  }
  const bad = cols.find((c) => c >= width);
  if (bad !== undefined) return { reason: `column ${channelLetter(bad)} is not on the worksheet (it has ${width})` };
  const dup = cols.find((c, i) => cols.indexOf(c) !== i);
  if (dup !== undefined) return { reason: `column ${dup < 0 ? "x" : channelLetter(dup)} is listed twice` };
  return { cols };
}

/** Channel indices as the text `parseColumnSpec` reads back ("x, A:B"). */
export function columnSpecText(cols: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < cols.length; ) {
    let j = i;
    while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1 && cols[i] >= 0) j++;
    const name = (c: number) => (c < 0 ? "x" : channelLetter(c));
    out.push(j > i ? `${name(cols[i])}:${name(cols[j])}` : name(cols[i]));
    i = j + 1;
  }
  return out.join(", ");
}

/** "from" and "to" (1-based, as typed) as a window; both blank = every row (`null`). One blank is refused. */
export function parseRowSpec(from: string, to: string): { rows: RowRange | null } | { reason: string } {
  if (from.trim() === "" && to.trim() === "") return { rows: null };
  if (from.trim() === "" || to.trim() === "") return { reason: "enter both rows, or leave both blank for every row" };
  const a = Number(from);
  const b = Number(to);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) return { reason: "rows are whole numbers from 1" };
  if (b < a) return { reason: "the first row must not come after the last" };
  return { rows: { from: a - 1, to: b - 1 } };
}
