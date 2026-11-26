// "Paste with trimmed spaces": strip leading and trailing whitespace from every
// pasted cell. The default paste is unchanged; this is the option behind the
// worksheet's "Paste with trimmed spaces".
//
// What it adds beyond today's paste: `parseCell` already trims ordinary
// whitespace before reading a number, so "  12 " lands either way. What a web
// page or a PDF leaves around a number is often NOT ordinary whitespace: a
// zero-width space or a word joiner. `String.trim` keeps those, so such a cell is "not a number" and skipped.
// This trim removes them too, so those cells land.

import { parseClipboardGrid } from "./clipboardGrid";

/** Whitespace as `String.trim` knows it (Unicode spaces, NBSP, BOM) plus the
 *  zero-width characters it does not: ZWSP/ZWNJ/ZWJ, word joiner, Mongolian
 *  vowel separator. */
const EDGE = /^[\s\u180e\u200b\u200c\u200d\u2060\ufeff]+|[\s\u180e\u200b\u200c\u200d\u2060\ufeff]+$/g;

export function trimCell(text: string): string {
  return text.replace(EDGE, "");
}

/** Every cell trimmed; the grid's shape (ragged rows included) is unchanged. */
export function trimGrid(grid: readonly (readonly string[])[]): string[][] {
  return grid.map((row) => row.map(trimCell));
}

/** Clipboard text with every cell trimmed, for a paste path that takes text. */
export function trimClipboardText(text: string): string {
  return trimGrid(parseClipboardGrid(text))
    .map((row) => row.join("\t"))
    .join("\n");
}
